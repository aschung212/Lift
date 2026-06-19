import { supabase } from './supabase'
import { uuid } from './uuid'

const WORKOUT_KEY = 'workout-exercises'
const BODYWEIGHT_KEY = 'bodyweight-entries'

interface LocalExercise {
  name: string
  sets?: Array<{
    date: string
    weight: number
    reps: number
    estimated1RM: number
  }>
}

interface LocalBodyweightEntry {
  date: string
  weight: number
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

  // Read localStorage data
  let exercises: LocalExercise[] = []
  let bodyweightEntries: LocalBodyweightEntry[] = []
  try {
    const rawExercises = localStorage.getItem(WORKOUT_KEY)
    if (rawExercises) exercises = JSON.parse(rawExercises)
  } catch { /* empty */ }
  try {
    const rawEntries = localStorage.getItem(BODYWEIGHT_KEY)
    if (rawEntries) bodyweightEntries = JSON.parse(rawEntries)
  } catch { /* empty */ }

  if (exercises.length === 0 && bodyweightEntries.length === 0) return

  // Migrate exercises and sets
  if (exercises.length > 0) {
    const exerciseRows: Array<{ id: string; user_id: string; name: string }> = []
    const setRows: Array<{ id: string; user_id: string; exercise_id: string; date: string; weight: number; reps: number; estimated_1rm: number }> = []

    for (const ex of exercises) {
      const exerciseId = uuid()
      exerciseRows.push({
        id: exerciseId,
        user_id: userId,
        name: ex.name
      })
      for (const s of (ex.sets || [])) {
        setRows.push({
          id: uuid(),
          user_id: userId,
          exercise_id: exerciseId,
          date: s.date,
          weight: s.weight,
          reps: s.reps,
          estimated_1rm: s.estimated1RM
        })
      }
    }

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
  if (bodyweightEntries.length > 0) {
    const { count: bwCount, error: bwCountError } = await supabase
      .from('bodyweight_entries')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)

    if (bwCountError) return // can't trust the guard — retry next session
    if (bwCount && bwCount > 0) return // bodyweight already migrated, skip

    const bwRows = bodyweightEntries.map(e => ({
      id: uuid(),
      user_id: userId,
      date: e.date,
      weight: e.weight
    }))
    await supabase.from('bodyweight_entries').insert(bwRows)
  }
}
