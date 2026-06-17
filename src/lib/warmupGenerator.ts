/**
 * Warmup-set generator.
 *
 * Pure functions that build an auto-ramping warmup progression up to a working
 * weight. Given a target working weight, produces a small ladder of lighter
 * sets (e.g. 40% × 8, 60% × 5, 80% × 3, 90% × 1) with each weight rounded to an
 * achievable plate increment so the user can load it without fractional plates.
 *
 * All weights are in LBS (the app's canonical storage unit); the UI converts
 * for display. Plate breakdowns are PER SIDE and only computed for barbell
 * (per-side) loading — machine/total loading leaves `plates` null.
 *
 * Issue LIFT-725.
 */

import { weightToPlates, LBS_PLATES, type PlateSet } from './plateCalculator'

/** One step in a warmup ramp scheme: a fraction of the working weight + a rep target. */
export interface WarmupSchemeStep {
  /** Fraction of the working weight (0–1) for this step. */
  pct: number
  /** Suggested reps for this step. */
  reps: number
}

/** A concrete, plate-rounded warmup set ready to display or log. */
export interface WarmupStep {
  /** Total weight in lbs, rounded to an achievable increment. */
  weightLbs: number
  /** Suggested reps for this step. */
  reps: number
  /** Per-side plates for this step, or null for non-per-side (machine) loading. */
  plates: PlateSet | null
  /** The scheme fraction this step targets (for labeling / analytics). */
  pct: number
}

export interface WarmupRampOptions {
  /** Bar/base weight in lbs. Default 45 (standard Olympic barbell). */
  barWeight?: number
  /** Whether the load is per-side (barbell) vs total (machine/cable). Default true. */
  perSide?: boolean
  /** Available plate denominations, per side. Default {@link LBS_PLATES}. */
  denominations?: number[]
  /** Ramp scheme. Default {@link DEFAULT_WARMUP_SCHEME}. */
  scheme?: WarmupSchemeStep[]
}

/**
 * Default ramp: climb 40 → 60 → 80 → 90% with descending reps, then the working
 * set at 100%. Enough to prime the movement and nervous system without burning
 * volume — a widely used barbell warmup shape.
 */
export const DEFAULT_WARMUP_SCHEME: WarmupSchemeStep[] = [
  { pct: 0.4, reps: 8 },
  { pct: 0.6, reps: 5 },
  { pct: 0.8, reps: 3 },
  { pct: 0.9, reps: 1 },
]

/** Most steps a per-exercise custom ramp may hold (keeps the editor + UI bounded). */
export const MAX_WARMUP_STEPS = 8
/** A warmup step's working-weight fraction is clamped to this range. */
export const MIN_WARMUP_PCT = 0.05
export const MAX_WARMUP_PCT = 0.95
/** A warmup step's rep target is clamped to this range. */
export const MIN_WARMUP_REPS = 1
export const MAX_WARMUP_REPS = 30

/**
 * Clamp and validate a user- (or storage-) supplied warmup scheme into a safe,
 * renderable shape. Drops malformed entries, clamps each step's percentage and
 * reps into range, rounds reps to whole numbers, and caps the total step count.
 *
 * An EMPTY result is meaningful and preserved: it means "no warmup ramp for
 * this exercise" (the user removed every step). A non-array input (e.g. corrupt
 * remote JSON) falls back to the default scheme rather than silently vanishing.
 */
export function sanitizeWarmupScheme(scheme: unknown): WarmupSchemeStep[] {
  if (!Array.isArray(scheme)) return DEFAULT_WARMUP_SCHEME.map(s => ({ ...s }))
  const clean: WarmupSchemeStep[] = []
  for (const raw of scheme) {
    if (!raw || typeof raw !== 'object') continue
    const pct = Number((raw as { pct?: unknown }).pct)
    const reps = Number((raw as { reps?: unknown }).reps)
    if (!Number.isFinite(pct) || !Number.isFinite(reps)) continue
    clean.push({
      pct: Math.min(MAX_WARMUP_PCT, Math.max(MIN_WARMUP_PCT, pct)),
      reps: Math.min(MAX_WARMUP_REPS, Math.max(MIN_WARMUP_REPS, Math.round(reps))),
    })
    if (clean.length >= MAX_WARMUP_STEPS) break
  }
  return clean
}

/** Order-sensitive value equality for two warmup schemes (used to detect "still default"). */
export function schemesEqual(a: WarmupSchemeStep[], b: WarmupSchemeStep[]): boolean {
  if (a.length !== b.length) return false
  return a.every((step, i) => step.pct === b[i].pct && step.reps === b[i].reps)
}

/** Smallest loadable weight increment for the given plates + loading mode. */
function smallestIncrement(denominations: number[], perSide: boolean): number {
  const smallestPlate = denominations[denominations.length - 1]
  return smallestPlate * (perSide ? 2 : 1)
}

/** Round a raw target to the nearest achievable total weight at/above the bar. */
function roundToLoadable(rawLbs: number, barWeight: number, increment: number): number {
  const plateLoad = rawLbs - barWeight
  if (plateLoad <= 0) return barWeight
  const rounded = Math.round(plateLoad / increment) * increment
  return barWeight + rounded
}

/**
 * Generate a warmup ramp up to `workingWeightLbs`.
 *
 * Each scheme step is scaled off the working weight, rounded to a loadable
 * weight, and filtered so the ramp is strictly lighter than the working set and
 * free of duplicate rungs (coarse rounding can collapse adjacent percentages).
 *
 * Returns an empty array when there is nothing meaningful to warm up — a
 * non-positive working weight, or a working weight at/below the bar.
 */
export function generateWarmupRamp(
  workingWeightLbs: number,
  options: WarmupRampOptions = {},
): WarmupStep[] {
  const {
    barWeight = 45,
    perSide = true,
    denominations = LBS_PLATES,
    scheme = DEFAULT_WARMUP_SCHEME,
  } = options

  if (!Number.isFinite(workingWeightLbs) || workingWeightLbs <= 0) return []
  if (workingWeightLbs <= barWeight) return []

  const increment = smallestIncrement(denominations, perSide)
  const tolerance = 0.01
  const steps: WarmupStep[] = []
  let lastWeight = -Infinity

  for (const { pct, reps } of scheme) {
    const weightLbs = roundToLoadable(workingWeightLbs * pct, barWeight, increment)

    // A warmup must sit strictly below the working set.
    if (weightLbs >= workingWeightLbs - tolerance) continue
    // Drop empty/zero rungs (e.g. a 0-lb machine bar) and duplicate weights.
    if (weightLbs <= 0) continue
    if (Math.abs(weightLbs - lastWeight) < tolerance) continue

    const plates = perSide ? weightToPlates(weightLbs, barWeight, denominations) : null
    steps.push({ weightLbs, reps, plates, pct })
    lastWeight = weightLbs
  }

  return steps
}
