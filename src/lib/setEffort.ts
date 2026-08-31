/**
 * Set effort — the "did you go for one more?" annotation and the ordering it
 * implies (#1271).
 *
 * A set logged as "8 reps" is ambiguous: it collapses two genuinely different
 * efforts into one number.
 *
 *   1. Completed 8, re-racked the bar with reps still in reserve.
 *   2. Completed 8, attempted a 9th, and failed or got a partial rep.
 *
 * (2) is the strictly higher-output set and is real evidence that progressive
 * overload is still moving, even though the rep count did not change. Without
 * the distinction the app reads two identical 135 x 8 sessions as a flat
 * plateau when the lifter actually got measurably closer to 9.
 *
 * `WorkoutSet.attemptedNextRep` records it in ONE optional boolean, absent by
 * default: unknown === re-racked, and legacy sets are never backfilled (the
 * annotation is a claim about what happened, and we did not ask at the time).
 *
 * What this module deliberately does NOT do: it never touches `estimated1RM`.
 * Awarding a fraction of a rep for a failed attempt would inflate e1RM and
 * mint phantom PRs off a self-reported flag — the PR burst, plateau detection,
 * the intensity-table anchor and XP all read that number. The attempt is a
 * TIEBREAK and a coaching signal, not extra load.
 */

/**
 * The minimal shape this module orders. Structural rather than `WorkoutSet` so
 * pure callers (and tests) can rank plain literals without building full sets.
 */
export interface EffortSet {
  weight: number
  reps: number
  attemptedNextRep?: boolean
}

/** True when the lifter went for one more rep past the logged count and missed it. */
export function attemptedNextRep(set: Pick<EffortSet, 'attemptedNextRep'>): boolean {
  return set.attemptedNextRep === true
}

/**
 * Order two sets by output, ascending (`Array.prototype.sort` convention:
 * negative when `a` is the lesser effort).
 *
 * Heavier beats lighter; at equal weight more reps beats fewer; and at equal
 * weight AND reps, the set that went for the next rep outranks the one that was
 * re-racked. That last rung is the whole point of the annotation — it is the
 * only place two otherwise identical sets can be told apart.
 *
 * Ties (both re-racked, or both attempted) return 0, so a stable sort keeps
 * the incoming order and `pickTopSet` keeps the earliest.
 */
export function compareSetEffort(a: EffortSet, b: EffortSet): number {
  if (a.weight !== b.weight) return a.weight - b.weight
  if (a.reps !== b.reps) return a.reps - b.reps
  return Number(attemptedNextRep(a)) - Number(attemptedNextRep(b))
}

/**
 * The highest-output set in a list, or null when empty.
 *
 * Keeps the FIRST of equally-ranked sets (strict `>` on the comparison), which
 * matches the plain `reduce` this replaced and keeps session-top-set selection
 * deterministic for a 5x5 where every set is identical.
 */
export function pickTopSet<T extends EffortSet>(sets: readonly T[]): T | null {
  let top: T | null = null
  for (const set of sets) {
    if (top === null || compareSetEffort(set, top) > 0) top = set
  }
  return top
}
