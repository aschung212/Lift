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

  // Check if user already has data in Supabase
  const { count } = await supabase
    .from('exercises')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)

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

    // Supabase inserts RESOLVE (not reject) on a DB/RLS failure — the error is
    // returned in the resolved object's `.error` field. Throwing on a non-null
    // error (a) aborts before inserting dependent `sets` when the parent
    // `exercises` insert failed, so we never strand sets pointing at rows that
    // don't exist, and (b) surfaces the failure to the caller instead of
    // silently reporting success (LIFT-782).
    //
    // CAVEAT: these inserts are not wrapped in a transaction, so if `exercises`
    // commits but a later insert fails, the `count > 0` guard at the top will
    // skip the migration on the next launch and the remaining `sets` /
    // bodyweight rows are never migrated. Making the migration transactional or
    // re-runnable per-row is tracked separately in LIFT-787.
    const { error: exercisesError } = await supabase.from('exercises').insert(exerciseRows)
    if (exercisesError) {
      throw new Error(`Migration failed inserting exercises: ${exercisesError.message}`)
    }
    if (setRows.length > 0) {
      const { error: setsError } = await supabase.from('sets').insert(setRows)
      if (setsError) {
        throw new Error(`Migration failed inserting sets: ${setsError.message}`)
      }
    }
  }

  // Migrate bodyweight entries
  if (bodyweightEntries.length > 0) {
    const bwRows = bodyweightEntries.map(e => ({
      id: uuid(),
      user_id: userId,
      date: e.date,
      weight: e.weight
    }))
    const { error: bodyweightError } = await supabase.from('bodyweight_entries').insert(bwRows)
    if (bodyweightError) {
      throw new Error(`Migration failed inserting bodyweight entries: ${bodyweightError.message}`)
    }
  }
}
