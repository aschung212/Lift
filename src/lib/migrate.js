import { supabase } from './supabase'

const WORKOUT_KEY = 'workout-exercises'
const BODYWEIGHT_KEY = 'bodyweight-entries'

export async function migrateLocalStorageToSupabase(userId) {
  if (!supabase) return

  // Check if user already has data in Supabase
  const { count } = await supabase
    .from('exercises')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)

  if (count > 0) return // User already has cloud data, skip

  // Read localStorage data
  let exercises = []
  let bodyweightEntries = []
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
    const exerciseRows = []
    const setRows = []

    for (const ex of exercises) {
      const exerciseId = crypto.randomUUID()
      exerciseRows.push({
        id: exerciseId,
        user_id: userId,
        name: ex.name
      })
      for (const s of (ex.sets || [])) {
        setRows.push({
          id: crypto.randomUUID(),
          user_id: userId,
          exercise_id: exerciseId,
          date: s.date,
          weight: s.weight,
          reps: s.reps,
          estimated_1rm: s.estimated1RM
        })
      }
    }

    await supabase.from('exercises').insert(exerciseRows)
    if (setRows.length > 0) {
      await supabase.from('sets').insert(setRows)
    }
  }

  // Migrate bodyweight entries
  if (bodyweightEntries.length > 0) {
    const bwRows = bodyweightEntries.map(e => ({
      id: crypto.randomUUID(),
      user_id: userId,
      date: e.date,
      weight: e.weight
    }))
    await supabase.from('bodyweight_entries').insert(bwRows)
  }
}
