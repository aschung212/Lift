/**
 * The "Explore first" onboarding demo (LIFT-1527).
 *
 * The demo is seeded with `sync: false`, which stamps `sample` on every row
 * it creates, and that flag means "never pushed": a real action adopts the
 * row (clearing the flag) before anything about it is upserted. The flag alone
 * does not identify the demo, though. A Strong/Hevy CSV import also creates
 * its rows with `sync: false` (LIFT-1526), so a row flagged `sample` is the
 * demo only while the user is exploring it, which is what this key records.
 * `useOnboarding` raises it on "Explore first" and retires it with the last
 * sample row, so it never outlives the demo it describes.
 */

/** Set when the user picks "Explore first"; retired once no sample row is left. */
export const SAMPLE_DATA_KEY = 'sample-data'

/** Whether the user is exploring the demo, i.e. rows flagged `sample` are demo rows. */
export function isExploringSampleData(): boolean {
  try {
    return localStorage.getItem(SAMPLE_DATA_KEY) === 'true'
  } catch {
    return false
  }
}
