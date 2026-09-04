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
 * lifter's weight drifts. This module is the single reconciliation point between
 * the two weight spaces the app moves between:
 *
 *   ADDED     — what `set.weight` holds and the log sheet's weight field means.
 *   EFFECTIVE — added + bodyweight; what `set.estimated1RM`, volume, and every
 *               PR comparison are measured in.
 *
 * `bodyweightFold` is the offset between them and the only place the flag is
 * consulted; `effectiveSetWeight` adds it and `addedWeightFromEffective`
 * subtracts it, so the fold and its inverse sit adjacent and cannot disagree.
 *
 * The inverse exists because reading an e1RM back OUT is a third boundary
 * (#1328): LIFT-834 folded at write time (`logSet`) and at volume-read time
 * (`sessionSummary`), but the log sheet inverts a stored e1RM to answer "what
 * should I load next?" — and that answer belongs in the weight field, i.e. in
 * ADDED space. Without the inverse it suggested the effective total as an added
 * weight, which folds a second time on save (~2x) and stores a fake PR.
 *
 * A set with no captured bodyweight folds in nothing (degrades to the added
 * weight) rather than guessing, and for every non-bodyweight-loaded exercise the
 * fold is 0 and both directions are the identity.
 */
import type { Exercise, WorkoutSet } from '../stores/workout'

/**
 * The bodyweight (lbs) folded into a bodyweight-loaded exercise's load — the
 * offset between ADDED and EFFECTIVE weight. 0 for a normal exercise, and 0
 * when no usable bodyweight is available (nothing captured on the set, or the
 * lifter has never tracked their weight) so the fold degrades to the added
 * weight rather than guessing.
 */
export function bodyweightFold(
  exercise?: Pick<Exercise, 'bodyweightLoaded'> | null,
  bodyweight?: number | null,
): number {
  if (!exercise?.bodyweightLoaded) return 0
  if (typeof bodyweight !== 'number' || !Number.isFinite(bodyweight) || bodyweight <= 0) return 0
  return bodyweight
}

/** The load (in lbs) used for volume + e1RM math on a set. ADDED → EFFECTIVE. */
export function effectiveSetWeight(
  set: Pick<WorkoutSet, 'weight'> & { bodyweight?: number },
  exercise?: Pick<Exercise, 'bodyweightLoaded'> | null,
): number {
  return set.weight + bodyweightFold(exercise, set.bodyweight)
}

/**
 * Inverse of {@link effectiveSetWeight}: the ADDED weight that produces
 * `effectiveLbs` on this exercise — what the log sheet's weight field wants
 * when a suggestion is derived from a stored (effective) e1RM.
 *
 * Can legitimately return zero or a negative number: a lifter whose bodyweight
 * alone already exceeds the target needs no added weight at all. Callers decide
 * how to present that (there is no such thing as a negative plate) rather than
 * having it clamped here, so "you already beat this" stays distinguishable from
 * "load nothing extra".
 */
export function addedWeightFromEffective(
  effectiveLbs: number,
  exercise?: Pick<Exercise, 'bodyweightLoaded'> | null,
  bodyweight?: number | null,
): number {
  return effectiveLbs - bodyweightFold(exercise, bodyweight)
}
