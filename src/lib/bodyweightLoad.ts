import { epley } from './epley'

/**
 * Bodyweight-loaded exercise support (LIFT-834).
 *
 * For calisthenic-loaded lifts — pull-ups, dips, weighted chins — the numeric
 * `weight` field is only the EXTERNAL added load (e.g. "+25 lb"), so treating
 * it as the total undercounts real effort: a bodyweight rep at +0 lb estimates
 * a 0 lb 1RM and earns no volume credit at all. When an exercise is flagged
 * bodyweight-loaded, the lifter's tracked bodyweight is folded into the load so
 * e1RM and volume reflect what was actually moved.
 *
 * Both `enteredWeight` and `bodyweight` are in lbs — the workout store stores
 * set `weight` in lbs and the bodyweight store stores entries in lbs, so this
 * is a plain add with no unit conversion.
 */
export function effectiveLoad(
  enteredWeight: number,
  bodyweightLoaded: boolean | undefined,
  bodyweight: number | null | undefined,
): number {
  // No fold for standard exercises, when the flag is off, or when no bodyweight
  // has been logged yet (a non-positive bodyweight is meaningless, so ignore it
  // rather than subtracting phantom load).
  if (!bodyweightLoaded || bodyweight == null || bodyweight <= 0) return enteredWeight
  return enteredWeight + bodyweight
}

/**
 * Epley e1RM that folds bodyweight into the load for bodyweight-loaded
 * exercises. For standard exercises (or when no bodyweight is available) this
 * is identical to calling `epley(enteredWeight, reps)` directly, so it is the
 * single safe substitute everywhere an e1RM is derived from a logged set.
 */
export function effective1RM(
  enteredWeight: number,
  reps: number,
  bodyweightLoaded: boolean | undefined,
  bodyweight: number | null | undefined,
): number {
  return epley(effectiveLoad(enteredWeight, bodyweightLoaded, bodyweight), reps)
}
