import { supabase } from './supabase'
import { uuid } from './uuid'
import { epley } from './epley'
import { logError, logWarn } from './logger'

const WORKOUT_KEY = 'workout-exercises'
const BODYWEIGHT_KEY = 'bodyweight-entries'

interface ValidExerciseRow {
  id: string
  user_id: string
  name: string
}

interface ValidSetRow {
  id: string
  user_id: string
  exercise_id: string
  date: string
  weight: number
  reps: number
  estimated_1rm: number
}

interface ValidBodyweightRow {
  id: string
  user_id: string
  date: string
  weight: number
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * Validate the localStorage exercise blob element-by-element and build the
 * concrete insert rows. This is a one-way boundary into the cloud DB, so a
 * single corrupt element (a string weight, a missing date) must be dropped
 * here rather than propagated into a NOT NULL / numeric-column insert that
 * fails the whole batch — or, worse, persisted and synced back to every
 * device. (LIFT-947) A missing/invalid `estimated1RM` on an otherwise-valid
 * set is repaired via Epley rather than discarded, preserving legacy and
 * CSV-imported data whose e1RM was never computed.
 */
function buildExerciseAndSetRows(
  raw: unknown,
  userId: string,
): { exerciseRows: ValidExerciseRow[]; setRows: ValidSetRow[] } {
  const exerciseRows: ValidExerciseRow[] = []
  const setRows: ValidSetRow[] = []
  if (!Array.isArray(raw)) {
    if (raw !== undefined) logWarn('Migration: exercises blob is not an array, skipping', { raw })
    return { exerciseRows, setRows }
  }

  for (const ex of raw) {
    if (typeof ex !== 'object' || ex === null || !isNonEmptyString((ex as { name?: unknown }).name)) {
      logWarn('Migration: skipping malformed exercise', { ex })
      continue
    }
    const exercise = ex as { name: string; sets?: unknown }
    const exerciseId = uuid()
    exerciseRows.push({ id: exerciseId, user_id: userId, name: exercise.name })

    if (exercise.sets === undefined) continue
    if (!Array.isArray(exercise.sets)) {
      logWarn('Migration: exercise sets is not an array, skipping its sets', { name: exercise.name })
      continue
    }
    for (const s of exercise.sets) {
      if (typeof s !== 'object' || s === null) {
        logWarn('Migration: skipping malformed set', { exercise: exercise.name, set: s })
        continue
      }
      const set = s as { date?: unknown; weight?: unknown; reps?: unknown; estimated1RM?: unknown }
      if (!isNonEmptyString(set.date) || !isFiniteNumber(set.weight) || !isFiniteNumber(set.reps)) {
        logWarn('Migration: skipping set with missing/invalid required field', {
          exercise: exercise.name,
          set: s,
        })
        continue
      }
      setRows.push({
        id: uuid(),
        user_id: userId,
        exercise_id: exerciseId,
        date: set.date,
        weight: set.weight,
        reps: set.reps,
        estimated_1rm: isFiniteNumber(set.estimated1RM)
          ? set.estimated1RM
          : epley(set.weight, set.reps),
      })
    }
  }
  return { exerciseRows, setRows }
}

/** Validate the localStorage bodyweight blob element-by-element. (LIFT-947) */
function buildBodyweightRows(raw: unknown, userId: string): ValidBodyweightRow[] {
  const rows: ValidBodyweightRow[] = []
  if (!Array.isArray(raw)) {
    if (raw !== undefined) logWarn('Migration: bodyweight blob is not an array, skipping', { raw })
    return rows
  }
  for (const e of raw) {
    if (typeof e !== 'object' || e === null) {
      logWarn('Migration: skipping malformed bodyweight entry', { entry: e })
      continue
    }
    const entry = e as { date?: unknown; weight?: unknown }
    if (!isNonEmptyString(entry.date) || !isFiniteNumber(entry.weight)) {
      logWarn('Migration: skipping bodyweight entry with missing/invalid field', { entry: e })
      continue
    }
    rows.push({ id: uuid(), user_id: userId, date: entry.date, weight: entry.weight })
  }
  return rows
}

export async function migrateLocalStorageToSupabase(userId: string): Promise<void> {
  if (!supabase) return

  // Guard: only migrate into an account that has no cloud data yet. We MUST
  // check the query error — if the count query fails transiently (network /
  // RLS hiccup), `count` comes back null, the `count && count > 0` guard reads
  // as "empty", and migration proceeds, duplicating any data that is actually
  // already in the cloud. When the guard can't be trusted, abort and let a
  // later session retry. (LIFT-787)
  const { count, error: countError } = await supabase
    .from('exercises')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)

  if (countError) return // can't trust the guard — retry next session
  if (count && count > 0) return // User already has cloud data, skip

  // Read + validate localStorage data at this one-way boundary. Untrusted JSON
  // is validated element-by-element (LIFT-947) so corrupt/legacy rows are
  // dropped here instead of failing the whole cloud insert or persisting bad
  // data that then syncs back to every device.
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

  // Migrate exercises and sets
  if (exerciseRows.length > 0) {
    const { error: exerciseError } = await supabase.from('exercises').insert(exerciseRows)
    // Abort before touching dependent sets if the exercises insert failed.
    // Nothing has landed, so the count guard stays open and a later session
    // can re-run the migration cleanly. (LIFT-787)
    if (exerciseError) return

    if (setRows.length > 0) {
      const { error: setError } = await supabase.from('sets').insert(setRows)
      if (setError) {
        // The exercises landed but their sets did not. Roll back the just-
        // inserted exercises so we leave no orphaned exercises-without-sets
        // AND the count guard reopens — otherwise the now-present exercises
        // would permanently block any re-run. We delete strictly by the UUIDs
        // we minted this run (scoped to this user), so this can only remove
        // rows we just created; the account was verified empty above, so there
        // is no pre-existing data to clobber. (LIFT-787; cf. SEV1 2026-04-12)
        await supabase
          .from('exercises')
          .delete()
          .eq('user_id', userId)
          .in('id', exerciseRows.map(r => r.id))
        return
      }
    }
  }

  // Migrate bodyweight entries. Guarded independently of the exercises table so
  // a partial failure (e.g. exercises migrated but a previous run died before
  // this insert) can resume without duplicating already-migrated bodyweight,
  // and a transient error here leaves the door open for a clean retry. (LIFT-787)
  if (bwRows.length > 0) {
    const { count: bwCount, error: bwCountError } = await supabase
      .from('bodyweight_entries')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)

    if (bwCountError) return // can't trust the guard — retry next session
    if (bwCount && bwCount > 0) return // bodyweight already migrated, skip

    // Surface a failed bodyweight insert instead of dropping it fire-and-forget
    // — a rejected migration was previously invisible, masking data loss. The
    // bodyweight count guard stays open so a later session can retry. (LIFT-947)
    const { error: bwError } = await supabase.from('bodyweight_entries').insert(bwRows)
    if (bwError) logError(bwError, { context: 'migrateLocalStorageToSupabase: bodyweight insert failed' })
  }
}
