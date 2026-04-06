import { defineStore } from 'pinia'
import { supabase, isPreviewMode } from '../lib/supabase'
import { syncQueue } from '../lib/syncQueue'
import { backupToIDB } from '../lib/durableStorage'
import { mergeEntities } from '../lib/conflictResolver'
import { uuid } from '../lib/uuid'
import { logError, logWarn } from '../lib/logger'

const STORAGE_KEY = 'workout-exercises'

export interface WorkoutSet {
  id: string
  date: string
  weight: number
  reps: number
  estimated1RM: number
}

export type ExerciseInputMode = 'numpad' | 'plates'

export type PlateCountMode = 'per-side' | 'total'

export interface Exercise {
  id: string
  name: string
  tags: string[]
  sets: WorkoutSet[]
  inputMode?: ExerciseInputMode    // remembered per exercise, default 'numpad'
  barWeight?: number               // bar weight in lbs, default 45
  plateCountMode?: PlateCountMode  // how plates are counted, default 'per-side'
}

export interface OverloadSuggestion {
  type: 'increase_weight' | 'increase_reps'
  weight: number
  reps: number
  reason: string
}

function epley(weight: number, reps: number): number {
  if (reps === 1) return Math.round(weight)
  return Math.round(weight * (1 + reps / 30))
}

/**
 * Deduplicate exercises by name (case-insensitive).
 * For each group of exercises with the same name, keeps the one with
 * the most sets as primary and merges all other sets into it.
 */
function deduplicateByName(exercises: Exercise[]): { exercises: Exercise[]; removed: Exercise[] } {
  const groups = new Map<string, Exercise[]>()
  for (const ex of exercises) {
    const key = ex.name.toLowerCase()
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(ex)
  }

  const result: Exercise[] = []
  const removed: Exercise[] = []

  for (const group of groups.values()) {
    if (group.length === 1) {
      result.push(group[0])
      continue
    }
    // Pick the one with the most sets as primary
    group.sort((a, b) => b.sets.length - a.sets.length)
    const primary = group[0]
    // Merge sets from duplicates, deduplicating by set ID
    const setIds = new Set(primary.sets.map(s => s.id))
    for (let i = 1; i < group.length; i++) {
      for (const set of group[i].sets) {
        if (!setIds.has(set.id)) {
          primary.sets.push(set)
          setIds.add(set.id)
        }
      }
      removed.push(group[i])
    }
    // Merge tags from duplicates
    const tagSet = new Set(primary.tags)
    for (let i = 1; i < group.length; i++) {
      for (const tag of group[i].tags) tagSet.add(tag)
    }
    primary.tags = [...tagSet]
    result.push(primary)
  }

  return { exercises: result, removed }
}

/**
 * Deduplicate sets within each exercise by content (date + weight + reps).
 * When multiple sets have identical content, keep the first one encountered
 * and return the duplicate IDs for cleanup.
 */
function deduplicateSetsByContent(exercises: Exercise[]): string[] {
  const removedSetIds: string[] = []
  for (const ex of exercises) {
    const seen = new Map<string, string>() // content key → first set ID
    const uniqueSets: WorkoutSet[] = []
    for (const set of ex.sets) {
      const key = `${set.date}|${set.weight}|${set.reps}`
      if (!seen.has(key)) {
        seen.set(key, set.id)
        uniqueSets.push(set)
      } else {
        removedSetIds.push(set.id)
      }
    }
    ex.sets = uniqueSets
  }
  return removedSetIds
}

function load(): Exercise[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error('Expected array')
    return parsed
  } catch (e) {
    logWarn('Corrupt workout data in localStorage, using empty state', { error: String(e) })
    return []
  }
}

export const useWorkoutStore = defineStore('workout', {
  state: () => ({
    exercises: load() as Exercise[],
    customTags: JSON.parse(localStorage.getItem('lift-custom-tags') || '[]') as string[],
    _userId: null as string | null
  }),

  actions: {
    _persist() {
      const data = JSON.stringify(this.exercises)
      try {
        localStorage.setItem(STORAGE_KEY, data)
        localStorage.setItem('lift-custom-tags', JSON.stringify(this.customTags))
      } catch (e) {
        logError(e, { source: 'workout._persist', size: data.length })
      }
      backupToIDB(STORAGE_KEY, data)
    },

    async init(userId: string) {
      this._userId = userId
      await this._fetchFromSupabase()
    },

    async _fetchFromSupabase() {
      if (!supabase || !this._userId) return

      const [{ data: exercises }, { data: sets }] = await Promise.all([
        supabase.from('exercises').select('*').eq('user_id', this._userId).order('created_at'),
        supabase.from('sets').select('*').eq('user_id', this._userId).order('created_at')
      ])

      if (!exercises) return

      const remoteExercises = exercises.map((ex: Record<string, unknown>) => {
        const exercise: Exercise & { updated_at: string } = {
          id: ex.id as string,
          name: ex.name as string,
          tags: (ex.tags as string[]) || [],
          updated_at: (ex.updated_at as string) || (ex.created_at as string) || new Date().toISOString(),
          sets: [] as WorkoutSet[],
        }
        if (ex.input_mode) exercise.inputMode = ex.input_mode as ExerciseInputMode
        if (ex.plate_loaded) exercise.inputMode = 'plates' // migrate old field
        if (ex.bar_weight != null) exercise.barWeight = ex.bar_weight as number
        return exercise
      })

      // Build remote sets grouped by exercise
      const remoteSetsMap = new Map<string, WorkoutSet[]>()
      for (const s of (sets || []) as Record<string, unknown>[]) {
        const exerciseId = s.exercise_id as string
        if (!remoteSetsMap.has(exerciseId)) remoteSetsMap.set(exerciseId, [])
        remoteSetsMap.get(exerciseId)!.push({
          id: s.id as string,
          date: s.date as string,
          weight: s.weight as number,
          reps: s.reps as number,
          estimated1RM: s.estimated_1rm as number
        })
      }
      remoteExercises.forEach(ex => {
        ex.sets = remoteSetsMap.get(ex.id) || []
      })

      // Merge with local state using last-write-wins conflict resolution
      const localWithTimestamps = this.exercises.map(ex => ({
        ...ex,
        updated_at: (ex as Exercise & { updated_at?: string }).updated_at || new Date(0).toISOString()
      }))

      const { merged, localOnly } = mergeEntities(localWithTimestamps, remoteExercises)

      // Deduplicate exercises by name (case-insensitive).
      // Supabase can end up with multiple exercises of the same name from
      // different sessions/devices with different UUIDs. Merge their sets
      // into the primary (the one with the most sets) and delete the dupes.
      const deduped = deduplicateByName(merged.map(({ updated_at: _ts, ...rest }) => rest as Exercise))

      // Clean up duplicate exercises from Supabase
      if (supabase && this._userId && deduped.removed.length > 0) {
        const userId = this._userId
        for (const dupe of deduped.removed) {
          // Reassign sets to the primary exercise
          for (const set of dupe.sets) {
            const primary = deduped.exercises.find(e =>
              e.name.toLowerCase() === dupe.name.toLowerCase()
            )
            if (primary) {
              syncQueue.enqueue(`set-reassign:${set.id}`, () =>
                supabase!.from('sets').update({ exercise_id: primary.id }).eq('id', set.id).eq('user_id', userId)
              )
            }
          }
          // Delete the duplicate exercise
          syncQueue.enqueue(`exercise-dedup-delete:${dupe.id}`, () =>
            supabase!.from('exercises').delete().eq('id', dupe.id).eq('user_id', userId)
          )
        }
      }

      // Deduplicate sets by content (same date + weight + reps within an exercise).
      // This catches duplicates created by fire-and-forget inserts or multi-device sync
      // where the same set was inserted with different UUIDs.
      const dupSetIds = deduplicateSetsByContent(deduped.exercises)
      if (supabase && this._userId && dupSetIds.length > 0) {
        const userId = this._userId
        for (const setId of dupSetIds) {
          syncQueue.enqueue(`set-content-dedup:${setId}`, () =>
            supabase!.from('sets').delete().eq('id', setId).eq('user_id', userId)
          )
        }
      }

      this.exercises = deduped.exercises
      this._persist()

      // Push local-only exercises to remote
      if (localOnly.length > 0) {
        const userId = this._userId
        for (const ex of localOnly) {
          syncQueue.enqueue(`exercise-push:${ex.id}`, () =>
            supabase!.from('exercises').upsert({
              id: ex.id, user_id: userId, name: ex.name, tags: ex.tags
            })
          )
          for (const set of ex.sets) {
            syncQueue.enqueue(`set-push:${set.id}`, () =>
              supabase!.from('sets').upsert({
                id: set.id, user_id: userId, exercise_id: ex.id,
                date: set.date, weight: set.weight, reps: set.reps,
                estimated_1rm: set.estimated1RM
              })
            )
          }
        }
      }
    },

    addExercise(name: string, tags: string[] = [], { sync = true }: { sync?: boolean } = {}): string | null {
      const trimmed = name.trim()
      if (!trimmed) return null
      const existing = this.exercises.find(
        (e: Exercise) => e.name.toLowerCase() === trimmed.toLowerCase()
      )
      if (existing) return existing.id
      const id = uuid()
      const exercise: Exercise = { id, name: trimmed, tags: [...tags], sets: [] }
      this.exercises.push(exercise)
      this._persist()

      if (sync && supabase && !isPreviewMode.value && this._userId) {
        supabase.from('exercises').insert({
          id, user_id: this._userId, name: trimmed, tags: [...tags]
        }).then()
      }
      return id
    },

    setExercisePlateCountMode(exerciseId: string, mode: PlateCountMode) {
      const exercise = this.exercises.find((e: Exercise) => e.id === exerciseId)
      if (!exercise) return
      exercise.plateCountMode = mode
      this._persist()
    },

    setExerciseInputMode(exerciseId: string, mode: ExerciseInputMode) {
      const exercise = this.exercises.find((e: Exercise) => e.id === exerciseId)
      if (!exercise) return
      exercise.inputMode = mode
      this._persist()

      if (supabase && this._userId) {
        const userId = this._userId
        syncQueue.enqueue(`exercise-input-mode:${exerciseId}`, () =>
          supabase!.from('exercises').update({ input_mode: mode }).eq('id', exerciseId).eq('user_id', userId)
        )
      }
    },

    logSet(exerciseId: string, weight: number, reps: number, dateStr?: string, { sync = true }: { sync?: boolean } = {}) {
      const exercise = this.exercises.find((e: Exercise) => e.id === exerciseId)
      if (!exercise) return
      const date = dateStr
        ? dateStr + 'T23:59:59.000Z'
        : new Date().toISOString()
      const id = uuid()
      const estimated1RM = epley(weight, reps)
      exercise.sets.push({ id, date, weight, reps, estimated1RM })
      this._persist()

      if (sync && supabase && !isPreviewMode.value && this._userId) {
        supabase.from('sets').insert({
          id, user_id: this._userId, exercise_id: exerciseId,
          date, weight, reps, estimated_1rm: estimated1RM
        }).then()
      }
    },

    updateSet(exerciseId: string, setId: string, weight: number, reps: number, dateStr?: string) {
      const exercise = this.exercises.find((e: Exercise) => e.id === exerciseId)
      if (!exercise) return
      const set = exercise.sets.find((s: WorkoutSet) => s.id === setId)
      if (!set) return
      set.weight = weight
      set.reps = reps
      set.estimated1RM = epley(weight, reps)
      if (dateStr) {
        set.date = dateStr + 'T23:59:59.000Z'
      }
      this._persist()

      if (supabase && this._userId) {
        const update: Record<string, unknown> = { weight, reps, estimated_1rm: set.estimated1RM }
        if (dateStr) update.date = set.date
        const userId = this._userId
        syncQueue.enqueue(`set-update:${setId}`, () =>
          supabase!.from('sets').update(update).eq('id', setId).eq('user_id', userId)
        )
      }
    },

    deleteSet(exerciseId: string, setId: string, { sync = true }: { sync?: boolean } = {}) {
      const exercise = this.exercises.find((e: Exercise) => e.id === exerciseId)
      if (!exercise) return
      exercise.sets = exercise.sets.filter((s: WorkoutSet) => s.id !== setId)
      this._persist()

      if (sync && supabase && !isPreviewMode.value && this._userId) {
        const userId = this._userId
        syncQueue.enqueue(`set-delete:${setId}`, () =>
          supabase!.from('sets').delete().eq('id', setId).eq('user_id', userId)
        )
      }
    },

    restoreSet(exerciseId: string, set: WorkoutSet) {
      const exercise = this.exercises.find((e: Exercise) => e.id === exerciseId)
      if (!exercise) return
      exercise.sets.push(set)
      this._persist()
    },

    renameExercise(exerciseId: string, newName: string) {
      const trimmed = newName.trim()
      if (!trimmed) return
      const exercise = this.exercises.find((e: Exercise) => e.id === exerciseId)
      if (!exercise) return
      exercise.name = trimmed
      this._persist()

      if (supabase && this._userId) {
        const userId = this._userId
        syncQueue.enqueue(`exercise-name:${exerciseId}`, () =>
          supabase!.from('exercises').update({ name: trimmed }).eq('id', exerciseId).eq('user_id', userId)
        )
      }
    },

    updateExerciseTags(exerciseId: string, tags: string[]) {
      const exercise = this.exercises.find((e: Exercise) => e.id === exerciseId)
      if (!exercise) return
      exercise.tags = [...tags]
      this._persist()

      if (supabase && this._userId) {
        const tagsCopy = [...tags]
        const userId = this._userId
        syncQueue.enqueue(`exercise-tags:${exerciseId}`, () =>
          supabase!.from('exercises').update({ tags: tagsCopy }).eq('id', exerciseId).eq('user_id', userId)
        )
      }
    },

    deleteExercise(exerciseId: string, { sync = true }: { sync?: boolean } = {}) {
      const idx = this.exercises.findIndex((e: Exercise) => e.id === exerciseId)
      if (idx === -1) return
      this.exercises.splice(idx, 1)
      this._persist()

      if (sync && supabase && !isPreviewMode.value && this._userId) {
        const userId = this._userId
        syncQueue.enqueue(`exercise-delete-sets:${exerciseId}`, () =>
          supabase!.from('sets').delete().eq('exercise_id', exerciseId).eq('user_id', userId)
        )
        syncQueue.enqueue(`exercise-delete:${exerciseId}`, () =>
          supabase!.from('exercises').delete().eq('id', exerciseId).eq('user_id', userId)
        )
      }
    },

    restoreExercise(exercise: Exercise, atIndex?: number) {
      if (atIndex !== undefined && atIndex >= 0 && atIndex <= this.exercises.length) {
        this.exercises.splice(atIndex, 0, exercise)
      } else {
        this.exercises.push(exercise)
      }
      this._persist()
    },

    syncDeleteSet(setId: string) {
      if (supabase && this._userId) {
        const userId = this._userId
        syncQueue.enqueue(`set-delete:${setId}`, () =>
          supabase!.from('sets').delete().eq('id', setId).eq('user_id', userId)
        )
      }
    },

    syncDeleteExercise(exerciseId: string) {
      if (supabase && this._userId) {
        const userId = this._userId
        syncQueue.enqueue(`exercise-delete-sets:${exerciseId}`, () =>
          supabase!.from('sets').delete().eq('exercise_id', exerciseId).eq('user_id', userId)
        )
        syncQueue.enqueue(`exercise-delete:${exerciseId}`, () =>
          supabase!.from('exercises').delete().eq('id', exerciseId).eq('user_id', userId)
        )
      }
    },

    reorderExercise(fromIndex: number, toIndex: number) {
      if (fromIndex === toIndex) return
      if (fromIndex < 0 || toIndex < 0) return
      if (fromIndex >= this.exercises.length || toIndex >= this.exercises.length) return
      const [item] = this.exercises.splice(fromIndex, 1)
      this.exercises.splice(toIndex, 0, item)
      this._persist()
    },

    renameTag(oldName: string, newName: string) {
      const trimmed = newName.trim()
      if (!trimmed || trimmed === oldName) return
      this.exercises.forEach((e: Exercise) => {
        const idx = e.tags.indexOf(oldName)
        if (idx !== -1) {
          if (e.tags.includes(trimmed)) {
            e.tags.splice(idx, 1)
          } else {
            e.tags[idx] = trimmed
          }
        }
      })
      const customIdx = this.customTags.indexOf(oldName)
      if (customIdx !== -1) {
        if (this.customTags.includes(trimmed)) {
          this.customTags.splice(customIdx, 1)
        } else {
          this.customTags[customIdx] = trimmed
        }
      }
      this._persist()

      if (this._userId) {
        const userId = this._userId
        this.exercises.forEach((e: Exercise) => {
          const tags = [...e.tags]
          syncQueue.enqueue(`exercise-tags:${e.id}`, () =>
            supabase!.from('exercises').update({ tags }).eq('id', e.id).eq('user_id', userId)
          )
        })
      }
    },

    deleteTag(tagName: string) {
      this.exercises.forEach((e: Exercise) => {
        const idx = e.tags.indexOf(tagName)
        if (idx !== -1) e.tags.splice(idx, 1)
      })
      this.customTags = this.customTags.filter(t => t !== tagName)
      this._persist()

      if (this._userId) {
        const userId = this._userId
        this.exercises.forEach((e: Exercise) => {
          const tags = [...e.tags]
          syncQueue.enqueue(`exercise-tags:${e.id}`, () =>
            supabase!.from('exercises').update({ tags }).eq('id', e.id).eq('user_id', userId)
          )
        })
      }
    },

    addCustomTag(name: string) {
      const trimmed = name.trim()
      if (!trimmed || this.customTags.includes(trimmed)) return
      this.customTags.push(trimmed)
      this._persist()
    },

    removeCustomTag(name: string) {
      this.customTags = this.customTags.filter(t => t !== name)
      this._persist()
    }
  },

  getters: {
    allTags: (state): string[] => {
      const tagSet = new Set<string>()
      state.exercises.forEach((e: Exercise) => (e.tags || []).forEach((t: string) => tagSet.add(t)))
      state.customTags.forEach((t: string) => tagSet.add(t))
      return [...tagSet].sort()
    },

    /** Sorted unique workout dates (YYYY-MM-DD), derived from all sets. */
    workoutDates: (state): string[] => {
      const dates = new Set<string>()
      state.exercises.forEach((e: Exercise) =>
        e.sets.forEach((s: WorkoutSet) => dates.add(s.date.slice(0, 10)))
      )
      return [...dates].sort()
    },

    getExercisePR: (state) => (exerciseId: string): number => {
      const exercise = state.exercises.find((e: Exercise) => e.id === exerciseId)
      if (!exercise || exercise.sets.length === 0) return 0
      return Math.max(...exercise.sets.map((s: WorkoutSet) => s.estimated1RM))
    },

    getExercisePRSet: (state) => (exerciseId: string): WorkoutSet | null => {
      const exercise = state.exercises.find((e: Exercise) => e.id === exerciseId)
      if (!exercise || exercise.sets.length === 0) return null
      return exercise.sets.reduce((best: WorkoutSet, s: WorkoutSet) =>
        s.estimated1RM > best.estimated1RM ? s : best
      )
    },

    getRecentSets: (state) => (exerciseId: string, limit = 5): WorkoutSet[] => {
      const exercise = state.exercises.find((e: Exercise) => e.id === exerciseId)
      if (!exercise) return []
      return [...exercise.sets].reverse().slice(0, limit)
    },

    /**
     * Progressive overload suggestion for an exercise.
     * Analyzes recent sessions to suggest the next weight × reps.
     *
     * Algorithm:
     * 1. Group sets by date into sessions (most recent first)
     * 2. Take the top set (highest weight) from each of the last 3 sessions
     * 3. If user lifted the same weight×reps across 2+ sessions → suggest +5 lbs
     * 4. If user increased reps but not weight recently → suggest weight increase
     * 5. Otherwise suggest +1 rep at same weight
     */
    getOverloadSuggestion: (state) => (exerciseId: string): OverloadSuggestion | null => {
      const exercise = state.exercises.find((e: Exercise) => e.id === exerciseId)
      if (!exercise || exercise.sets.length < 3) return null

      // Group sets by date (YYYY-MM-DD) → sessions
      const sessions = new Map<string, WorkoutSet[]>()
      for (const set of exercise.sets) {
        const day = set.date.slice(0, 10)
        if (!sessions.has(day)) sessions.set(day, [])
        sessions.get(day)!.push(set)
      }

      // Sort sessions by date descending, take last 3
      const sortedDays = [...sessions.keys()].sort().reverse()
      if (sortedDays.length < 2) return null

      const recentSessions = sortedDays.slice(0, 3)

      // Get top set (heaviest weight) from each session
      const topSets = recentSessions.map(day => {
        const sets = sessions.get(day)!
        return sets.reduce((best, s) => s.weight > best.weight || (s.weight === best.weight && s.reps > best.reps) ? s : best)
      })

      const latest = topSets[0]
      const previous = topSets[1]

      // Check if user has been consistent at same weight across recent sessions
      const sameWeight = topSets.filter(s => s.weight === latest.weight)
      const WEIGHT_INCREMENT = 5 // lbs

      if (sameWeight.length >= 2 && latest.reps >= 5) {
        // Consistent at same weight with solid reps → increase weight
        // Suggest same reps (or slightly fewer) at higher weight
        const suggestedReps = Math.max(latest.reps - 2, 3)
        return {
          type: 'increase_weight',
          weight: latest.weight + WEIGHT_INCREMENT,
          reps: suggestedReps,
          reason: `You've hit ${latest.weight} lbs × ${latest.reps} in ${sameWeight.length} recent sessions — time to go heavier`
        }
      }

      if (latest.weight === previous.weight && latest.reps > previous.reps) {
        // Reps increasing at same weight → keep building or bump weight
        if (latest.reps >= 8) {
          return {
            type: 'increase_weight',
            weight: latest.weight + WEIGHT_INCREMENT,
            reps: Math.max(latest.reps - 2, 3),
            reason: `Strong rep progression at ${latest.weight} lbs — ready for a weight increase`
          }
        }
        return {
          type: 'increase_reps',
          weight: latest.weight,
          reps: latest.reps + 1,
          reason: `You went from ${previous.reps} to ${latest.reps} reps — keep building`
        }
      }

      if (latest.weight > previous.weight) {
        // Already increased weight recently → consolidate
        return {
          type: 'increase_reps',
          weight: latest.weight,
          reps: latest.reps + 1,
          reason: `You recently moved up to ${latest.weight} lbs — build reps before adding more weight`
        }
      }

      // Default: suggest adding a rep
      return {
        type: 'increase_reps',
        weight: latest.weight,
        reps: latest.reps + 1,
        reason: `Try adding one more rep at ${latest.weight} lbs`
      }
    }
  }
})
