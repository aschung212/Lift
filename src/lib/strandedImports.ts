import type { Exercise } from '../stores/workout'

/**
 * Release CSV imports that an older build stranded as onboarding sample data
 * (LIFT-1526).
 *
 * The CSV import has created its exercises with `addExercise(…, { sync: false })`
 * since it shipped (#211). One day later #232 gave that option a second
 * meaning, "onboarding sample data, never synced": it now stamps `sample: true`,
 * and every push in `_fetchFromSupabase` skips a row carrying it. So every
 * exercise an import created stayed on the importing device, invisible to a
 * second device and gone on a reinstall, until the user happened to edit it.
 * The import no longer does this, but the rows it already stranded are still
 * flagged on those devices, and nothing else will ever upload them.
 *
 * Only two things have ever created a `sample` row: the "Explore first" demo,
 * and the import. The demo seeds exactly the names below, and they have not
 * changed since #232 introduced the flag. Renaming a demo row adopts it (clears
 * the flag), so a row still flagged keeps its seeded name. A flagged row whose
 * name is NOT one of these can only have come from an import. Releasing it
 * turns it into an ordinary local-only exercise, which the next sync uploads
 * with its sets.
 *
 * Exact, case-sensitive matching is deliberate: the demo writes these exact
 * strings, so an import's "bench press" cannot be a demo row and is released,
 * whereas a case-insensitive match would keep it stranded. An imported
 * exercise whose name IS exactly a demo name stays flagged, which is the
 * conservative side: if the user explored the demo too, the import's sets went
 * into the demo row of that name, and the two cannot be told apart (LIFT-1531).
 *
 * `OnboardingScreen.test.ts` walks the demo to the end and checks every row it
 * seeds against this list, so a new demo exercise cannot be mistaken for an
 * import.
 */
export const DEMO_EXERCISE_NAMES: ReadonlySet<string> = new Set([
  'Bench Press',
  'Squat',
  'Deadlift',
  'Overhead Press',
  'Barbell Row',
  'Pull-ups',
])

/**
 * Clear `sample` from every exercise that cannot be demo data, in place.
 * Returns how many were released. Idempotent: a released row no longer matches.
 */
export function releaseStrandedImports(exercises: Exercise[]): number {
  let released = 0
  for (const exercise of exercises) {
    if (exercise.sample && !DEMO_EXERCISE_NAMES.has(exercise.name)) {
      delete exercise.sample
      released++
    }
  }
  return released
}
