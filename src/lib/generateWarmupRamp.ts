/**
 * Warmup ramp generator.
 *
 * The inverse of `classifyWarmupSets`: given a target working weight, produce a
 * sequence of progressively heavier warmup sets that ramp up to it (e.g. empty
 * bar, then 40% / 60% / 80% of the working weight), with the per-side (or total)
 * plate loading for each step. This pairs with the existing plate calculator —
 * Strong/Hevy ship the same feature for powerlifting/bodybuilding workflows.
 *
 * All weights are in the caller's display unit. `barWeight` and `denominations`
 * must be in that same unit, exactly as the plate calculator already passes them.
 */

import { weightToPlates, LBS_PLATES, type PlateSet } from './plateCalculator'

export interface WarmupSchemeStep {
  /** Fraction of the working weight for this step (0–1). 0 denotes an empty-bar set. */
  pct: number
  /** Suggested rep count for this step. */
  reps: number
}

export interface WarmupStep extends WarmupSchemeStep {
  /** Rounded, achievable load for this step, in the caller's display unit. */
  weight: number
  /**
   * Per-side (or total, in `perSide: false` mode) plate breakdown for `weight`.
   * Empty array means the bar alone; null means the weight is not achievable
   * with the given denominations (e.g. an odd machine increment).
   */
  plates: PlateSet | null
}

export interface WarmupRampOptions {
  /** Weight of the empty bar/machine carriage. Default 45. */
  barWeight?: number
  /** Plate denominations available, descending. Default LBS_PLATES. */
  denominations?: number[]
  /** Barbell (per-side) vs. machine/total loading. Default true (per-side). */
  perSide?: boolean
  /** Override the default percentage/rep scheme. */
  scheme?: WarmupSchemeStep[]
  /**
   * Prepend an empty-bar warmup set when the bar has weight and the first
   * working ramp step lands above it. Default true.
   */
  includeBarSet?: boolean
}

/**
 * Standard 3-step ramp (plus an empty-bar opener) used by Strong/Hevy-style
 * apps: lighter loads for more reps, heavier loads for fewer.
 */
export const DEFAULT_WARMUP_SCHEME: WarmupSchemeStep[] = [
  { pct: 0.4, reps: 5 },
  { pct: 0.6, reps: 3 },
  { pct: 0.8, reps: 2 },
]

/** Reps prescribed for the empty-bar opener. */
const BAR_SET_REPS = 8

/** Smallest weight a single step can change by, given per-side vs. total loading. */
function smallestIncrement(denominations: number[], perSide: boolean): number {
  const smallest = denominations[denominations.length - 1]
  return smallest * (perSide ? 2 : 1)
}

/** Plate breakdown for a total weight, honouring per-side vs. total loading. */
function loadFor(
  total: number,
  barWeight: number,
  denominations: number[],
  perSide: boolean,
): PlateSet | null {
  if (perSide) return weightToPlates(total, barWeight, denominations)

  // Total/machine mode: plates are not mirrored, so greedily fill the whole
  // (total − bar) remainder rather than halving it the way weightToPlates does.
  const remainder = total - barWeight
  if (remainder < 0) return null
  if (remainder === 0) return []
  const plates: PlateSet = []
  let remaining = remainder
  for (const denom of denominations) {
    // Skip non-positive denominations defensively — a 0/negative value would
    // otherwise spin the greedy loop forever and soft-lock the UI thread.
    if (denom <= 0) continue
    while (remaining >= denom - 0.001) {
      plates.push(denom)
      remaining -= denom
    }
  }
  if (Math.abs(remaining) > 0.01) return null
  return plates
}

/**
 * Build a warmup ramp leading up to `workingWeight`.
 *
 * Steps are returned in ascending order. Each scheme percentage is rounded to
 * the nearest achievable load on the bar; steps that round to the same weight,
 * fall at/above the working weight, or collapse onto the empty bar are dropped
 * so the ramp never contains redundant or pointless sets. Returns an empty
 * array when there is nothing meaningful to ramp through (no working weight, or
 * a working weight at/below the bar).
 */
export function generateWarmupRamp(
  workingWeight: number,
  options: WarmupRampOptions = {},
): WarmupStep[] {
  const {
    barWeight = 45,
    denominations = LBS_PLATES,
    perSide = true,
    scheme = DEFAULT_WARMUP_SCHEME,
    includeBarSet = true,
  } = options

  if (!Number.isFinite(workingWeight) || workingWeight <= 0) return []
  if (workingWeight <= barWeight) return []
  // Without denominations there is no achievable load to round to.
  if (denominations.length === 0) return []

  const increment = smallestIncrement(denominations, perSide)

  const roundToAchievable = (target: number): number => {
    if (target <= barWeight) return barWeight
    const plateWeight = target - barWeight
    const rounded = Math.round(plateWeight / increment) * increment
    return barWeight + rounded
  }

  const steps: WarmupStep[] = []
  const seenWeights = new Set<number>()

  if (includeBarSet && barWeight > 0) {
    steps.push({
      pct: 0,
      reps: BAR_SET_REPS,
      weight: barWeight,
      plates: loadFor(barWeight, barWeight, denominations, perSide),
    })
    seenWeights.add(barWeight)
  }

  for (const step of scheme) {
    let weight = roundToAchievable(workingWeight * step.pct)
    if (weight < barWeight) weight = barWeight
    // A warmup never meets or exceeds the working weight.
    if (weight >= workingWeight) continue
    if (seenWeights.has(weight)) continue
    seenWeights.add(weight)
    steps.push({
      pct: step.pct,
      reps: step.reps,
      weight,
      plates: loadFor(weight, barWeight, denominations, perSide),
    })
  }

  // Guarantee ascending order even if a caller passes an unsorted scheme.
  steps.sort((a, b) => a.weight - b.weight)
  return steps
}
