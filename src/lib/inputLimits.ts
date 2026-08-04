/**
 * Validation bounds for weight/rep inputs, shared by the log-set modal and
 * the exercise settings forms. Values above these are treated as typos, not
 * ambition.
 */
export const MAX_WEIGHT = 2000
export const MAX_REPS = 200

/**
 * Upper bound for a per-exercise note (#619). Long enough for durable form cues
 * ("brace hard before unrack, drive knees out") without inviting essays that
 * bloat the sync payload or the detail card.
 */
export const MAX_EXERCISE_NOTES_LENGTH = 500

/**
 * Normalize a per-exercise note for storage (#619): trim surrounding whitespace,
 * cap the length, and collapse an empty result to `undefined` so an emptied note
 * clears the field (and its synced column) rather than persisting `''`. Accepts
 * `unknown` so it can also guard untrusted persisted/remote values.
 */
export function sanitizeExerciseNotes(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim().slice(0, MAX_EXERCISE_NOTES_LENGTH)
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * Sanitize a target e1RM value at every boundary (store setter, localStorage
 * load, remote fetch). Coerces numeric strings, rounds to one decimal place,
 * clamps to MAX_WEIGHT, and rejects zero/negative/non-finite/non-numeric
 * input by returning null (LIFT-1035).
 */
export function sanitizeTargetE1RM(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null
  return Math.min(Math.round(n * 10) / 10, MAX_WEIGHT)
}
