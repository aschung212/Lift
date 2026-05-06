/**
 * Epley 1RM estimation, rounded to the nearest integer.
 *
 *   e1RM = weight * (1 + reps / 30)
 *
 * For a single-rep set we return the weight itself (still rounded) — at 1 rep
 * the formula collapses to weight * (1 + 1/30), but the working definition
 * of a one-rep max is literally the lifted weight, so we special-case it.
 *
 * Input assumed valid (reps > 0, weight > 0). Callers that need to accept
 * user-provided or CSV-imported values should guard their inputs before
 * calling — see `csvImport.ts` for an example that also returns 0 for bad
 * input.
 */
export function epley(weight: number, reps: number): number {
  if (reps === 1) return Math.round(weight)
  return Math.round(weight * (1 + reps / 30))
}
