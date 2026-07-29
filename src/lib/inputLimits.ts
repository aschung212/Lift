/**
 * Validation bounds for weight/rep inputs, shared by the log-set modal and
 * the exercise settings forms. Values above these are treated as typos, not
 * ambition.
 */
export const MAX_WEIGHT = 2000
export const MAX_REPS = 200

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
