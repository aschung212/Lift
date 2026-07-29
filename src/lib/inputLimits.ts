/**
 * Validation bounds for weight/rep inputs, shared by the log-set modal and
 * the exercise settings forms. Values above these are treated as typos, not
 * ambition.
 */
export const MAX_WEIGHT = 2000
export const MAX_REPS = 200

/**
 * Coerce an optional per-exercise target e1RM (LIFT-1035) to a stored value.
 * Accepts numbers or numeric strings; returns null for zero, negatives, and
 * non-finite/non-numeric input (no goal line). Valid values are clamped to
 * (0, MAX_WEIGHT] and rounded to one decimal place.
 */
export function sanitizeTargetE1RM(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  const clamped = Math.min(n, MAX_WEIGHT)
  return Math.round(clamped * 10) / 10
}
