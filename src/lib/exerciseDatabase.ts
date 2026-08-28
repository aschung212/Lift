/**
 * Built-in exercise database for search/discovery.
 * ~100 common exercises with pre-mapped muscle group tags.
 *
 * Tag taxonomy matches the app's existing conventions:
 *   Movement patterns: Push, Pull
 *   Muscle groups: Chest, Back, Shoulders, Arms, Legs, Core
 *
 * Each entry includes an optional `inputMode` hint for plate-loaded exercises.
 */

import type { ExerciseInputMode } from '../stores/workout'

export interface ExerciseEntry {
  name: string
  tags: string[]
  inputMode?: ExerciseInputMode
  barWeight?: number
}

const DB: ExerciseEntry[] = [
  // ── Chest ──────────────────────────────────────────────────────────
  { name: 'Bench Press', tags: ['Push', 'Chest'], inputMode: 'plates', barWeight: 45 },
  { name: 'Incline Bench Press', tags: ['Push', 'Chest'], inputMode: 'plates', barWeight: 45 },
  { name: 'Decline Bench Press', tags: ['Push', 'Chest'], inputMode: 'plates', barWeight: 45 },
  { name: 'Dumbbell Bench Press', tags: ['Push', 'Chest'] },
  { name: 'Incline Dumbbell Press', tags: ['Push', 'Chest'] },
  { name: 'Dumbbell Fly', tags: ['Push', 'Chest'] },
  { name: 'Cable Fly', tags: ['Push', 'Chest'] },
  { name: 'Machine Chest Press', tags: ['Push', 'Chest'] },
  { name: 'Pec Deck', tags: ['Push', 'Chest'] },
  { name: 'Dips', tags: ['Push', 'Chest', 'Arms'] },

  // ── Back ────────────────────────────────────────────────────────────
  { name: 'Deadlift', tags: ['Pull', 'Legs', 'Back'], inputMode: 'plates', barWeight: 45 },
  { name: 'Barbell Row', tags: ['Pull', 'Back'], inputMode: 'plates', barWeight: 45 },
  { name: 'Pull-ups', tags: ['Pull', 'Back'] },
  { name: 'Chin-ups', tags: ['Pull', 'Back', 'Arms'] },
  { name: 'Lat Pulldown', tags: ['Pull', 'Back'] },
  { name: 'Seated Cable Row', tags: ['Pull', 'Back'] },
  { name: 'Dumbbell Row', tags: ['Pull', 'Back'] },
  { name: 'T-Bar Row', tags: ['Pull', 'Back'], inputMode: 'plates', barWeight: 45 },
  { name: 'Pendlay Row', tags: ['Pull', 'Back'], inputMode: 'plates', barWeight: 45 },
  { name: 'Face Pull', tags: ['Pull', 'Back', 'Shoulders'] },
  { name: 'Rack Pull', tags: ['Pull', 'Back'], inputMode: 'plates', barWeight: 45 },
  { name: 'Chest Supported Row', tags: ['Pull', 'Back'] },
  { name: 'Machine Row', tags: ['Pull', 'Back'] },
  { name: 'Straight Arm Pulldown', tags: ['Pull', 'Back'] },
  { name: 'Meadows Row', tags: ['Pull', 'Back'] },

  // ── Shoulders ──────────────────────────────────────────────────────
  { name: 'Overhead Press', tags: ['Push', 'Shoulders'], inputMode: 'plates', barWeight: 45 },
  { name: 'Dumbbell Shoulder Press', tags: ['Push', 'Shoulders'] },
  { name: 'Arnold Press', tags: ['Push', 'Shoulders'] },
  { name: 'Lateral Raise', tags: ['Shoulders'] },
  { name: 'Front Raise', tags: ['Push', 'Shoulders'] },
  { name: 'Reverse Fly', tags: ['Pull', 'Shoulders'] },
  { name: 'Upright Row', tags: ['Pull', 'Shoulders'] },
  { name: 'Cable Lateral Raise', tags: ['Shoulders'] },
  { name: 'Machine Shoulder Press', tags: ['Push', 'Shoulders'] },
  { name: 'Rear Delt Fly', tags: ['Pull', 'Shoulders'] },
  { name: 'Shrugs', tags: ['Pull', 'Shoulders'] },
  { name: 'Barbell Shrugs', tags: ['Pull', 'Shoulders'], inputMode: 'plates', barWeight: 45 },

  // ── Arms (Biceps) ─────────────────────────────────────────────────
  { name: 'Barbell Curl', tags: ['Pull', 'Arms'], inputMode: 'plates', barWeight: 25 },
  { name: 'Dumbbell Curl', tags: ['Pull', 'Arms'] },
  { name: 'Hammer Curl', tags: ['Pull', 'Arms'] },
  { name: 'Preacher Curl', tags: ['Pull', 'Arms'] },
  { name: 'Cable Curl', tags: ['Pull', 'Arms'] },
  { name: 'Incline Dumbbell Curl', tags: ['Pull', 'Arms'] },
  { name: 'Concentration Curl', tags: ['Pull', 'Arms'] },
  { name: 'EZ Bar Curl', tags: ['Pull', 'Arms'], inputMode: 'plates', barWeight: 25 },
  { name: 'Spider Curl', tags: ['Pull', 'Arms'] },

  // ── Arms (Triceps) ────────────────────────────────────────────────
  { name: 'Tricep Pushdown', tags: ['Push', 'Arms'] },
  { name: 'Overhead Tricep Extension', tags: ['Push', 'Arms'] },
  { name: 'Skull Crushers', tags: ['Push', 'Arms'], inputMode: 'plates', barWeight: 25 },
  { name: 'Close Grip Bench Press', tags: ['Push', 'Arms', 'Chest'], inputMode: 'plates', barWeight: 45 },
  { name: 'Tricep Dips', tags: ['Push', 'Arms'] },
  { name: 'Cable Overhead Extension', tags: ['Push', 'Arms'] },
  { name: 'Kickbacks', tags: ['Push', 'Arms'] },

  // ── Legs (Quads) ──────────────────────────────────────────────────
  { name: 'Squat', tags: ['Legs'], inputMode: 'plates', barWeight: 45 },
  { name: 'Front Squat', tags: ['Legs'], inputMode: 'plates', barWeight: 45 },
  { name: 'Leg Press', tags: ['Legs'] },
  { name: 'Hack Squat', tags: ['Legs'] },
  { name: 'Leg Extension', tags: ['Legs'] },
  { name: 'Bulgarian Split Squat', tags: ['Legs'] },
  { name: 'Goblet Squat', tags: ['Legs'] },
  { name: 'Walking Lunges', tags: ['Legs'] },
  { name: 'Lunges', tags: ['Legs'] },
  { name: 'Step-ups', tags: ['Legs'] },
  { name: 'Sissy Squat', tags: ['Legs'] },

  // ── Legs (Hamstrings / Glutes) ────────────────────────────────────
  { name: 'Romanian Deadlift', tags: ['Pull', 'Legs'], inputMode: 'plates', barWeight: 45 },
  { name: 'Stiff Leg Deadlift', tags: ['Pull', 'Legs'], inputMode: 'plates', barWeight: 45 },
  { name: 'Leg Curl', tags: ['Legs'] },
  { name: 'Seated Leg Curl', tags: ['Legs'] },
  { name: 'Hip Thrust', tags: ['Legs'], inputMode: 'plates', barWeight: 45 },
  { name: 'Glute Bridge', tags: ['Legs'] },
  { name: 'Good Mornings', tags: ['Pull', 'Legs'], inputMode: 'plates', barWeight: 45 },
  { name: 'Nordic Hamstring Curl', tags: ['Legs'] },
  { name: 'Cable Pull Through', tags: ['Legs'] },

  // ── Legs (Calves) ─────────────────────────────────────────────────
  { name: 'Standing Calf Raise', tags: ['Legs'] },
  { name: 'Seated Calf Raise', tags: ['Legs'] },

  // ── Core ───────────────────────────────────────────────────────────
  { name: 'Plank', tags: ['Core'] },
  { name: 'Hanging Leg Raise', tags: ['Core'] },
  { name: 'Cable Crunch', tags: ['Core'] },
  { name: 'Ab Wheel Rollout', tags: ['Core'] },
  { name: 'Russian Twist', tags: ['Core'] },
  { name: 'Decline Sit-ups', tags: ['Core'] },
  { name: 'Pallof Press', tags: ['Core'] },
  { name: 'Leg Raises', tags: ['Core'] },
  { name: 'Dragon Flag', tags: ['Core'] },
  { name: 'Woodchoppers', tags: ['Core'] },

  // ── Compound / Olympic ────────────────────────────────────────────
  { name: 'Power Clean', tags: ['Pull', 'Legs'], inputMode: 'plates', barWeight: 45 },
  { name: 'Clean and Jerk', tags: ['Push', 'Pull', 'Legs'], inputMode: 'plates', barWeight: 45 },
  { name: 'Snatch', tags: ['Push', 'Pull', 'Legs'], inputMode: 'plates', barWeight: 45 },
  { name: 'Sumo Deadlift', tags: ['Pull', 'Legs'], inputMode: 'plates', barWeight: 45 },
  { name: 'Trap Bar Deadlift', tags: ['Pull', 'Legs'], inputMode: 'plates', barWeight: 60 },

  // ── Forearms / Grip ───────────────────────────────────────────────
  { name: 'Wrist Curls', tags: ['Arms'] },
  { name: 'Reverse Wrist Curls', tags: ['Arms'] },
  { name: "Farmer's Walk", tags: ['Arms', 'Core'] },

  // ── Machines / Cables (misc) ──────────────────────────────────────
  { name: 'Cable Crossover', tags: ['Push', 'Chest'] },
  { name: 'Smith Machine Squat', tags: ['Legs'] },
  { name: 'Smith Machine Bench Press', tags: ['Push', 'Chest'] },
  { name: 'Leg Adduction', tags: ['Legs'] },
  { name: 'Leg Abduction', tags: ['Legs'] },
]

/**
 * Search the built-in exercise database.
 * Returns entries whose name matches the query (case-insensitive substring).
 * Results are sorted: prefix matches first, then substring matches.
 * Already-added exercises (by name) are excluded.
 */
export function searchExerciseDatabase(
  query: string,
  existingNames: string[],
  limit = 6,
): ExerciseEntry[] {
  const q = query.toLowerCase().trim()
  if (!q) return []

  const existingSet = new Set(existingNames.map(n => n.toLowerCase()))

  const matches = DB.filter(entry =>
    entry.name.toLowerCase().includes(q) && !existingSet.has(entry.name.toLowerCase()),
  )

  // Sort: prefix matches first, then alphabetically
  matches.sort((a, b) => {
    const aPrefix = a.name.toLowerCase().startsWith(q) ? 0 : 1
    const bPrefix = b.name.toLowerCase().startsWith(q) ? 0 : 1
    if (aPrefix !== bPrefix) return aPrefix - bPrefix
    return a.name.localeCompare(b.name)
  })

  return matches.slice(0, limit)
}

/** Total number of exercises in the database (for display). */
export const EXERCISE_DB_COUNT = DB.length
