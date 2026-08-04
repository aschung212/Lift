/**
 * Bodyweight-loaded exercise load model (LIFT-834).
 *
 * Calisthenic-loaded lifts — pull-ups, dips, weighted chins — move the lifter's
 * whole bodyweight plus any added plate/belt weight. The bare `weight` field on a
 * set only captures the *added* portion, so without folding bodyweight in:
 *   - pure-bodyweight reps (added = 0) score zero volume and a zero e1RM, and
 *   - "+25 lb" undercounts the true ~185 lb load a 160 lb lifter actually moved.
 *
 * When an exercise is flagged `bodyweightLoaded`, the bodyweight in effect at log
 * time is captured onto the set (`set.bodyweight`) so history stays stable as the
 * lifter's weight drifts. This helper is the single reconciliation point that
 * turns a stored set into the load used for volume + 1RM math. A set with no
 * captured bodyweight folds in nothing (degrades to the added weight) rather than
 * guessing, and for every non-bodyweight-loaded exercise this is exactly
 * `set.weight`.
 */
import type { Exercise, WorkoutSet } from '../stores/workout'

/** The load (in lbs) used for volume + e1RM math on a set. */
export function effectiveSetWeight(
  set: Pick<WorkoutSet, 'weight'> & { bodyweight?: number },
  exercise?: Pick<Exercise, 'bodyweightLoaded'> | null,
): number {
  if (exercise?.bodyweightLoaded) return set.weight + (set.bodyweight ?? 0)
  return set.weight
}
