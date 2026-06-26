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

/**
 * A finite supply of one plate denomination. `count` is the maximum number of
 * this plate that may appear in a per-side solution (i.e. pairs owned, in
 * per-side loading). Used to model a home-gym user's limited plate set so the
 * calculator never suggests a load they can't physically rack (#835).
 */
export interface PlateStock {
  denom: number
  count: number
}

/** Denominations passed to {@link weightToPlates}: bare numbers = unlimited supply. */
type Denominations = number[] | PlateStock[]

/**
 * Normalize a denomination list into finite stock. A plain `number[]` is treated
 * as unlimited supply (`count: Infinity`) — preserving the original greedy
 * behavior — while a `PlateStock[]` carries explicit per-denomination limits.
 */
function toStock(denominations: Denominations): PlateStock[] {
  if (denominations.length === 0) return []
  if (typeof denominations[0] === 'number') {
    return (denominations as number[]).map(denom => ({ denom, count: Infinity }))
  }
  return (denominations as PlateStock[])
    .filter(s => s.count > 0)
    .map(s => ({ denom: s.denom, count: s.count }))
}

/** The bare denomination values from a denomination list (unlimited or stocked). */
export function denomValues(denominations: Denominations): number[] {
  return toStock(denominations).map(s => s.denom)
}

/** Calculate total weight from per-side plates + bar. */
export function platesToWeight(plates: PlateSet, barWeight: number): number {
  const perSide = plates.reduce((sum, p) => sum + p, 0)
  return barWeight + 2 * perSide
}

/**
 * Greedy-first backtracking search for a per-side plate combination summing to
 * `perSide`, drawing from finite `stock` (sorted descending by denom). Tries the
 * largest plates first and as many as possible — so for the canonical
 * infinite-supply set it produces the same result as a plain greedy fill — but
 * backtracks when a large plate runs out, so a limited plate set still finds an
 * achievable combination when one exists. Returns plates descending, or null.
 */
function solvePerSide(stock: PlateStock[], perSide: number): PlateSet | null {
  function recurse(i: number, remaining: number): PlateSet | null {
    if (remaining <= 0.01) return []
    if (i >= stock.length) return null
    const { denom, count } = stock[i]
    const maxUse = Math.min(count, Math.floor((remaining + 0.001) / denom))
    for (let use = maxUse; use >= 0; use--) {
      const rest = recurse(i + 1, remaining - use * denom)
      if (rest !== null) {
        const plates: PlateSet = []
        for (let k = 0; k < use; k++) plates.push(denom)
        return plates.concat(rest)
      }
    }
    return null
  }
  return recurse(0, perSide)
}

/**
 * Calculate per-side plates needed for a target weight.
 * Uses a greedy-first search (largest plates first). When `denominations` is a
 * {@link PlateStock}[] the search respects each plate's available count, so a
 * limited home-gym set never yields an unrackable suggestion (#835).
 * Returns null if the weight is not achievable.
 */
export function weightToPlates(
  targetWeight: number,
  barWeight: number,
  denominations: Denominations = LBS_PLATES
): PlateSet | null {
  const remainder = targetWeight - barWeight
  if (remainder < 0) return null
  if (remainder === 0) return []

  // Per-side loading: each plate is mirrored on both sides.
  const perSide = remainder / 2

  const stock = toStock(denominations).sort((a, b) => b.denom - a.denom)
  return solvePerSide(stock, perSide)
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

// ── Owned-plate inventory (#835) ──────────────────────────────────────────
// A user-configurable record of which plates they physically own, so the plate
// calculator can round suggestions to loads they can actually rack. `enabled`
// is the master switch (off → unlimited standard plates, the original behavior);
// `lbs`/`kg` map a denomination (as a string key) to the number of PAIRS owned.

export type PlateUnit = 'lbs' | 'kg'

export interface PlateInventory {
  /** When false, the calculator assumes unlimited standard plates (default). */
  enabled: boolean
  /** Pairs owned per lbs denomination, keyed by denomination string. */
  lbs: Record<string, number>
  /** Pairs owned per kg denomination, keyed by denomination string. */
  kg: Record<string, number>
}

/** A fresh, unconfigured inventory (unlimited supply — original behavior). */
export function emptyPlateInventory(): PlateInventory {
  return { enabled: false, lbs: {}, kg: {} }
}

/** Most pairs of a single denomination a user can declare (keeps steppers sane). */
export const MAX_PLATE_PAIRS = 20

/**
 * Sensible starter counts seeded when a user first turns inventory on, so the
 * calculator still resolves common loads immediately. The largest plate is
 * stocked deep (heavy compound loads); smaller plates a couple of pairs each.
 */
const DEFAULT_OWNED_PAIRS: Record<PlateUnit, Record<string, number>> = {
  lbs: { '45': 8, '25': 2, '10': 2, '5': 1, '2.5': 1 },
  kg: { '20': 8, '15': 1, '10': 2, '5': 1, '2.5': 1, '1.25': 1 },
}

/** Default pairs-owned map seeded into the editor when inventory is enabled. */
export function defaultOwnedPairs(unit: PlateUnit): Record<string, number> {
  return { ...DEFAULT_OWNED_PAIRS[unit] }
}

function sanitizePairs(value: unknown, validDenoms: number[]): Record<string, number> {
  const out: Record<string, number> = {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return out
  const valid = new Set(validDenoms.map(String))
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!valid.has(k)) continue
    const n = typeof v === 'number' ? v : Number(v)
    if (!Number.isFinite(n)) continue
    const pairs = Math.max(0, Math.min(MAX_PLATE_PAIRS, Math.floor(n)))
    if (pairs > 0) out[k] = pairs
  }
  return out
}

/**
 * Validate a stored or user-supplied plate inventory: `enabled` coerced to a
 * boolean, only known denominations kept, pair counts floored into [0,
 * {@link MAX_PLATE_PAIRS}] with zero-count entries dropped. Any malformed input
 * collapses to an empty (unlimited) inventory.
 */
export function sanitizePlateInventory(value: unknown): PlateInventory {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return emptyPlateInventory()
  }
  const obj = value as Record<string, unknown>
  return {
    enabled: obj.enabled === true,
    lbs: sanitizePairs(obj.lbs, LBS_PLATES),
    kg: sanitizePairs(obj.kg, KG_PLATES),
  }
}

/**
 * Build the finite {@link PlateStock} the calculator should draw from for a given
 * unit and loading mode. In per-side (barbell) loading, a pair owned = one plate
 * available per side; in total loading, both plates of a pair load the same side,
 * so the per-side allowance is doubled. Returns `[]` when the user owns nothing
 * declared for the unit (callers fall back to unlimited standard plates).
 */
export function ownedPlateStock(
  inventory: PlateInventory,
  unit: PlateUnit,
  perSide: boolean,
): PlateStock[] {
  const denoms = unit === 'kg' ? KG_PLATES : LBS_PLATES
  const map = unit === 'kg' ? inventory.kg : inventory.lbs
  const stock: PlateStock[] = []
  for (const denom of denoms) {
    const pairs = map[String(denom)] ?? 0
    if (pairs <= 0) continue
    stock.push({ denom, count: perSide ? pairs : pairs * 2 })
  }
  return stock
}
