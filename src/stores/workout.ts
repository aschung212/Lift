import { defineStore } from 'pinia'
import { supabase, isPreviewMode } from '../lib/supabase'
import { syncQueue } from '../lib/syncQueue'
import { backupToIDB } from '../lib/durableStorage'
import { mergeEntities } from '../lib/conflictResolver'
import { uuid, endOfDayISO } from '../lib/uuid'
import { logError, logWarn } from '../lib/logger'
import { addTombstone, removeTombstone, isTombstoned, cleanupTombstones } from '../lib/tombstones'
import { epley } from '../lib/epley'

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

/**
 * Deduplicate exercises by name (case-insensitive).
 * For each group of exercises with the same name, keeps the one with
 * the most sets as primary and merges all other sets into it.
 */
/**
 * Deduplicate sets within an exercise by exact content (full date + weight + reps).
 * Uses the full ISO timestamp so jitter-differentiated sets are preserved —
 * this protects programs like 5x5 where the same weight/reps is logged
 * multiple times. Only catches exact timestamp collisions (e.g., old fixed
 * T23:59:59.000Z format or truly identical entries).
 */
export function deduplicateSets(sets: WorkoutSet[]): { unique: WorkoutSet[]; removedIds: string[] } {
  const seen = new Map<string, string>()
  const unique: WorkoutSet[] = []
  const removedIds: string[] = []
  for (const set of sets) {
    const key = `${set.date}|${set.weight}|${set.reps}`
    if (!seen.has(key)) {
      seen.set(key, set.id)
      unique.push(set)
    } else {
      removedIds.push(set.id)
    }
  }
  return { unique, removedIds }
}

/**
 * One-time cleanup for triplicate sync artifacts. Groups end-of-day sets
 * by (day + weight + reps) and keeps only one per group. Real-time sets
 * are never touched. Runs once and sets a localStorage flag.
 */

export function deduplicateByName(exercises: Exercise[]): { exercises: Exercise[]; removed: Exercise[] } {
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
    // Uses day-level date (YYYY-MM-DD) for content keys so jitter timestamps
    // don't prevent dedup. This is safe here because duplicate exercises are
    // copies of the same workout data from different sync sources — sets
    // from the dupe represent the same logged sets, not additional ones.
    const setIds = new Set(primary.sets.map(s => s.id))
    const setContentKeys = new Set(primary.sets.map(s => `${s.date.slice(0, 10)}|${s.weight}|${s.reps}`))
    for (let i = 1; i < group.length; i++) {
      for (const set of group[i].sets) {
        const contentKey = `${set.date.slice(0, 10)}|${set.weight}|${set.reps}`
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
    // Re-sort merged sets by day. Use only the date portion (YYYY-MM-DD)
    // because endOfDayISO adds random seconds/ms jitter — sorting by full
    // timestamp would randomly shuffle same-day sets. JS sort is stable,
    // so same-day sets preserve their array insertion order (= logged order).
    primary.sets.sort((a, b) => a.date.slice(0, 10).localeCompare(b.date.slice(0, 10)))
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
    tagRecoveryDays: JSON.parse(localStorage.getItem('lift-tag-recovery-days') || '{}') as Record<string, number>,
    tagRecoveryExcluded: JSON.parse(localStorage.getItem('lift-tag-recovery-excluded') || '[]') as string[],
    _userId: null as string | null
  }),

  actions: {
    _persist() {
      const data = JSON.stringify(this.exercises)
      try {
        localStorage.setItem(STORAGE_KEY, data)
        localStorage.setItem('lift-custom-tags', JSON.stringify(this.customTags))
        localStorage.setItem('lift-tag-recovery-days', JSON.stringify(this.tagRecoveryDays))
        localStorage.setItem('lift-tag-recovery-excluded', JSON.stringify(this.tagRecoveryExcluded))
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
        supabase.from('exercises').select('*').eq('user_id', this._userId).is('deleted_at', null).order('created_at'),
        supabase.from('sets').select('*').eq('user_id', this._userId).is('deleted_at', null).order('created_at')
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
        if (ex.bar_weight != null) exercise.barWeight = ex.bar_weight as number
        return exercise
      })

      // Build remote sets grouped by exercise, filtering tombstoned sets
      const remoteSetIds = new Set((sets || []).map((s: Record<string, unknown>) => s.id as string))
      cleanupTombstones('sets', remoteSetIds)
      const remoteSetsMap = new Map<string, WorkoutSet[]>()
      for (const s of (sets || []) as Record<string, unknown>[]) {
        if (isTombstoned('sets', s.id as string)) {
          // Re-enqueue the soft-delete for tombstoned sets still visible on remote
          const setId = s.id as string
          const userId = this._userId
          const deletedAt = new Date().toISOString()
          syncQueue.enqueueDelete(`set:${setId}`, () =>
            supabase!.from('sets')
              .update({ deleted_at: deletedAt })
              .eq('id', setId).eq('user_id', userId)
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

      // Merge sets by ID for exercises that exist in both local and remote.
      // mergeEntities picks one exercise wholesale (last-write-wins), but
      // the losing side may have sets the winning side doesn't. Union them
      // by set ID so no sets are lost during sync.
      const localExMap = new Map(localWithTimestamps.map(e => [e.id, e]))
      const remoteExMap = new Map(remoteExercises.map(e => [e.id, e]))
      for (const ex of merged) {
        const localEx = localExMap.get(ex.id)
        const remoteEx = remoteExMap.get(ex.id)
        if (localEx && remoteEx) {
          const setIds = new Set(ex.sets.map(s => s.id))
          const otherSets = (ex === localEx || ex.updated_at === localEx.updated_at) ? remoteEx.sets : localEx.sets
          let merged = false
          for (const set of otherSets) {
            if (!setIds.has(set.id) && !isTombstoned('sets', set.id)) {
              ex.sets.push(set)
              setIds.add(set.id)
              merged = true
            }
          }
          if (merged) {
            ex.sets.sort((a, b) => a.date.slice(0, 10).localeCompare(b.date.slice(0, 10)))
          }
        }
      }

      // Deduplicate exercises by name (case-insensitive) for LOCAL display only.
      // Two devices can create exercises with the same name but different UUIDs;
      // this merges them into a single row in the local state so the UI doesn't
      // show duplicates. We intentionally do NOT push deletes or reassignments
      // to Supabase here — the client has no authority to mutate server data
      // based on dedup heuristics. Server-side cleanup should be done via a
      // controlled one-time SQL migration, not ambient client behavior.
      // See incident 2026-04-12 (SEV1): pushing client-dedup deletes to the
      // server destroyed user data when (date|weight|reps) collided across
      // same-named exercises. The fix is to keep dedup strictly local.
      const deduped = deduplicateByName(merged as Exercise[])

      // Deduplicate sets within each exercise for LOCAL display only.
      // Legacy pre-jitter timestamps (T12:00:00 noon-local, T23:59:59 fixed)
      // cause identical (date|weight|reps) tuples for straight-set programs
      // like 5x5. We collapse those for local rendering but do NOT push
      // deletes — the server is the source of truth. See incident 2026-04-12.
      for (const ex of deduped.exercises) {
        const { unique } = deduplicateSets(ex.sets)
        ex.sets = unique
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
      // Only push exercise metadata + sets that don't already exist in remote.
      // Previously this pushed ALL sets for every localWins exercise, causing
      // rate-limit storms (500+ operations on every sync).
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
          // Only push sets that are new or have changed content (offline edits)
          const remoteSets = new Map(
            (remoteExMap.get(ex.id)?.sets || []).map(s => [s.id, s])
          )
          for (const set of ex.sets) {
            const remote = remoteSets.get(set.id)
            const needsPush = !remote
              || remote.weight !== set.weight
              || remote.reps !== set.reps
              || remote.date !== set.date
            if (needsPush) {
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
      }

      // Process active tombstones: ensure pending deletes are synced
      const tombstoneExercises = exercises
        .filter((ex: Record<string, unknown>) => isTombstoned(TOMBSTONE_STORE, ex.id as string))
      if (tombstoneExercises.length > 0) {
        const userId = this._userId
        const deletedAt = new Date().toISOString()
        for (const ex of tombstoneExercises) {
          const exId = ex.id as string
          syncQueue.enqueueDelete(`exercise-sets:${exId}`, () =>
            supabase!.from('sets')
              .update({ deleted_at: deletedAt })
              .eq('exercise_id', exId).eq('user_id', userId)
          )
          syncQueue.enqueueDelete(`exercise:${exId}`, () =>
            supabase!.from('exercises')
              .update({ deleted_at: deletedAt })
              .eq('id', exId).eq('user_id', userId)
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
        const userId = this._userId
        syncQueue.enqueue(`exercise:${id}`, () =>
          supabase!.from('exercises').upsert({
            id, user_id: userId, name: trimmed, tags: [...tags]
          })
        )
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
      // Real user action on a sample exercise adopts it (makes it syncable).
      // _adoptExercise pushes via syncQueue, so we must also use syncQueue for
      // the new set to avoid FK violations from the set arriving before the exercise.
      const wasAdopted = sync && !!exercise.sample
      if (wasAdopted) this._adoptExercise(exercise)
      const date = dateStr
        ? endOfDayISO(dateStr)
        : new Date().toISOString()
      const id = uuid()
      const estimated1RM = epley(weight, reps)
      exercise.sets.push({ id, date, weight, reps, estimated1RM })
      exercise.updated_at = new Date().toISOString()
      this._persist()

      if (sync && supabase && !isPreviewMode.value && this._userId) {
        if (wasAdopted) {
          // Use syncQueue so this set is batched with the exercise creation
          const userId = this._userId
          syncQueue.enqueue(`set:${id}`, () =>
            supabase!.from('sets').upsert({
              id, user_id: userId, exercise_id: exerciseId,
              date, weight, reps, estimated_1rm: estimated1RM
            })
          )
        } else {
          const userId = this._userId
          syncQueue.enqueue(`set:${id}`, () =>
            supabase!.from('sets').upsert({
              id, user_id: userId, exercise_id: exerciseId,
              date, weight, reps, estimated_1rm: estimated1RM
            })
          )
        }
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
        const deletedAt = new Date().toISOString()
        syncQueue.enqueueDelete(`set:${setId}`, () =>
          supabase!.from('sets')
            .update({ deleted_at: deletedAt })
            .eq('id', setId).eq('user_id', userId)
        )
      }
    },

    restoreSet(exerciseId: string, set: WorkoutSet) {
      const exercise = this.exercises.find((e: Exercise) => e.id === exerciseId)
      if (!exercise) return
      removeTombstone('sets', set.id)
      exercise.sets.push(set)
      this._persist()

      // Soft-delete restore: clear deleted_at on server. Uses the same key as
      // deleteSet so an in-flight delete is superseded (last-write-wins). If
      // the delete already flushed, this un-soft-deletes the row.
      if (supabase && !isPreviewMode.value && this._userId) {
        const userId = this._userId
        syncQueue.enqueue(`set:${set.id}`, () =>
          supabase!.from('sets')
            .update({ deleted_at: null })
            .eq('id', set.id).eq('user_id', userId)
        )
      }
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
        const deletedAt = new Date().toISOString()
        syncQueue.enqueueDelete(`exercise-sets:${exerciseId}`, () =>
          supabase!.from('sets')
            .update({ deleted_at: deletedAt })
            .eq('exercise_id', exerciseId).eq('user_id', userId)
        )
        syncQueue.enqueueDelete(`exercise:${exerciseId}`, () =>
          supabase!.from('exercises')
            .update({ deleted_at: deletedAt })
            .eq('id', exerciseId).eq('user_id', userId)
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

      // Soft-delete restore: clear deleted_at on both the exercise and its sets.
      // Uses the same keys as deleteExercise so in-flight deletes are superseded.
      // If the delete already flushed, these un-soft-delete.
      //
      // Note: restoring sets by exercise_id will also resurrect sets that were
      // individually soft-deleted before the exercise delete. Edge case; the
      // alternative (tracking per-cascade timestamps) is complexity without
      // matching benefit for immediate-undo UX.
      if (supabase && !isPreviewMode.value && this._userId) {
        const userId = this._userId
        syncQueue.enqueue(`exercise-sets:${exercise.id}`, () =>
          supabase!.from('sets')
            .update({ deleted_at: null })
            .eq('exercise_id', exercise.id).eq('user_id', userId)
        )
        syncQueue.enqueue(`exercise:${exercise.id}`, () =>
          supabase!.from('exercises')
            .update({ deleted_at: null })
            .eq('id', exercise.id).eq('user_id', userId)
        )
      }
    },

    syncDeleteSet(setId: string) {
      if (supabase && this._userId) {
        const userId = this._userId
        const deletedAt = new Date().toISOString()
        syncQueue.enqueueDelete(`set:${setId}`, () =>
          supabase!.from('sets')
            .update({ deleted_at: deletedAt })
            .eq('id', setId).eq('user_id', userId)
        )
      }
    },

    syncDeleteExercise(exerciseId: string) {
      if (supabase && this._userId) {
        const userId = this._userId
        const deletedAt = new Date().toISOString()
        syncQueue.enqueueDelete(`exercise-sets:${exerciseId}`, () =>
          supabase!.from('sets')
            .update({ deleted_at: deletedAt })
            .eq('exercise_id', exerciseId).eq('user_id', userId)
        )
        syncQueue.enqueueDelete(`exercise:${exerciseId}`, () =>
          supabase!.from('exercises')
            .update({ deleted_at: deletedAt })
            .eq('id', exerciseId).eq('user_id', userId)
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
      if (oldName in this.tagRecoveryDays) {
        const days = this.tagRecoveryDays[oldName]
        delete this.tagRecoveryDays[oldName]
        if (!(trimmed in this.tagRecoveryDays)) {
          this.tagRecoveryDays[trimmed] = days
        }
      }
      const exclIdx = this.tagRecoveryExcluded.indexOf(oldName)
      if (exclIdx !== -1) {
        if (!this.tagRecoveryExcluded.includes(trimmed)) {
          this.tagRecoveryExcluded[exclIdx] = trimmed
        } else {
          this.tagRecoveryExcluded.splice(exclIdx, 1)
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
      delete this.tagRecoveryDays[tagName]
      this.tagRecoveryExcluded = this.tagRecoveryExcluded.filter(t => t !== tagName)
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

    setTagRecoveryDays(tag: string, days: number | null) {
      if (days === null || days <= 0) {
        delete this.tagRecoveryDays[tag]
      } else {
        this.tagRecoveryDays[tag] = days
      }
      this._persist()
    },

    setTagRecoveryExcluded(tag: string, excluded: boolean) {
      const idx = this.tagRecoveryExcluded.indexOf(tag)
      if (excluded && idx === -1) {
        this.tagRecoveryExcluded.push(tag)
      } else if (!excluded && idx !== -1) {
        this.tagRecoveryExcluded.splice(idx, 1)
      }
      this._persist()
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

    /**
     * Max estimated1RM across all sets for an exercise.
     * When `sinceDate` (YYYY-MM-DD) is provided, only sets on or after that
     * date are considered. Default (undefined/null) preserves legacy
     * all-time behavior.
     */
    getExercisePR: (state) => (exerciseId: string, sinceDate?: string | null): number => {
      const exercise = state.exercises.find((e: Exercise) => e.id === exerciseId)
      if (!exercise || exercise.sets.length === 0) return 0
      const filtered = sinceDate
        ? exercise.sets.filter((s: WorkoutSet) => s.date.slice(0, 10) >= sinceDate)
        : exercise.sets
      if (filtered.length === 0) return 0
      return Math.max(...filtered.map((s: WorkoutSet) => s.estimated1RM))
    },

    /**
     * The single set that achieved the max estimated1RM.
     * Respects `sinceDate` like getExercisePR.
     */
    getExercisePRSet: (state) => (exerciseId: string, sinceDate?: string | null): WorkoutSet | null => {
      const exercise = state.exercises.find((e: Exercise) => e.id === exerciseId)
      if (!exercise || exercise.sets.length === 0) return null
      const filtered = sinceDate
        ? exercise.sets.filter((s: WorkoutSet) => s.date.slice(0, 10) >= sinceDate)
        : exercise.sets
      if (filtered.length === 0) return null
      return filtered.reduce((best: WorkoutSet, s: WorkoutSet) =>
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
