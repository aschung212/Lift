import { defineStore } from 'pinia'
import { supabase, isPreviewMode } from '../lib/supabase'
import { syncQueue } from '../lib/syncQueue'
import { backupToIDB } from '../lib/durableStorage'
import { mergeEntities } from '../lib/conflictResolver'
import { uuid, endOfDayISO } from '../lib/uuid'
import { logError, logWarn } from '../lib/logger'
import { addTombstone, removeTombstone, isTombstoned, cleanupTombstones } from '../lib/tombstones'

const TOMBSTONE_STORE = 'exercises'

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
  updated_at?: string              // ISO 8601, used for last-write-wins merge
  sample?: boolean                 // true for onboarding sample data — never synced to Supabase
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
    // Merge sets from duplicates, deduplicating by both ID and content.
    // Content dedup (date+weight+reps) is safe here because these sets
    // originate from duplicate exercises created by sync — they represent
    // the same logged set, just inserted under different exercise UUIDs.
    const setIds = new Set(primary.sets.map(s => s.id))
    const setContentKeys = new Set(primary.sets.map(s => `${s.date}|${s.weight}|${s.reps}`))
    for (let i = 1; i < group.length; i++) {
      for (const set of group[i].sets) {
        const contentKey = `${set.date}|${set.weight}|${set.reps}`
        if (!setIds.has(set.id) && !setContentKeys.has(contentKey)) {
          primary.sets.push(set)
          setIds.add(set.id)
          setContentKeys.add(contentKey)
        }
      }
      removed.push(group[i])
    }
    // If a sample exercise absorbs a real one, adopt it (clear sample flag)
    if (primary.sample && group.some(ex => !ex.sample)) {
      delete primary.sample
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

    /** Clear sample flag and push exercise + all its sets to Supabase. */
    _adoptExercise(exercise: Exercise) {
      delete exercise.sample
      if (supabase && !isPreviewMode.value && this._userId) {
        const userId = this._userId
        syncQueue.enqueue(`exercise:${exercise.id}`, () =>
          supabase!.from('exercises').upsert({
            id: exercise.id, user_id: userId, name: exercise.name, tags: exercise.tags,
            ...(exercise.inputMode ? { input_mode: exercise.inputMode } : {}), ...(exercise.barWeight != null ? { bar_weight: exercise.barWeight } : {})
          })
        )
        for (const set of exercise.sets) {
          syncQueue.enqueue(`set:${set.id}`, () =>
            supabase!.from('sets').upsert({
              id: set.id, user_id: userId, exercise_id: exercise.id,
              date: set.date, weight: set.weight, reps: set.reps,
              estimated_1rm: set.estimated1RM
            })
          )
        }
      }
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

      // Filter out tombstoned exercises (deleted offline, not yet synced)
      const remoteIds = new Set(exercises.map((ex: Record<string, unknown>) => ex.id as string))
      cleanupTombstones(TOMBSTONE_STORE, remoteIds)
      const filteredExercises = exercises.filter(
        (ex: Record<string, unknown>) => !isTombstoned(TOMBSTONE_STORE, ex.id as string)
      )

      const remoteExercises = filteredExercises.map((ex: Record<string, unknown>) => {
        const exercise: Exercise = {
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

      // Build remote sets grouped by exercise, filtering tombstoned sets
      const remoteSetIds = new Set((sets || []).map((s: Record<string, unknown>) => s.id as string))
      cleanupTombstones('sets', remoteSetIds)
      const remoteSetsMap = new Map<string, WorkoutSet[]>()
      for (const s of (sets || []) as Record<string, unknown>[]) {
        if (isTombstoned('sets', s.id as string)) {
          // Re-enqueue the delete for tombstoned sets still in remote
          const setId = s.id as string
          const userId = this._userId
          syncQueue.enqueue(`set:${setId}`, () =>
            supabase!.from('sets').delete().eq('id', setId).eq('user_id', userId)
          )
          continue
        }
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
      // (#1 fix: local exercises now carry updated_at from mutations)
      const localWithTimestamps = this.exercises.map(ex => ({
        ...ex,
        updated_at: ex.updated_at || new Date(0).toISOString()
      }))

      type ExerciseWithTimestamp = Exercise & { updated_at: string }
      const { merged, localOnly, localWins } = mergeEntities<ExerciseWithTimestamp>(localWithTimestamps, remoteExercises as ExerciseWithTimestamp[])

      // Deduplicate exercises by name (case-insensitive).
      // Supabase can end up with multiple exercises of the same name from
      // different sessions/devices with different UUIDs. Merge their sets
      // into the primary (the one with the most sets) and delete the dupes.
      const deduped = deduplicateByName(merged as Exercise[])

      // Clean up duplicate exercises from Supabase
      // (#4 fix: only reassign sets that survived content dedup; delete the rest)
      if (supabase && this._userId && deduped.removed.length > 0) {
        const userId = this._userId
        for (const dupe of deduped.removed) {
          const primary = deduped.exercises.find(e =>
            e.name.toLowerCase() === dupe.name.toLowerCase()
          )
          if (primary) {
            const primarySetIds = new Set(primary.sets.map(s => s.id))
            for (const set of dupe.sets) {
              if (primarySetIds.has(set.id)) {
                // Set was merged into primary — upsert under the primary exercise ID.
                // Uses upsert (not update) because the set may be local-only and not yet in Supabase.
                syncQueue.enqueue(`set:${set.id}`, () =>
                  supabase!.from('sets').upsert({
                    id: set.id, user_id: userId, exercise_id: primary.id,
                    date: set.date, weight: set.weight, reps: set.reps,
                    estimated_1rm: set.estimated1RM
                  })
                )
              } else {
                // Set was content-deduped out — delete it from Supabase
                syncQueue.enqueue(`set:${set.id}`, () =>
                  supabase!.from('sets').delete().eq('id', set.id).eq('user_id', userId)
                )
              }
            }
          }
          // Delete the duplicate exercise
          syncQueue.enqueue(`exercise:${dupe.id}`, () =>
            supabase!.from('exercises').delete().eq('id', dupe.id).eq('user_id', userId)
          )
          // Push the primary's merged state (tags may have been combined from dupes)
          if (primary) {
            syncQueue.enqueue(`exercise:${primary.id}`, () =>
              supabase!.from('exercises').upsert({
                id: primary.id, user_id: userId, name: primary.name, tags: primary.tags,
                ...(primary.inputMode ? { input_mode: primary.inputMode } : {}), ...(primary.barWeight != null ? { bar_weight: primary.barWeight } : {})
              })
            )
          }
        }
      }

      // Deduplicate sets within each exercise by content (date+weight+reps).
      // This catches duplicates already baked into a single exercise from
      // a previous sync cycle that merged duplicate exercise rows.
      //
      // Only dedup sets whose timestamps match the old hardcoded format
      // (T23:59:59.000Z) — these are from the code that created the sync
      // duplicates. Sets with jitter or real-time timestamps are guaranteed
      // unique and are never deduped, even if they share weight/reps.
      const dupSetIds: string[] = []
      for (const ex of deduped.exercises) {
        const seen = new Map<string, string>()
        const uniqueSets: WorkoutSet[] = []
        for (const set of ex.sets) {
          const key = `${set.date}|${set.weight}|${set.reps}`
          const isOldFixedTimestamp = set.date.endsWith('T23:59:59.000Z')
          if (!seen.has(key)) {
            seen.set(key, set.id)
            uniqueSets.push(set)
          } else if (isOldFixedTimestamp) {
            // Duplicate with old fixed timestamp — sync artifact, delete it
            dupSetIds.push(set.id)
          } else {
            // Duplicate content but unique timestamp — legitimate set, keep it
            uniqueSets.push(set)
          }
        }
        ex.sets = uniqueSets
      }
      if (supabase && this._userId && dupSetIds.length > 0) {
        const userId = this._userId
        for (const setId of dupSetIds) {
          syncQueue.enqueue(`set:${setId}`, () =>
            supabase!.from('sets').delete().eq('id', setId).eq('user_id', userId)
          )
        }
      }

      this.exercises = deduped.exercises
      this._persist()

      // Push local-only exercises to remote
      // (#3 fix: filter localOnly to exclude exercises removed by dedup)
      // (#232 fix: skip sample exercises — they were created with sync:false during onboarding)
      const survivingIds = new Set(deduped.exercises.map(e => e.id))
      const filteredLocalOnly = localOnly.filter(e => survivingIds.has(e.id) && !e.sample)
      if (filteredLocalOnly.length > 0) {
        const userId = this._userId
        for (const ex of filteredLocalOnly) {
          syncQueue.enqueue(`exercise:${ex.id}`, () =>
            supabase!.from('exercises').upsert({
              id: ex.id, user_id: userId, name: ex.name, tags: ex.tags,
              ...(ex.inputMode ? { input_mode: ex.inputMode } : {}), ...(ex.barWeight != null ? { bar_weight: ex.barWeight } : {})
            })
          )
          for (const set of ex.sets) {
            syncQueue.enqueue(`set:${set.id}`, () =>
              supabase!.from('sets').upsert({
                id: set.id, user_id: userId, exercise_id: ex.id,
                date: set.date, weight: set.weight, reps: set.reps,
                estimated_1rm: set.estimated1RM
              })
            )
          }
        }
      }

      // Push local-wins back to Supabase (offline edits that beat remote timestamps)
      // Filter against surviving IDs to avoid racing with dedup deletes
      const filteredLocalWins = localWins.filter(e => survivingIds.has(e.id) && !e.sample)
      if (filteredLocalWins.length > 0) {
        const userId = this._userId
        for (const ex of filteredLocalWins) {
          syncQueue.enqueue(`exercise:${ex.id}`, () =>
            supabase!.from('exercises').upsert({
              id: ex.id, user_id: userId, name: ex.name, tags: ex.tags,
              ...(ex.inputMode ? { input_mode: ex.inputMode } : {}), ...(ex.barWeight != null ? { bar_weight: ex.barWeight } : {})
            })
          )
          for (const set of ex.sets) {
            syncQueue.enqueue(`set:${set.id}`, () =>
              supabase!.from('sets').upsert({
                id: set.id, user_id: userId, exercise_id: ex.id,
                date: set.date, weight: set.weight, reps: set.reps,
                estimated_1rm: set.estimated1RM
              })
            )
          }
        }
      }

      // Process active tombstones: ensure pending deletes are synced
      const tombstoneExercises = exercises
        .filter((ex: Record<string, unknown>) => isTombstoned(TOMBSTONE_STORE, ex.id as string))
      if (tombstoneExercises.length > 0) {
        const userId = this._userId
        for (const ex of tombstoneExercises) {
          const exId = ex.id as string
          syncQueue.enqueue(`exercise-sets:${exId}`, () =>
            supabase!.from('sets').delete().eq('exercise_id', exId).eq('user_id', userId)
          )
          syncQueue.enqueue(`exercise:${exId}`, () =>
            supabase!.from('exercises').delete().eq('id', exId).eq('user_id', userId)
          )
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
      const exercise: Exercise = { id, name: trimmed, tags: [...tags], sets: [], updated_at: new Date().toISOString(), ...(!sync ? { sample: true } : {}) }
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
      if (exercise.sample) this._adoptExercise(exercise)
      exercise.inputMode = mode
      exercise.updated_at = new Date().toISOString()
      this._persist()

      if (supabase && this._userId) {
        const userId = this._userId
        const { name, tags, inputMode, barWeight } = exercise
        syncQueue.enqueue(`exercise:${exerciseId}`, () =>
          supabase!.from('exercises').upsert({
            id: exerciseId, user_id: userId, name, tags,
            ...(inputMode ? { input_mode: inputMode } : {}), ...(barWeight != null ? { bar_weight: barWeight } : {})
          })
        )
      }
    },

    logSet(exerciseId: string, weight: number, reps: number, dateStr?: string, { sync = true }: { sync?: boolean } = {}) {
      const exercise = this.exercises.find((e: Exercise) => e.id === exerciseId)
      if (!exercise) return
      // Real user action on a sample exercise adopts it (makes it syncable)
      if (sync && exercise.sample) this._adoptExercise(exercise)
      const date = dateStr
        ? endOfDayISO(dateStr)
        : new Date().toISOString()
      const id = uuid()
      const estimated1RM = epley(weight, reps)
      exercise.sets.push({ id, date, weight, reps, estimated1RM })
      exercise.updated_at = new Date().toISOString()
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
      if (exercise.sample) this._adoptExercise(exercise)
      set.weight = weight
      set.reps = reps
      set.estimated1RM = epley(weight, reps)
      if (dateStr) {
        set.date = endOfDayISO(dateStr)
      }
      exercise.updated_at = new Date().toISOString()
      this._persist()

      if (supabase && this._userId) {
        const userId = this._userId
        syncQueue.enqueue(`set:${setId}`, () =>
          supabase!.from('sets').upsert({
            id: setId, user_id: userId, exercise_id: exerciseId,
            date: set.date, weight: set.weight, reps: set.reps,
            estimated_1rm: set.estimated1RM
          })
        )
      }
    },

    deleteSet(exerciseId: string, setId: string, { sync = true }: { sync?: boolean } = {}) {
      const exercise = this.exercises.find((e: Exercise) => e.id === exerciseId)
      if (!exercise) return
      addTombstone('sets', setId)
      exercise.sets = exercise.sets.filter((s: WorkoutSet) => s.id !== setId)
      exercise.updated_at = new Date().toISOString()
      this._persist()

      if (sync && supabase && !isPreviewMode.value && this._userId) {
        const userId = this._userId
        syncQueue.enqueue(`set:${setId}`, () =>
          supabase!.from('sets').delete().eq('id', setId).eq('user_id', userId)
        )
      }
    },

    restoreSet(exerciseId: string, set: WorkoutSet) {
      const exercise = this.exercises.find((e: Exercise) => e.id === exerciseId)
      if (!exercise) return
      removeTombstone('sets', set.id)
      exercise.sets.push(set)
      this._persist()
    },

    renameExercise(exerciseId: string, newName: string) {
      const trimmed = newName.trim()
      if (!trimmed) return
      const exercise = this.exercises.find((e: Exercise) => e.id === exerciseId)
      if (!exercise) return
      if (exercise.sample) this._adoptExercise(exercise)
      exercise.name = trimmed
      exercise.updated_at = new Date().toISOString()
      this._persist()

      if (supabase && this._userId) {
        const userId = this._userId
        const { name: n, tags: t, inputMode, barWeight } = exercise
        syncQueue.enqueue(`exercise:${exerciseId}`, () =>
          supabase!.from('exercises').upsert({
            id: exerciseId, user_id: userId, name: n, tags: t,
            ...(inputMode ? { input_mode: inputMode } : {}), ...(barWeight != null ? { bar_weight: barWeight } : {})
          })
        )
      }
    },

    updateExerciseTags(exerciseId: string, tags: string[]) {
      const exercise = this.exercises.find((e: Exercise) => e.id === exerciseId)
      if (!exercise) return
      if (exercise.sample) this._adoptExercise(exercise)
      exercise.tags = [...tags]
      exercise.updated_at = new Date().toISOString()
      this._persist()

      if (supabase && this._userId) {
        const userId = this._userId
        const { name, inputMode, barWeight } = exercise
        const tagsCopy = [...tags]
        syncQueue.enqueue(`exercise:${exerciseId}`, () =>
          supabase!.from('exercises').upsert({
            id: exerciseId, user_id: userId, name, tags: tagsCopy,
            ...(inputMode ? { input_mode: inputMode } : {}), ...(barWeight != null ? { bar_weight: barWeight } : {})
          })
        )
      }
    },

    deleteExercise(exerciseId: string, { sync = true }: { sync?: boolean } = {}) {
      const idx = this.exercises.findIndex((e: Exercise) => e.id === exerciseId)
      if (idx === -1) return
      addTombstone(TOMBSTONE_STORE, exerciseId)
      this.exercises.splice(idx, 1)
      this._persist()

      if (sync && supabase && !isPreviewMode.value && this._userId) {
        const userId = this._userId
        syncQueue.enqueue(`exercise-sets:${exerciseId}`, () =>
          supabase!.from('sets').delete().eq('exercise_id', exerciseId).eq('user_id', userId)
        )
        syncQueue.enqueue(`exercise:${exerciseId}`, () =>
          supabase!.from('exercises').delete().eq('id', exerciseId).eq('user_id', userId)
        )
      }
    },

    restoreExercise(exercise: Exercise, atIndex?: number) {
      removeTombstone(TOMBSTONE_STORE, exercise.id)
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
        syncQueue.enqueue(`set:${setId}`, () =>
          supabase!.from('sets').delete().eq('id', setId).eq('user_id', userId)
        )
      }
    },

    syncDeleteExercise(exerciseId: string) {
      if (supabase && this._userId) {
        const userId = this._userId
        syncQueue.enqueue(`exercise-sets:${exerciseId}`, () =>
          supabase!.from('sets').delete().eq('exercise_id', exerciseId).eq('user_id', userId)
        )
        syncQueue.enqueue(`exercise:${exerciseId}`, () =>
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
      const modified: Exercise[] = []
      this.exercises.forEach((e: Exercise) => {
        const idx = e.tags.indexOf(oldName)
        if (idx !== -1) {
          if (e.tags.includes(trimmed)) {
            e.tags.splice(idx, 1)
          } else {
            e.tags[idx] = trimmed
          }
          e.updated_at = new Date().toISOString()
          modified.push(e)
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

      if (this._userId && modified.length > 0) {
        const userId = this._userId
        for (const e of modified.filter(e => !e.sample)) {
          const { name, tags, inputMode, barWeight } = e
          syncQueue.enqueue(`exercise:${e.id}`, () =>
            supabase!.from('exercises').upsert({
              id: e.id, user_id: userId, name, tags: [...tags],
              ...(inputMode ? { input_mode: inputMode } : {}), ...(barWeight != null ? { bar_weight: barWeight } : {})
            })
          )
        }
      }
    },

    deleteTag(tagName: string) {
      const modified: Exercise[] = []
      this.exercises.forEach((e: Exercise) => {
        const idx = e.tags.indexOf(tagName)
        if (idx !== -1) {
          e.tags.splice(idx, 1)
          e.updated_at = new Date().toISOString()
          modified.push(e)
        }
      })
      this.customTags = this.customTags.filter(t => t !== tagName)
      this._persist()

      if (this._userId && modified.length > 0) {
        const userId = this._userId
        for (const e of modified.filter(e => !e.sample)) {
          const { name, tags, inputMode, barWeight } = e
          syncQueue.enqueue(`exercise:${e.id}`, () =>
            supabase!.from('exercises').upsert({
              id: e.id, user_id: userId, name, tags: [...tags],
              ...(inputMode ? { input_mode: inputMode } : {}), ...(barWeight != null ? { bar_weight: barWeight } : {})
            })
          )
        }
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
