/**
 * Plate Calculator
 *
 * Pure functions for converting between total weight and per-side plate loading.
 * All plate values are PER SIDE. Total weight = barWeight + 2 × sum(plates).
 *
 * Issue #157
 */

/** Standard plate denominations */
export const LBS_PLATES = [45, 25, 10, 5, 2.5]
export const KG_PLATES = [20, 15, 10, 5, 2.5, 1.25]

/** Per-side plate list, always sorted descending */
export type PlateSet = number[]

/** Calculate total weight from per-side plates + bar. */
export function platesToWeight(plates: PlateSet, barWeight: number): number {
  const perSide = plates.reduce((sum, p) => sum + p, 0)
  return barWeight + 2 * perSide
}

/**
 * Calculate per-side plates needed for a target weight.
 * Uses greedy algorithm (largest plates first).
 * Returns null if the weight is not achievable.
 */
export function weightToPlates(
  targetWeight: number,
  barWeight: number,
  denominations: number[] = LBS_PLATES
): PlateSet | null {
  const remainder = targetWeight - barWeight
  if (remainder < 0) return null
  if (remainder === 0) return []

  // Must be evenly divisible by 2 (per-side loading)
  const perSide = remainder / 2

  const plates: PlateSet = []
  let remaining = perSide

  // Greedy: use largest plates first
  for (const denom of denominations) {
    while (remaining >= denom - 0.001) { // float tolerance
      plates.push(denom)
      remaining -= denom
    }
  }

  // Check if we achieved the target (float tolerance)
  if (Math.abs(remaining) > 0.01) return null

  return plates
}

/**
 * Calculate what plates to add/remove when changing between two plate configurations.
 */
export function plateDelta(
  from: PlateSet,
  to: PlateSet
): { add: PlateSet; remove: PlateSet } {
  // Count frequencies
  const fromCounts = new Map<number, number>()
  const toCounts = new Map<number, number>()

  for (const p of from) fromCounts.set(p, (fromCounts.get(p) || 0) + 1)
  for (const p of to) toCounts.set(p, (toCounts.get(p) || 0) + 1)

  const add: PlateSet = []
  const remove: PlateSet = []

  // All denominations that appear in either set
  const allDenoms = new Set([...fromCounts.keys(), ...toCounts.keys()])

  for (const denom of allDenoms) {
    const fromCount = fromCounts.get(denom) || 0
    const toCount = toCounts.get(denom) || 0
    const diff = toCount - fromCount

    if (diff > 0) {
      for (let i = 0; i < diff; i++) add.push(denom)
    } else if (diff < 0) {
      for (let i = 0; i < -diff; i++) remove.push(denom)
    }
  }

  // Sort descending for display
  add.sort((a, b) => b - a)
  remove.sort((a, b) => b - a)

  return { add, remove }
}

/**
 * Format a plate set for display: "2×45 + 1×25"
 */
export function formatPlates(plates: PlateSet): string {
  if (plates.length === 0) return ''

  const counts = new Map<number, number>()
  for (const p of plates) counts.set(p, (counts.get(p) || 0) + 1)

  // Sort by denomination descending
  const sorted = [...counts.entries()].sort((a, b) => b[0] - a[0])

  return sorted.map(([denom, count]) => `${count}×${denom}`).join(' + ')
}

/**
 * Format a plate delta for display: "Remove 1×25, Add 1×10"
 */
export function formatDelta(delta: { add: PlateSet; remove: PlateSet }): string {
  const parts: string[] = []
  if (delta.remove.length > 0) parts.push(`Remove ${formatPlates(delta.remove)}`)
  if (delta.add.length > 0) parts.push(`Add ${formatPlates(delta.add)}`)
  return parts.join(' · ')
}

/** Pounds per kilogram — the same factor used by useWeightUnit's display conversion. */
const KG_PER_LB = 0.453592

/**
 * Standard barbell weights that real equipment actually comes in, per unit.
 * Converting toward one of these snaps to it so the common pairs stay stable
 * across a round trip (45 lb ↔ 20 kg, 35 lb ↔ 15 kg) — see convertBarWeight.
 */
const STANDARD_BARS_LBS = [45, 35, 25, 15, 10]
const STANDARD_BARS_KG = [20, 15, 10, 7, 5]

/**
 * Convert a stored bar weight from one display unit to another (LIFT-1223).
 *
 * `Exercise.barWeight` is stored in the user's display unit (see the note in
 * `workout.ts`), so toggling the global weight unit reinterprets the raw number
 * unless it is converted — a 20 saved in kg mode would otherwise feed plate math
 * as 20 lbs.
 *
 * The converted value snaps to the nearest STANDARD bar for the target unit when
 * it lands within tolerance, otherwise it rounds to a whole unit (bars are
 * whole-number values in the edit UI). Snapping is what keeps a lbs↔kg↔lbs round
 * trip stable: a plain factor conversion drifts the 45 lb bar to 44 lb, and
 * `weightToPlates(135, 44)` then returns null (a 45.5 lb-per-side remainder is
 * unachievable), silently breaking plate math for the most common setup. A no-op
 * unit or a non-finite value is returned unchanged.
 */
export function convertBarWeight(
  value: number,
  from: 'lbs' | 'kg',
  to: 'lbs' | 'kg'
): number {
  if (from === to || !Number.isFinite(value)) return value
  const lbs = from === 'kg' ? value / KG_PER_LB : value
  const raw = to === 'kg' ? lbs * KG_PER_LB : lbs

  const standards = to === 'kg' ? STANDARD_BARS_KG : STANDARD_BARS_LBS
  const tolerance = to === 'kg' ? 1 : 2
  let nearest = standards[0]
  let nearestDist = Math.abs(raw - nearest)
  for (const bar of standards) {
    const dist = Math.abs(raw - bar)
    if (dist < nearestDist) {
      nearestDist = dist
      nearest = bar
    }
  }
  return nearestDist <= tolerance ? nearest : Math.round(raw)
}

/**
 * The standard bar in a given DISPLAY unit — 45 lbs / 20 kg (LIFT-1211).
 *
 * `Exercise.barWeight` is optional, and every fallback for an exercise that has
 * none must be unit-aware for the same reason a stored one must be converted on
 * a unit toggle (LIFT-1223): the whole plate subsystem operates in display
 * units, so a hardcoded `45` is read by a kg user as a 45 **kg** bar. The edit
 * sheet made that worse than a display bug — it seeded its bar field from the
 * same constant and saves that field on every edit, so one unrelated rename
 * wrote a 99 lb bar into storage permanently.
 *
 * These are the values `convertBarWeight` snaps to, so a converted bar and a
 * defaulted one agree instead of drifting apart.
 */
export function defaultBarWeight(unit: 'lbs' | 'kg'): number {
  return unit === 'kg' ? STANDARD_BARS_KG[0] : STANDARD_BARS_LBS[0]
}
