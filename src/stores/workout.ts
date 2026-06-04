import { defineStore } from 'pinia'
import { shallowRef, triggerRef, computed } from 'vue'
import { supabase, isPreviewMode } from '../lib/supabase'
import type { Tables } from '../lib/database.types'
import { syncQueue } from '../lib/syncQueue'
import { backupToIDB } from '../lib/durableStorage'
import { mergeEntities } from '../lib/conflictResolver'
import { uuid, endOfDayISO } from '../lib/uuid'
import { logError, logWarn } from '../lib/logger'
import { addTombstone, removeTombstone, isTombstoned, cleanupTombstones } from '../lib/tombstones'
import { epley } from '../lib/epley'
import { broadcastStoreUpdate } from '../lib/crossTabSync'

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
  archived_at?: string             // ISO 8601, soft-hide from main list; data is preserved
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

export const useWorkoutStore = defineStore('workout', () => {
  // ── State ──────────────────────────────────────────────────────────
  // shallowRef: Vue only tracks .value identity, not nested properties.
  // This avoids wrapping thousands of set objects in Proxy (5,000+ for heavy users).
  // Trade-off: every mutation must call triggerRef(exercises) to notify watchers.
  const exercises = shallowRef<Exercise[]>(load())
  const customTags = shallowRef<string[]>(JSON.parse(localStorage.getItem('lift-custom-tags') || '[]'))
  const tagRecoveryDays = shallowRef<Record<string, number>>(JSON.parse(localStorage.getItem('lift-tag-recovery-days') || '{}'))
  const tagRecoveryExcluded = shallowRef<string[]>(JSON.parse(localStorage.getItem('lift-tag-recovery-excluded') || '[]'))
  let _userId: string | null = null

  // ── Persistence ────────────────────────────────────────────────────
  function _persist() {
    const data = JSON.stringify(exercises.value)
    try {
      localStorage.setItem(STORAGE_KEY, data)
      localStorage.setItem('lift-custom-tags', JSON.stringify(customTags.value))
      localStorage.setItem('lift-tag-recovery-days', JSON.stringify(tagRecoveryDays.value))
      localStorage.setItem('lift-tag-recovery-excluded', JSON.stringify(tagRecoveryExcluded.value))
    } catch (e) {
      logError(e, { source: 'workout._persist', size: data.length })
    }
    backupToIDB(STORAGE_KEY, data)
    broadcastStoreUpdate('workout')
  }

  /** Re-read state from localStorage (called by cross-tab sync listener). */
  function _reloadFromStorage() {
    exercises.value = load()
    try {
      customTags.value = JSON.parse(localStorage.getItem('lift-custom-tags') || '[]')
      tagRecoveryDays.value = JSON.parse(localStorage.getItem('lift-tag-recovery-days') || '{}')
      tagRecoveryExcluded.value = JSON.parse(localStorage.getItem('lift-tag-recovery-excluded') || '[]')
    } catch { /* ignore corrupt data */ }
    triggerRef(exercises)
    triggerRef(customTags)
    triggerRef(tagRecoveryDays)
    triggerRef(tagRecoveryExcluded)
  }

  // ── Internal helpers ─────────────────────────────────────────────
  /**
   * Build a comprehensive upsert payload for an exercise row.
   *
   * Always include every mutable column the client owns — including
   * `archived_at` — so that the sync queue's dedup-by-key behavior cannot
   * accidentally drop archival state. (The queue collapses repeated
   * `exercise:${id}` enqueues into the last one; a partial payload from a
   * later rename would otherwise silently clear archived_at on the server.)
   */
  function _buildExerciseUpsert(exercise: Exercise, userId: string) {
    return {
      id: exercise.id,
      user_id: userId,
      name: exercise.name,
      tags: exercise.tags,
      archived_at: exercise.archived_at ?? null,
      ...(exercise.inputMode ? { input_mode: exercise.inputMode } : {}),
      ...(exercise.barWeight != null ? { bar_weight: exercise.barWeight } : {}),
    }
  }

  /** Clear sample flag and push exercise + all its sets to Supabase. */
  function _adoptExercise(exercise: Exercise) {
    delete exercise.sample
    if (supabase && !isPreviewMode.value && _userId) {
      const userId = _userId
      _enqueueExerciseUpsert(exercise, userId)
      for (const set of exercise.sets) {
        _enqueueSetUpsert(set, exercise.id, userId)
      }
    }
  }

  /**
   * Durable exercise upsert. Builds the row once and journals a serializable
   * descriptor alongside the closure so the write survives a reload (LIFT-706).
   */
  function _enqueueExerciseUpsert(exercise: Exercise, userId: string) {
    const row = _buildExerciseUpsert(exercise, userId)
    syncQueue.enqueue(
      `exercise:${exercise.id}`,
      () => supabase!.from('exercises').upsert(row),
      { op: 'upsert', table: 'exercises', row },
    )
  }

  /** Durable set upsert with a journaled descriptor (LIFT-706). */
  function _enqueueSetUpsert(
    set: { id: string; date: string; weight: number; reps: number; estimated1RM: number },
    exerciseId: string,
    userId: string,
  ) {
    const row = {
      id: set.id, user_id: userId, exercise_id: exerciseId,
      date: set.date, weight: set.weight, reps: set.reps,
      estimated_1rm: set.estimated1RM,
    }
    syncQueue.enqueue(
      `set:${set.id}`,
      () => supabase!.from('sets').upsert(row),
      { op: 'upsert', table: 'sets', row },
    )
  }

  /**
   * Durable soft-delete (UPDATE { deleted_at }). Routed through enqueueDelete
   * so the circuit breaker sees it, with a journaled descriptor (LIFT-706).
   */
  function _enqueueSoftDelete(key: string, table: 'sets' | 'exercises', match: Record<string, string>) {
    const deletedAt = new Date().toISOString()
    const values = { deleted_at: deletedAt }
    syncQueue.enqueueDelete(
      key,
      () => {
        let q = supabase!.from(table).update(values)
        for (const [col, val] of Object.entries(match)) q = q.eq(col, val)
        return q
      },
      { op: 'update', table, values, match },
    )
  }

  /** Durable soft-delete restore (UPDATE { deleted_at: null }) (LIFT-706). */
  function _enqueueRestore(key: string, table: 'sets' | 'exercises', match: Record<string, string>) {
    const values = { deleted_at: null }
    syncQueue.enqueue(
      key,
      () => {
        let q = supabase!.from(table).update(values)
        for (const [col, val] of Object.entries(match)) q = q.eq(col, val)
        return q
      },
      { op: 'update', table, values, match },
    )
  }

  // ── Actions ────────────────────────────────────────────────────────
  async function init(userId: string) {
    _userId = userId
    await _fetchFromSupabase()
  }

  async function _fetchFromSupabase() {
    if (!supabase || !_userId) return

    let remoteExData: Tables<'exercises'>[] | null
    let sets: Tables<'sets'>[] | null
    try {
      const [exResult, setsResult] = await Promise.all([
        supabase.from('exercises').select('*').eq('user_id', _userId).is('deleted_at', null).order('created_at'),
        supabase.from('sets').select('*').eq('user_id', _userId).is('deleted_at', null).order('created_at')
      ])
      if (exResult.error || setsResult.error) {
        logWarn('Supabase fetch failed in workout store — using local data', {
          exerciseError: String(exResult.error),
          setsError: String(setsResult.error),
        })
        return
      }
      remoteExData = exResult.data
      sets = setsResult.data
    } catch (err) {
      logWarn('Supabase fetch failed in workout store — using local data', { error: String(err) })
      return
    }

    if (!remoteExData || !sets) return

    // Filter out tombstoned exercises (deleted offline, not yet synced)
    const remoteIds = new Set(remoteExData.map(ex => ex.id))
    cleanupTombstones(TOMBSTONE_STORE, remoteIds)
    const filteredExercises = remoteExData.filter(
      ex => !isTombstoned(TOMBSTONE_STORE, ex.id)
    )

    const remoteExercises = filteredExercises.map(ex => {
      const exercise: Exercise = {
        id: ex.id,
        name: ex.name,
        tags: ex.tags || [],
        updated_at: ex.updated_at || ex.created_at || new Date().toISOString(),
        sets: [] as WorkoutSet[],
      }
      if (ex.input_mode) exercise.inputMode = ex.input_mode as ExerciseInputMode
      if (ex.bar_weight != null) exercise.barWeight = ex.bar_weight
      if (ex.archived_at) exercise.archived_at = ex.archived_at
      return exercise
    })

    // Build remote sets grouped by exercise, filtering tombstoned sets
    const remoteSetIds = new Set(sets.map(s => s.id))
    cleanupTombstones('sets', remoteSetIds)
    const remoteSetsMap = new Map<string, WorkoutSet[]>()
    for (const s of sets) {
      if (isTombstoned('sets', s.id)) {
        // Re-enqueue the soft-delete for tombstoned sets still visible on remote
        _enqueueSoftDelete(`set:${s.id}`, 'sets', { id: s.id, user_id: _userId })
        continue
      }
      const exerciseId = s.exercise_id
      if (!remoteSetsMap.has(exerciseId)) remoteSetsMap.set(exerciseId, [])
      remoteSetsMap.get(exerciseId)!.push({
        id: s.id,
        date: s.date,
        weight: s.weight,
        reps: s.reps,
        estimated1RM: s.estimated_1rm
      })
    }
    remoteExercises.forEach(ex => {
      ex.sets = remoteSetsMap.get(ex.id) || []
    })

    // Merge with local state using last-write-wins conflict resolution
    // (#1 fix: local exercises now carry updated_at from mutations)
    const localWithTimestamps = exercises.value.map(ex => ({
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
        let setsMerged = false
        for (const set of otherSets) {
          if (!setIds.has(set.id) && !isTombstoned('sets', set.id)) {
            ex.sets.push(set)
            setIds.add(set.id)
            setsMerged = true
          }
        }
        if (setsMerged) {
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

    exercises.value = deduped.exercises
    triggerRef(exercises)
    _persist()

    // Push local-only exercises to remote
    // (#3 fix: filter localOnly to exclude exercises removed by dedup)
    // (#232 fix: skip sample exercises — they were created with sync:false during onboarding)
    const survivingIds = new Set(deduped.exercises.map(e => e.id))
    const filteredLocalOnly = localOnly.filter(e => survivingIds.has(e.id) && !e.sample)
    if (filteredLocalOnly.length > 0) {
      const userId = _userId
      for (const ex of filteredLocalOnly) {
        _enqueueExerciseUpsert(ex, userId)
        for (const set of ex.sets) {
          _enqueueSetUpsert(set, ex.id, userId)
        }
      }
    }

    // Push local-wins back to Supabase (offline edits that beat remote timestamps)
    // Only push exercise metadata + sets that don't already exist in remote.
    // Previously this pushed ALL sets for every localWins exercise, causing
    // rate-limit storms (500+ operations on every sync).
    const filteredLocalWins = localWins.filter(e => survivingIds.has(e.id) && !e.sample)
    if (filteredLocalWins.length > 0) {
      const userId = _userId
      for (const ex of filteredLocalWins) {
        _enqueueExerciseUpsert(ex, userId)
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
            _enqueueSetUpsert(set, ex.id, userId)
          }
        }
      }
    }

    // Reconciliation gap (LIFT-706): when a DIFFERENT device updated an
    // exercise after this device added sets to it offline, the remote copy
    // WINS the last-write-wins merge — so the exercise is neither localOnly
    // nor localWins. Its offline-added sets are unioned into local state above
    // (so they render), but the old push logic only covered localOnly/localWins
    // exercises, leaving those sets stranded locally and silently diverged from
    // the server. Push any local set on a both-sides exercise that the remote
    // doesn't have (and isn't tombstoned). Idempotent upsert + key dedup makes
    // overlap with the pushes above harmless.
    {
      const userId = _userId
      const alreadyPushedIds = new Set([
        ...filteredLocalOnly.map(e => e.id),
        ...filteredLocalWins.map(e => e.id),
      ])
      for (const ex of deduped.exercises) {
        if (ex.sample || alreadyPushedIds.has(ex.id)) continue
        // Only both-sides exercises reach here; localOnly/localWins are handled
        // above. Use the pre-merge `remoteSetIds` snapshot — the union step
        // mutates remote exercises' `.sets` arrays in place, so checking
        // `remoteEx.sets` here would wrongly treat the just-unioned local set
        // as already present on the server.
        if (!remoteExMap.has(ex.id)) continue
        for (const set of ex.sets) {
          if (remoteSetIds.has(set.id) || isTombstoned('sets', set.id)) continue
          _enqueueSetUpsert(set, ex.id, userId)
        }
      }
    }

    // Process active tombstones: ensure pending deletes are synced
    const tombstoneExercises = remoteExData
      .filter(ex => isTombstoned(TOMBSTONE_STORE, ex.id))
    if (tombstoneExercises.length > 0) {
      const userId = _userId
      for (const ex of tombstoneExercises) {
        _enqueueSoftDelete(`exercise-sets:${ex.id}`, 'sets', { exercise_id: ex.id, user_id: userId })
        _enqueueSoftDelete(`exercise:${ex.id}`, 'exercises', { id: ex.id, user_id: userId })
      }
    }
  }

  function addExercise(name: string, tags: string[] = [], { sync = true }: { sync?: boolean } = {}): string | null {
    const trimmed = name.trim()
    if (!trimmed) return null
    const existing = exercises.value.find(
      (e: Exercise) => e.name.toLowerCase() === trimmed.toLowerCase()
    )
    if (existing) return existing.id
    const id = uuid()
    const exercise: Exercise = { id, name: trimmed, tags: [...tags], sets: [], updated_at: new Date().toISOString(), ...(!sync ? { sample: true } : {}) }
    exercises.value.push(exercise)
    triggerRef(exercises)
    _persist()

    if (sync && supabase && !isPreviewMode.value && _userId) {
      _enqueueExerciseUpsert(exercise, _userId)
    }
    return id
  }

  function setExercisePlateCountMode(exerciseId: string, mode: PlateCountMode) {
    const exercise = exercises.value.find((e: Exercise) => e.id === exerciseId)
    if (!exercise) return
    exercise.plateCountMode = mode
    triggerRef(exercises)
    _persist()
  }

  function setExerciseBarWeight(exerciseId: string, barWeight: number) {
    const exercise = exercises.value.find((e: Exercise) => e.id === exerciseId)
    if (!exercise) return
    if (exercise.sample) _adoptExercise(exercise)
    exercise.barWeight = barWeight
    exercise.updated_at = new Date().toISOString()
    triggerRef(exercises)
    _persist()

    if (supabase && _userId) {
      _enqueueExerciseUpsert(exercise, _userId)
    }
  }

  function setExerciseInputMode(exerciseId: string, mode: ExerciseInputMode) {
    const exercise = exercises.value.find((e: Exercise) => e.id === exerciseId)
    if (!exercise) return
    if (exercise.sample) _adoptExercise(exercise)
    exercise.inputMode = mode
    exercise.updated_at = new Date().toISOString()
    triggerRef(exercises)
    _persist()

    if (supabase && _userId) {
      _enqueueExerciseUpsert(exercise, _userId)
    }
  }

  function logSet(exerciseId: string, weight: number, reps: number, dateStr?: string, { sync = true }: { sync?: boolean } = {}) {
    const exercise = exercises.value.find((e: Exercise) => e.id === exerciseId)
    if (!exercise) return
    // Real user action on a sample exercise adopts it (makes it syncable).
    // _adoptExercise pushes via syncQueue, so we must also use syncQueue for
    // the new set to avoid FK violations from the set arriving before the exercise.
    const wasAdopted = sync && !!exercise.sample
    if (wasAdopted) _adoptExercise(exercise)
    const date = dateStr
      ? endOfDayISO(dateStr)
      : new Date().toISOString()
    const id = uuid()
    const estimated1RM = epley(weight, reps)
    exercise.sets.push({ id, date, weight, reps, estimated1RM })
    exercise.updated_at = new Date().toISOString()
    triggerRef(exercises)
    _persist()

    if (sync && supabase && !isPreviewMode.value && _userId) {
      _enqueueSetUpsert({ id, date, weight, reps, estimated1RM }, exerciseId, _userId)
    }
  }

  function updateSet(exerciseId: string, setId: string, weight: number, reps: number, dateStr?: string) {
    const exercise = exercises.value.find((e: Exercise) => e.id === exerciseId)
    if (!exercise) return
    const set = exercise.sets.find((s: WorkoutSet) => s.id === setId)
    if (!set) return
    if (exercise.sample) _adoptExercise(exercise)
    set.weight = weight
    set.reps = reps
    set.estimated1RM = epley(weight, reps)
    if (dateStr) {
      set.date = endOfDayISO(dateStr)
    }
    exercise.updated_at = new Date().toISOString()
    triggerRef(exercises)
    _persist()

    if (supabase && _userId) {
      _enqueueSetUpsert(set, exerciseId, _userId)
    }
  }

  function deleteSet(exerciseId: string, setId: string, { sync = true }: { sync?: boolean } = {}) {
    const exercise = exercises.value.find((e: Exercise) => e.id === exerciseId)
    if (!exercise) return
    addTombstone('sets', setId)
    exercise.sets = exercise.sets.filter((s: WorkoutSet) => s.id !== setId)
    exercise.updated_at = new Date().toISOString()
    triggerRef(exercises)
    _persist()

    if (sync && supabase && !isPreviewMode.value && _userId) {
      _enqueueSoftDelete(`set:${setId}`, 'sets', { id: setId, user_id: _userId })
    }
  }

  function restoreSet(exerciseId: string, set: WorkoutSet) {
    const exercise = exercises.value.find((e: Exercise) => e.id === exerciseId)
    if (!exercise) return
    removeTombstone('sets', set.id)
    exercise.sets.push(set)
    triggerRef(exercises)
    _persist()

    // Soft-delete restore: clear deleted_at on server. Uses the same key as
    // deleteSet so an in-flight delete is superseded (last-write-wins). If
    // the delete already flushed, this un-soft-deletes the row.
    if (supabase && !isPreviewMode.value && _userId) {
      _enqueueRestore(`set:${set.id}`, 'sets', { id: set.id, user_id: _userId })
    }
  }

  function renameExercise(exerciseId: string, newName: string) {
    const trimmed = newName.trim()
    if (!trimmed) return
    const exercise = exercises.value.find((e: Exercise) => e.id === exerciseId)
    if (!exercise) return
    if (exercise.sample) _adoptExercise(exercise)
    exercise.name = trimmed
    exercise.updated_at = new Date().toISOString()
    triggerRef(exercises)
    _persist()

    if (supabase && _userId) {
      _enqueueExerciseUpsert(exercise, _userId)
    }
  }

  function updateExerciseTags(exerciseId: string, tags: string[]) {
    const exercise = exercises.value.find((e: Exercise) => e.id === exerciseId)
    if (!exercise) return
    if (exercise.sample) _adoptExercise(exercise)
    exercise.tags = [...tags]
    exercise.updated_at = new Date().toISOString()
    triggerRef(exercises)
    _persist()

    if (supabase && _userId) {
      _enqueueExerciseUpsert(exercise, _userId)
    }
  }

  function deleteExercise(exerciseId: string, { sync = true }: { sync?: boolean } = {}) {
    const idx = exercises.value.findIndex((e: Exercise) => e.id === exerciseId)
    if (idx === -1) return
    addTombstone(TOMBSTONE_STORE, exerciseId)
    exercises.value.splice(idx, 1)
    triggerRef(exercises)
    _persist()

    if (sync && supabase && !isPreviewMode.value && _userId) {
      _enqueueSoftDelete(`exercise-sets:${exerciseId}`, 'sets', { exercise_id: exerciseId, user_id: _userId })
      _enqueueSoftDelete(`exercise:${exerciseId}`, 'exercises', { id: exerciseId, user_id: _userId })
    }
  }

  function restoreExercise(exercise: Exercise, atIndex?: number) {
    removeTombstone(TOMBSTONE_STORE, exercise.id)
    if (atIndex !== undefined && atIndex >= 0 && atIndex <= exercises.value.length) {
      exercises.value.splice(atIndex, 0, exercise)
    } else {
      exercises.value.push(exercise)
    }
    triggerRef(exercises)
    _persist()

    // Soft-delete restore: clear deleted_at on both the exercise and its sets.
    // Uses the same keys as deleteExercise so in-flight deletes are superseded.
    // If the delete already flushed, these un-soft-delete.
    //
    // Note: restoring sets by exercise_id will also resurrect sets that were
    // individually soft-deleted before the exercise delete. Edge case; the
    // alternative (tracking per-cascade timestamps) is complexity without
    // matching benefit for immediate-undo UX.
    if (supabase && !isPreviewMode.value && _userId) {
      _enqueueRestore(`exercise-sets:${exercise.id}`, 'sets', { exercise_id: exercise.id, user_id: _userId })
      _enqueueRestore(`exercise:${exercise.id}`, 'exercises', { id: exercise.id, user_id: _userId })
    }
  }

  function archiveExercise(exerciseId: string) {
    const exercise = exercises.value.find((e: Exercise) => e.id === exerciseId)
    if (!exercise) return
    if (exercise.archived_at) return
    if (exercise.sample) _adoptExercise(exercise)
    const archivedAt = new Date().toISOString()
    exercise.archived_at = archivedAt
    exercise.updated_at = archivedAt
    triggerRef(exercises)
    _persist()

    // Use a full upsert (not a partial update) so this enqueue is safe even
    // when the row hasn't yet been created on the server (e.g., an adopted
    // sample exercise whose creating upsert sits in the same queue slot).
    if (supabase && !isPreviewMode.value && _userId) {
      _enqueueExerciseUpsert(exercise, _userId)
    }
  }

  function unarchiveExercise(exerciseId: string) {
    const exercise = exercises.value.find((e: Exercise) => e.id === exerciseId)
    if (!exercise) return
    if (!exercise.archived_at) return
    delete exercise.archived_at
    exercise.updated_at = new Date().toISOString()
    triggerRef(exercises)
    _persist()

    if (supabase && !isPreviewMode.value && _userId) {
      _enqueueExerciseUpsert(exercise, _userId)
    }
  }

  function syncDeleteSet(setId: string) {
    if (supabase && _userId) {
      _enqueueSoftDelete(`set:${setId}`, 'sets', { id: setId, user_id: _userId })
    }
  }

  function syncDeleteExercise(exerciseId: string) {
    if (supabase && _userId) {
      _enqueueSoftDelete(`exercise-sets:${exerciseId}`, 'sets', { exercise_id: exerciseId, user_id: _userId })
      _enqueueSoftDelete(`exercise:${exerciseId}`, 'exercises', { id: exerciseId, user_id: _userId })
    }
  }

  function reorderExercise(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return
    if (fromIndex < 0 || toIndex < 0) return
    if (fromIndex >= exercises.value.length || toIndex >= exercises.value.length) return
    const [item] = exercises.value.splice(fromIndex, 1)
    exercises.value.splice(toIndex, 0, item)
    triggerRef(exercises)
    _persist()
  }

  function renameTag(oldName: string, newName: string) {
    const trimmed = newName.trim()
    if (!trimmed || trimmed === oldName) return
    const modified: Exercise[] = []
    exercises.value.forEach((e: Exercise) => {
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
    const tags = customTags.value
    const customIdx = tags.indexOf(oldName)
    if (customIdx !== -1) {
      if (tags.includes(trimmed)) {
        tags.splice(customIdx, 1)
      } else {
        tags[customIdx] = trimmed
      }
      customTags.value = tags
      triggerRef(customTags)
    }
    const recovery = { ...tagRecoveryDays.value }
    if (oldName in recovery) {
      const days = recovery[oldName]
      delete recovery[oldName]
      if (!(trimmed in recovery)) {
        recovery[trimmed] = days
      }
      tagRecoveryDays.value = recovery
      triggerRef(tagRecoveryDays)
    }
    const excluded = [...tagRecoveryExcluded.value]
    const exclIdx = excluded.indexOf(oldName)
    if (exclIdx !== -1) {
      if (!excluded.includes(trimmed)) {
        excluded[exclIdx] = trimmed
      } else {
        excluded.splice(exclIdx, 1)
      }
      tagRecoveryExcluded.value = excluded
      triggerRef(tagRecoveryExcluded)
    }
    triggerRef(exercises)
    _persist()

    if (_userId && modified.length > 0) {
      const userId = _userId
      for (const e of modified.filter(e => !e.sample)) {
        _enqueueExerciseUpsert(e, userId)
      }
    }
  }

  function deleteTag(tagName: string) {
    const modified: Exercise[] = []
    exercises.value.forEach((e: Exercise) => {
      const idx = e.tags.indexOf(tagName)
      if (idx !== -1) {
        e.tags.splice(idx, 1)
        e.updated_at = new Date().toISOString()
        modified.push(e)
      }
    })
    customTags.value = customTags.value.filter(t => t !== tagName)
    triggerRef(customTags)
    const recovery = { ...tagRecoveryDays.value }
    delete recovery[tagName]
    tagRecoveryDays.value = recovery
    triggerRef(tagRecoveryDays)
    tagRecoveryExcluded.value = tagRecoveryExcluded.value.filter(t => t !== tagName)
    triggerRef(tagRecoveryExcluded)
    triggerRef(exercises)
    _persist()

    if (_userId && modified.length > 0) {
      const userId = _userId
      for (const e of modified.filter(e => !e.sample)) {
        _enqueueExerciseUpsert(e, userId)
      }
    }
  }

  function setTagRecoveryDays(tag: string, days: number | null) {
    const recovery = { ...tagRecoveryDays.value }
    if (days === null || days <= 0) {
      delete recovery[tag]
    } else {
      recovery[tag] = days
    }
    tagRecoveryDays.value = recovery
    triggerRef(tagRecoveryDays)
    _persist()
  }

  function setTagRecoveryExcluded(tag: string, excluded: boolean) {
    const arr = [...tagRecoveryExcluded.value]
    const idx = arr.indexOf(tag)
    if (excluded && idx === -1) {
      arr.push(tag)
    } else if (!excluded && idx !== -1) {
      arr.splice(idx, 1)
    }
    tagRecoveryExcluded.value = arr
    triggerRef(tagRecoveryExcluded)
    _persist()
  }

  function addCustomTag(name: string) {
    const trimmed = name.trim()
    if (!trimmed || customTags.value.includes(trimmed)) return
    customTags.value = [...customTags.value, trimmed]
    triggerRef(customTags)
    _persist()
  }

  function removeCustomTag(name: string) {
    customTags.value = customTags.value.filter(t => t !== name)
    triggerRef(customTags)
    _persist()
  }

  // ── Getters (computed) ─────────────────────────────────────────────
  const allTags = computed((): string[] => {
    const tagSet = new Set<string>()
    exercises.value.forEach((e: Exercise) => (e.tags || []).forEach((t: string) => tagSet.add(t)))
    customTags.value.forEach((t: string) => tagSet.add(t))
    return [...tagSet].sort()
  })

  /** Exercises the user is actively training — main list and pickers use this. */
  const activeExercises = computed((): Exercise[] =>
    exercises.value.filter((e: Exercise) => !e.archived_at)
  )

  /** Exercises the user has archived — hidden from the main list but data is preserved. */
  const archivedExercises = computed((): Exercise[] =>
    exercises.value.filter((e: Exercise) => !!e.archived_at)
  )

  /** Sorted unique workout dates (YYYY-MM-DD), derived from all sets. */
  const workoutDates = computed((): string[] => {
    const dates = new Set<string>()
    exercises.value.forEach((e: Exercise) =>
      e.sets.forEach((s: WorkoutSet) => dates.add(s.date.slice(0, 10)))
    )
    return [...dates].sort()
  })

  /**
   * Max estimated1RM across all sets for an exercise.
   * When `sinceDate` (YYYY-MM-DD) is provided, only sets on or after that
   * date are considered. Default (undefined/null) preserves legacy
   * all-time behavior.
   */
  function getExercisePR(exerciseId: string, sinceDate?: string | null): number {
    const exercise = exercises.value.find((e: Exercise) => e.id === exerciseId)
    if (!exercise || exercise.sets.length === 0) return 0
    const filtered = sinceDate
      ? exercise.sets.filter((s: WorkoutSet) => s.date.slice(0, 10) >= sinceDate)
      : exercise.sets
    if (filtered.length === 0) return 0
    return Math.max(...filtered.map((s: WorkoutSet) => s.estimated1RM))
  }

  /**
   * The single set that achieved the max estimated1RM.
   * Respects `sinceDate` like getExercisePR.
   */
  function getExercisePRSet(exerciseId: string, sinceDate?: string | null): WorkoutSet | null {
    const exercise = exercises.value.find((e: Exercise) => e.id === exerciseId)
    if (!exercise || exercise.sets.length === 0) return null
    const filtered = sinceDate
      ? exercise.sets.filter((s: WorkoutSet) => s.date.slice(0, 10) >= sinceDate)
      : exercise.sets
    if (filtered.length === 0) return null
    return filtered.reduce((best: WorkoutSet, s: WorkoutSet) =>
      s.estimated1RM > best.estimated1RM ? s : best
    )
  }

  function getRecentSets(exerciseId: string, limit = 5): WorkoutSet[] {
    const exercise = exercises.value.find((e: Exercise) => e.id === exerciseId)
    if (!exercise) return []
    return [...exercise.sets].reverse().slice(0, limit)
  }

  /**
   * Returns the sets from the most recent session (day) for an exercise,
   * excluding today. Used for "Last Session" quick-fill in the log modal.
   * Returns { date, sets } or null if no prior session exists.
   */
  function getLastSession(exerciseId: string, today?: string): { date: string; sets: WorkoutSet[] } | null {
    const exercise = exercises.value.find((e: Exercise) => e.id === exerciseId)
    if (!exercise || exercise.sets.length === 0) return null
    const todayStr = today ?? new Date().toISOString().slice(0, 10)
    // Group sets by day
    const byDay = new Map<string, WorkoutSet[]>()
    for (const set of exercise.sets) {
      const day = set.date.slice(0, 10)
      if (day === todayStr) continue
      if (!byDay.has(day)) byDay.set(day, [])
      byDay.get(day)!.push(set)
    }
    if (byDay.size === 0) return null
    // Find the most recent day
    const latestDay = [...byDay.keys()].sort().pop()!
    return { date: latestDay, sets: byDay.get(latestDay)! }
  }

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
  function getOverloadSuggestion(exerciseId: string): OverloadSuggestion | null {
    const exercise = exercises.value.find((e: Exercise) => e.id === exerciseId)
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

  /**
   * Reset all store state to defaults and clear persisted data.
   * Required because setup/composition stores don't get auto-$reset from Pinia.
   * Called by useAuth on sign-out and account deletion.
   */
  function $reset() {
    exercises.value = []
    customTags.value = []
    tagRecoveryDays.value = {}
    tagRecoveryExcluded.value = []
    _userId = null
    triggerRef(exercises)
    triggerRef(customTags)
    triggerRef(tagRecoveryDays)
    triggerRef(tagRecoveryExcluded)
    _persist()
  }

  return {
    // State
    exercises,
    customTags,
    tagRecoveryDays,
    tagRecoveryExcluded,
    // Actions
    $reset,
    init,
    _reloadFromStorage,
    addExercise,
    setExercisePlateCountMode,
    setExerciseInputMode,
    setExerciseBarWeight,
    logSet,
    updateSet,
    deleteSet,
    restoreSet,
    renameExercise,
    updateExerciseTags,
    deleteExercise,
    restoreExercise,
    archiveExercise,
    unarchiveExercise,
    syncDeleteSet,
    syncDeleteExercise,
    reorderExercise,
    renameTag,
    deleteTag,
    setTagRecoveryDays,
    setTagRecoveryExcluded,
    addCustomTag,
    removeCustomTag,
    // Getters
    allTags,
    activeExercises,
    archivedExercises,
    workoutDates,
    getExercisePR,
    getExercisePRSet,
    getRecentSets,
    getLastSession,
    getOverloadSuggestion
  }
})
