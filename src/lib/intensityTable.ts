/**
 * Intensity table generator.
 *
 * Pure functions that build a "what weight, at this intensity, for each rep
 * count?" table anchored on the user's 1RM. Given a one-rep-max and an
 * intensity (a fraction of that max), produces a row per rep count whose weight
 * is the heaviest LOADABLE weight whose estimated 1RM does NOT exceed the
 * target intensity — i.e. each weight is rounded DOWN (floored) to an
 * achievable plate increment so the user never overshoots the selected
 * intensity (plates only go up in fixed steps).
 *
 * This is the data behind the log-set modal's "Intensity" lens (#770): a slider
 * picks the intensity, the table shows the weight to use at each rep count, and
 * the user chooses the row matching their planned reps. The low end of the
 * slider yields warmups; the high end yields near-maximal work. Reps are NOT
 * prescribed — the user picks. Beating the PR (supramaximal, round-UP) is a
 * separate concern handled by the "PR" lens.
 *
 * All weights are LBS (the app's canonical storage unit); the UI converts for
 * display. Plate breakdowns are PER SIDE and only computed for barbell
 * (per-side) loading — machine/total loading leaves `plates` null.
 */

import { weightToPlates, LBS_PLATES, type PlateSet } from './plateCalculator'

/** A concrete, plate-floored intensity row ready to display or log. */
export interface IntensityRow {
  /** Rep count this row targets. */
  reps: number
  /** Total weight in lbs, floored to an achievable increment (≤ the exact target). */
  weightLbs: number
  /** Per-side plates for this weight, or null for non-per-side (machine) loading. */
  plates: PlateSet | null
}

export interface IntensityTableOptions {
  /** Bar/base weight in lbs. Default 45 (standard Olympic barbell). */
  barWeight?: number
  /** Whether the load is per-side (barbell) vs total (machine/cable). Default true. */
  perSide?: boolean
  /** Available plate denominations, per side. Default {@link LBS_PLATES}. */
  denominations?: number[]
  /** How many rep rows (1..maxReps) to compute. Default {@link DEFAULT_INTENSITY_MAX_REPS}. */
  maxReps?: number
  /**
   * Round to loadable plates above the bar and attach per-side plate
   * breakdowns. When false (numpad mode), round to a clean numeric increment
   * (5 lb, or 2.5 kg in kg-space) with no plate breakdown — mirroring
   * `prTargetsTable` so numpad users never see bar-offset fractional weights.
   * Default true.
   */
  plateMode?: boolean
  /** Display unit, used only for numpad rounding (kg rounds in kg-space). Default 'lbs'. */
  unit?: 'lbs' | 'kg'
}

/** Default number of rep rows shown in the intensity table. */
export const DEFAULT_INTENSITY_MAX_REPS = 10
/** A configured rep-row count is clamped to this range. */
export const MIN_INTENSITY_MAX_REPS = 1
export const MAX_INTENSITY_MAX_REPS = 100

const KG_PER_LB = 0.453592
const LBS_NUMPAD_STEP = 5
const KG_NUMPAD_STEP = 2.5

/**
 * Clamp and validate a user- (or storage-) supplied max-reps count into a safe
 * range. Non-numbers fall back to the default; fractional values are floored;
 * out-of-range values are clamped to [1, 100].
 */
export function sanitizeIntensityMaxReps(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return DEFAULT_INTENSITY_MAX_REPS
  const floored = Math.floor(n)
  return Math.max(MIN_INTENSITY_MAX_REPS, Math.min(MAX_INTENSITY_MAX_REPS, floored))
}

/** Smallest loadable weight increment for the given plates + loading mode. */
function smallestIncrement(denominations: number[], perSide: boolean): number {
  const smallestPlate = denominations[denominations.length - 1]
  return smallestPlate * (perSide ? 2 : 1)
}

/**
 * Round a raw target DOWN to the nearest achievable total weight at/above the
 * bar. Flooring (not nearest/ceiling) guarantees the resulting weight's
 * intensity never EXCEEDS the selected intensity.
 */
function floorToLoadable(rawLbs: number, barWeight: number, increment: number): number {
  const plateLoad = rawLbs - barWeight
  if (plateLoad <= 0) return barWeight
  const floored = Math.floor(plateLoad / increment) * increment
  return barWeight + floored
}

/**
 * Generate an intensity table at `intensityPct`% of `oneRepMaxLbs`.
 *
 * For each rep count 1..maxReps, inverts Epley (e1RM = w·(1 + reps/30); 1 rep =
 * the 1RM itself, no multiplier) to find the weight at the target intensity,
 * then rounds it DOWN so the resulting set never exceeds that intensity. The
 * rounding mode mirrors `prTargetsTable`: plate mode floors to a loadable plate
 * increment above the bar (and attaches a per-side breakdown); numpad mode
 * floors to a clean 5 lb (or 2.5 kg, in kg-space) increment with no bar offset.
 * Rows that round to a non-positive weight are dropped.
 *
 * Returns an empty array when there is nothing meaningful to show — a
 * non-positive 1RM, or a non-positive intensity.
 */
export function generateIntensityTable(
  oneRepMaxLbs: number,
  intensityPct: number,
  options: IntensityTableOptions = {},
): IntensityRow[] {
  const {
    barWeight = 45,
    perSide = true,
    denominations = LBS_PLATES,
    maxReps = DEFAULT_INTENSITY_MAX_REPS,
    plateMode = true,
    unit = 'lbs',
  } = options

  if (!Number.isFinite(oneRepMaxLbs) || oneRepMaxLbs <= 0) return []
  if (!Number.isFinite(intensityPct) || intensityPct <= 0) return []

  const targetE1RM = oneRepMaxLbs * (intensityPct / 100)
  const increment = smallestIncrement(denominations, perSide)
  const cap = sanitizeIntensityMaxReps(maxReps)
  const rows: IntensityRow[] = []

  for (let r = 1; r <= cap; r++) {
    // Match the app's e1RM convention (see prTargetsTable / xp): a single rep IS
    // the 1RM — no Epley multiplier — so 100% intensity at 1 rep is the 1RM
    // itself. Only multi-rep sets get the (1 + reps/30) factor.
    const raw = r === 1 ? targetE1RM : targetE1RM / (1 + r / 30)

    let weightLbs: number
    let plates: PlateSet | null = null
    if (plateMode) {
      // Below the empty bar there's nothing to load; a target AT the bar is the
      // valid "just the bar" suggestion (floorToLoadable returns barWeight).
      if (raw < barWeight) continue
      weightLbs = floorToLoadable(raw, barWeight, increment)
      plates = perSide ? weightToPlates(weightLbs, barWeight, denominations) : null
    } else if (unit === 'kg') {
      // Floor in kg-space so the displayed kg value is a clean 2.5 kg step.
      const flooredKg = Math.floor((raw * KG_PER_LB) / KG_NUMPAD_STEP) * KG_NUMPAD_STEP
      weightLbs = Math.round(flooredKg / KG_PER_LB)
    } else {
      weightLbs = Math.floor(raw / LBS_NUMPAD_STEP) * LBS_NUMPAD_STEP
    }

    // Guard against a non-positive row (low target / bar 0), which would
    // populate the inputs with 0 and silently disable Save.
    if (weightLbs <= 0) continue
    rows.push({ reps: r, weightLbs, plates })
  }

  return rows
}
