import { supabase } from './supabase'
import type { TablesInsert } from './database.types'
import { uuid } from './uuid'
import { logError, logWarn } from './logger'
import { parseExercise, parseBodyweightEntry } from './parseGuards'
import type { Exercise, WorkoutSet } from '../stores/workout'
import type { BodyweightEntry } from '../stores/bodyweight'

const WORKOUT_KEY = 'workout-exercises'
const BODYWEIGHT_KEY = 'bodyweight-entries'

/**
 * Rows per request. A set row is ~250 bytes of JSON, so a full batch stays far
 * below any request-body limit, and a batch that fails leaves at most this many
 * rows for the sync to push one at a time.
 */
export const MIGRATION_BATCH_SIZE = 500

interface ExerciseAndSetRows {
  exerciseRows: TablesInsert<'exercises'>[]
  setRows: TablesInsert<'sets'>[]
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * The id the device already knows a row by, which is the id its sync pushes.
 * A row with none gets a fresh one: the numeric `Date.now()` ids written before
 * the app had accounts are not strings, so the store's own hydration
 * (`parseExercise`, `parseWorkoutSet`, `parseBodyweightEntry`) drops such a row
 * and the sync can never push it. A fresh id therefore duplicates nothing.
 */
function localIdOrNew(value: unknown): string {
  return isNonEmptyString(value) ? value : uuid()
}

/**
 * The `exercises` row the workout store's `_buildExerciseUpsert` sends for this
 * exercise, column for column. `guestAccountMigration.test.ts` holds the two in
 * step by comparing the server rows each one writes.
 */
function exerciseRow(exercise: Exercise, userId: string): TablesInsert<'exercises'> {
  return {
    id: exercise.id,
    user_id: userId,
    name: exercise.name,
    tags: exercise.tags,
    archived_at: exercise.archived_at ?? null,
    // Omitted when unset, as the store does, so the column's DEFAULT applies.
    ...(exercise.inputMode ? { input_mode: exercise.inputMode } : {}),
    bar_weight: exercise.barWeight ?? null,
    plate_count_mode: exercise.plateCountMode ?? null,
    intensity_max_reps: exercise.intensityMaxReps ?? null,
    equipment: exercise.equipment ?? null,
    gyms: exercise.gyms ?? [],
    notes: exercise.notes ?? null,
    bodyweight_loaded: exercise.bodyweightLoaded ?? false,
  }
}

/** The `sets` row the workout store's `_enqueueSetUpsert` sends for this set. */
function setRow(set: WorkoutSet, exerciseId: string, userId: string): TablesInsert<'sets'> {
  return {
    id: set.id,
    user_id: userId,
    exercise_id: exerciseId,
    date: set.date,
    weight: set.weight,
    reps: set.reps,
    estimated_1rm: set.estimated1RM,
    attempted_next_rep: set.attemptedNextRep ?? false,
    // A legacy set has no log time, so the server's own `created_at` stands.
    ...(set.createdAt ? { created_at: set.createdAt } : {}),
  }
}

/** The `bodyweight_entries` row the bodyweight store's `_enqueueEntryUpsert` sends. */
function bodyweightRow(entry: BodyweightEntry, userId: string): TablesInsert<'bodyweight_entries'> {
  return { id: entry.id, user_id: userId, date: entry.date, weight: entry.weight }
}

/**
 * Validate the localStorage exercise blob and build its rows. Untrusted JSON is
 * validated element by element before it crosses this one-way boundary
 * (LIFT-947), through the same `parseExercise` the store hydrates with
 * (LIFT-946), so this uploads exactly the history the app shows: a corrupt set
 * is dropped, a missing `estimated1RM` is repaired from weight and reps, and
 * every config field is sanitized as the store's setters would sanitize it.
 */
function buildExerciseAndSetRows(raw: unknown, userId: string): ExerciseAndSetRows {
  const exerciseRows: TablesInsert<'exercises'>[] = []
  const setRows: TablesInsert<'sets'>[] = []
  if (!Array.isArray(raw)) {
    if (raw !== undefined) logWarn('Migration: exercises blob is not an array, skipping', { raw })
    return { exerciseRows, setRows }
  }

  for (const ex of raw) {
    if (!isRecord(ex) || !isNonEmptyString(ex.name)) {
      logWarn('Migration: skipping malformed exercise', { ex })
      continue
    }
    const exercise = parseExercise({
      ...ex,
      id: localIdOrNew(ex.id),
      sets: Array.isArray(ex.sets)
        ? ex.sets.map(s => (isRecord(s) ? { ...s, id: localIdOrNew(s.id) } : s))
        : [],
    })
    // Unreachable once the id and name are strings, but the guard owns that rule.
    if (!exercise) continue
    exerciseRows.push(exerciseRow(exercise, userId))
    for (const set of exercise.sets) setRows.push(setRow(set, exercise.id, userId))
  }
  return { exerciseRows, setRows }
}

/** Validate the localStorage bodyweight blob element by element (LIFT-947). */
function buildBodyweightRows(raw: unknown, userId: string): TablesInsert<'bodyweight_entries'>[] {
  const rows: TablesInsert<'bodyweight_entries'>[] = []
  if (!Array.isArray(raw)) {
    if (raw !== undefined) logWarn('Migration: bodyweight blob is not an array, skipping', { raw })
    return rows
  }
  for (const e of raw) {
    const entry = isRecord(e) ? parseBodyweightEntry({ ...e, id: localIdOrNew(e.id) }) : null
    if (!entry) {
      logWarn('Migration: skipping malformed bodyweight entry', { entry: e })
      continue
    }
    rows.push(bodyweightRow(entry, userId))
  }
  return rows
}

/**
 * Split rows into multi-row requests whose rows all carry the same columns, at
 * most `MIGRATION_BATCH_SIZE` each.
 *
 * postgrest-js sends the union of a request's keys as its `columns`, and writes
 * NULL, not the column's DEFAULT, into a row that lacks one. Two columns are
 * left out on purpose, exactly as the store leaves them out: `input_mode` for an
 * exercise that never chose one, and `created_at` for a legacy set with no log
 * time. Both are NOT NULL, so a request mixing rows with and without either
 * would fail as a whole with nothing wrong in any one row.
 */
function uniformBatches<Row extends object>(rows: readonly Row[]): Row[][] {
  const groups = new Map<string, Row[]>()
  for (const row of rows) {
    const columns = Object.keys(row).sort().join(',')
    const group = groups.get(columns)
    if (group) group.push(row)
    else groups.set(columns, [row])
  }
  const batches: Row[][] = []
  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i += MIGRATION_BATCH_SIZE) {
      batches.push(group.slice(i, i + MIGRATION_BATCH_SIZE))
    }
  }
  return batches
}

/**
 * Upsert `rows` in uniform batches, stopping at the first error and returning
 * it (null when every batch landed). Batches that landed before it stay, since
 * they are the user's own rows under their own ids.
 */
async function upsertInBatches<Row extends object>(
  rows: readonly Row[],
  upsert: (batch: Row[]) => PromiseLike<{ error: unknown }>,
): Promise<unknown> {
  for (const batch of uniformBatches(rows)) {
    const { error } = await upsert(batch)
    if (error) return error
  }
  return null
}

/**
 * Upload a device's local history into an EMPTY account: a guest who signs up
 * (LIFT-1083), or any backlog a device built up before its account held data.
 *
 * It writes exactly the rows the stores' own sync would write, under the ids
 * the device already uses (LIFT-1534). That is the whole contract, because the
 * same launch's `_fetchFromSupabase` runs right after this and pushes every
 * local row it cannot find on the server. When this minted a fresh UUID per
 * row, the sync found none of the local ids, pushed every exercise and set a
 * second time, and the account held two copies of everything. `deduplicateByName`
 * merges the copies for display only, so the damage surfaced later: an edited
 * set left its stale twin behind as a visible duplicate on other devices, and a
 * deleted set came back from its twin on the next fetch.
 *
 * Sending every column the sync sends is the other half, not polish. The server
 * stamps `updated_at` when a row lands, later than any local edit, so the
 * server's copy wins the first last-write-wins merge and replaces the local
 * one. A column left out here would be erased on the device too: tags, gyms,
 * notes, an archived exercise coming back, a bar weight, the bodyweight-loaded
 * flag, and the real log time of every set.
 */
export async function migrateLocalStorageToSupabase(userId: string): Promise<void> {
  if (!supabase) return
  const client = supabase

  // Guard: only migrate into an account that has no cloud data yet. These
  // upserts carry the ids the device already syncs under, so in an account that
  // has data a local row sharing an id with a server row may be a stale copy of
  // it, and only the sync's last-write-wins merge may choose between the two.
  // We MUST check the query error — if the count query fails transiently
  // (network / RLS hiccup), `count` comes back null, the `count && count > 0`
  // guard reads as "empty", and migration proceeds. When the guard can't be
  // trusted, abort and let a later session retry. (LIFT-787)
  const { count, error: countError } = await client
    .from('exercises')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)

  if (countError) return // can't trust the guard — retry next session
  if (count && count > 0) return // User already has cloud data, skip

  let rawExercisesParsed: unknown
  let rawEntriesParsed: unknown
  try {
    const rawExercises = localStorage.getItem(WORKOUT_KEY)
    if (rawExercises) rawExercisesParsed = JSON.parse(rawExercises)
  } catch { /* empty */ }
  try {
    const rawEntries = localStorage.getItem(BODYWEIGHT_KEY)
    if (rawEntries) rawEntriesParsed = JSON.parse(rawEntries)
  } catch { /* empty */ }

  const { exerciseRows, setRows } = buildExerciseAndSetRows(rawExercisesParsed, userId)
  const bwRows = buildBodyweightRows(rawEntriesParsed, userId)

  if (exerciseRows.length === 0 && bwRows.length === 0) return

  // Nothing here needs undoing when a later write fails. The same launch's
  // `_fetchFromSupabase` finds whatever did not land and pushes it under the
  // same ids: a missing exercise as local-only, a missing set as one its
  // exercise lacks on the server. So there is no rollback. It hard-deleted the
  // exercises when their sets failed, which was needed only while the rows were
  // fresh copies (LIFT-787), and with shared ids it could delete rows another
  // tab's sync had just written, cascading to their sets.
  if (exerciseRows.length > 0) {
    const exerciseError = await upsertInBatches(exerciseRows, batch => client.from('exercises').upsert(batch))
    if (exerciseError) {
      // A set cannot land before its exercise (foreign key), so the sets wait
      // for the sync, which sends each exercise ahead of them.
      logError(exerciseError, { context: 'migrateLocalStorageToSupabase: exercises upsert failed' })
    } else if (setRows.length > 0) {
      const setError = await upsertInBatches(setRows, batch => client.from('sets').upsert(batch))
      if (setError) logError(setError, { context: 'migrateLocalStorageToSupabase: sets upsert failed' })
    }
  }

  // Migrate bodyweight entries. Guarded independently of the exercises table so
  // a partial failure (e.g. exercises migrated but a previous run died before
  // this upsert) can resume, and a transient error here leaves the door open for
  // a clean retry. (LIFT-787)
  if (bwRows.length > 0) {
    const { count: bwCount, error: bwCountError } = await client
      .from('bodyweight_entries')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)

    if (bwCountError) return // can't trust the guard — retry next session
    if (bwCount && bwCount > 0) return // bodyweight already migrated, skip

    // Surface a failed bodyweight upsert instead of dropping it fire-and-forget
    // — a rejected migration was previously invisible, masking data loss. The
    // bodyweight count guard stays open so a later session can retry. (LIFT-947)
    const bwError = await upsertInBatches(bwRows, batch => client.from('bodyweight_entries').upsert(batch))
    if (bwError) logError(bwError, { context: 'migrateLocalStorageToSupabase: bodyweight upsert failed' })
  }
}
