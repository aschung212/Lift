/**
 * Intensity table generator.
 *
 * Pure functions that build a "what weight, at this intensity, for each rep
 * count?" table anchored on the user's 1RM. Given a one-rep-max and an
 * intensity (a fraction of that max), produces a row per rep count whose weight
 * is the lightest LOADABLE weight whose estimated 1RM is at least the target
 * intensity — i.e. each weight is rounded UP (ceiled) to an achievable plate
 * increment so a shown set always MEETS OR BEATS the selected intensity (plates
 * only go up in fixed steps, so you can't land exactly on the target).
 *
 * Ceiling (not flooring) is what lets a single table span the whole range: the
 * low end of the slider yields warmups and the **100% end reaches your PR** —
 * each rep row is the lightest loadable weight whose e1RM meets/beats your best,
 * which is exactly "what it takes to set a PR at this rep count." That is why
 * the log-set modal's "Intensity" lens (#770) is one lens, not two: the former
 * separate PR table is just this table read at 100%.
 *
 * Reps are NOT prescribed — the user taps the row matching their planned reps.
 * Every row also carries its `e1rm` so the user can see, per option, how the
 * weight relates to their max.
 *
 * Every weight here — in, out, and in between — is in the user's DISPLAY unit,
 * the same space as the `barWeight` and `denominations` this module is handed
 * (LIFT-1211: the whole plate subsystem operates in display units, so a kg user
 * stacks kg plates on a kg bar). Canonical lbs cross the boundary at the call
 * site: `displayWeight()` on the 1RM going in, `toLbs()` at set-save time.
 *
 * It used to take a LBS one-rep-max while being handed a display-unit bar and
 * display-unit plates, so for kg users the ceiling, the below-the-bar guard, and
 * the plate decomposition all mixed the two spaces: a row labelled 69.2 kg
 * filled the weight field with 152.5 kg, and one tap on a warmup-looking row
 * could save a fake all-time PR (LIFT-1315). The spaces coincide for lbs users,
 * which is why it was invisible on master.
 *
 * Plate breakdowns are PER SIDE and only computed for barbell (per-side)
 * loading — machine/total loading leaves `plates` null.
 */

import { weightToPlates, defaultBarWeight, LBS_PLATES, KG_PLATES, type PlateSet } from './plateCalculator'

/** A concrete, plate-ceiled intensity row ready to display or log. */
export interface IntensityRow {
  /** Rep count this row targets. */
  reps: number
  /** Total weight in the DISPLAY unit, ceiled to an achievable increment (≥ the exact target). */
  weight: number
  /** Estimated 1RM of `weight` at `reps`, same unit (1 rep = the weight itself). */
  e1rm: number
  /** Per-side plates for this weight, or null for non-per-side (machine) loading. */
  plates: PlateSet | null
}

export interface IntensityTableOptions {
  /**
   * Bar/base weight in the DISPLAY unit. Defaults to the standard bar for
   * `unit` (45 lbs / 20 kg) — never a hardcoded 45, which a kg user would read
   * as a 45 kg bar (LIFT-1223).
   */
  barWeight?: number
  /** Whether the load is per-side (barbell) vs total (machine/cable). Default true. */
  perSide?: boolean
  /** Available plate denominations, per side. Defaults to the set for `unit`. */
  denominations?: number[]
  /** How many rep rows (1..maxReps) to compute. Default {@link DEFAULT_INTENSITY_MAX_REPS}. */
  maxReps?: number
  /**
   * Round to loadable plates above the bar and attach per-side plate
   * breakdowns. When false (numpad mode), round to a clean numeric increment
   * (5 lbs / 2.5 kg) with no plate breakdown — mirroring the PR targets table
   * so numpad users never see bar-offset fractional weights. Default true.
   */
  plateMode?: boolean
  /**
   * Which display unit the weights are in. Selects the numpad rounding step and
   * the defaults for `barWeight`/`denominations`. Default 'lbs'.
   */
  unit?: 'lbs' | 'kg'
}

/** Default number of rep rows shown in the intensity table. */
export const DEFAULT_INTENSITY_MAX_REPS = 10
/** A configured rep-row count is clamped to this range. */
export const MIN_INTENSITY_MAX_REPS = 1
export const MAX_INTENSITY_MAX_REPS = 100

/**
 * Default tappable intensity presets (% of max) seeded into the Intensity lens
 * so the feature is useful out of the box — warmup → working → heavy → PR.
 */
export const DEFAULT_INTENSITY_PRESETS = [50, 70, 80, 90, 100]
/** Most presets a user can configure (keeps the chip row scannable). */
export const MAX_INTENSITY_PRESETS = 8

/** Step size and minimum value when editing presets in Settings. */
export const INTENSITY_PRESET_STEP = 5
/** A 0% preset has no loadable weight, so the editable minimum is one step up. */
export const MIN_INTENSITY_PRESET = 5

/**
 * Clamp/validate a stored or user-supplied list of intensity presets: integers
 * in [1, 100], deduped, sorted ascending, capped at {@link MAX_INTENSITY_PRESETS}.
 * A non-array falls back to the defaults; an explicit empty array stays empty
 * (the user deliberately cleared all presets → the lens shows the slider only).
 */
export function sanitizeIntensityPresets(value: unknown): number[] {
  if (!Array.isArray(value)) return [...DEFAULT_INTENSITY_PRESETS]
  const seen = new Set<number>()
  const out: number[] = []
  for (const raw of value) {
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(n)) continue
    const v = Math.floor(n)
    if (v < 1 || v > 100 || seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  out.sort((a, b) => a - b)
  return out.slice(0, MAX_INTENSITY_PRESETS)
}

/**
 * Next free preset value when stepping `value` by {@link INTENSITY_PRESET_STEP}
 * in `dir` (+1 up, -1 down). Occupied values are skipped so stepping never
 * collapses two presets into one. Returns null when no free value remains in
 * range [{@link MIN_INTENSITY_PRESET}, 100] — used to disable the stepper button.
 */
export function nextPresetValue(presets: number[], value: number, dir: 1 | -1): number | null {
  let next = value + dir * INTENSITY_PRESET_STEP
  while (next >= MIN_INTENSITY_PRESET && next <= 100 && presets.includes(next)) {
    next += dir * INTENSITY_PRESET_STEP
  }
  return next >= MIN_INTENSITY_PRESET && next <= 100 ? next : null
}

/**
 * Choose a value for a newly added preset: prefer 80% (a common working
 * intensity), else the first free step from the minimum up. Returns null when
 * the list is already at {@link MAX_INTENSITY_PRESETS} or fully saturated.
 */
export function pickNewPresetValue(presets: number[]): number | null {
  if (presets.length >= MAX_INTENSITY_PRESETS) return null
  if (!presets.includes(80)) return 80
  for (let v = MIN_INTENSITY_PRESET; v <= 100; v += INTENSITY_PRESET_STEP) {
    if (!presets.includes(v)) return v
  }
  return null
}

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
 * Normalize a computed weight to a clean number — it is both rendered directly
 * and written into the log sheet's weight field, so it has to be a value the
 * user could have typed and the plate calculator could decompose.
 *
 * This is the normalization every row used to inherit from the `displayWeight()`
 * the caller piped it through (LIFT-1315), but at TWO decimals rather than one:
 * total-mode kg loading steps by a single 1.25 kg plate, and `toFixed(1)` would
 * round a legitimate 21.25 to an unloadable 21.3.
 */
function snapWeight(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Round a raw target UP to the nearest achievable total weight at/above the
 * bar. Ceiling (not nearest/floor) guarantees the resulting weight's intensity
 * MEETS OR EXCEEDS the selected intensity — so 100% reaches PR-beating loads.
 * `raw`, `barWeight`, and `increment` are all in the display unit.
 */
function ceilToLoadable(raw: number, barWeight: number, increment: number): number {
  const plateLoad = raw - barWeight
  if (plateLoad <= 0) return barWeight
  const ceiled = Math.ceil(plateLoad / increment) * increment
  return snapWeight(barWeight + ceiled)
}

/**
 * Generate an intensity table at `intensityPct`% of `oneRepMax`.
 *
 * `oneRepMax` — and every weight returned — is in the DISPLAY unit named by
 * `options.unit`, matching the bar and denominations. Callers holding the
 * canonical-lbs PR convert once, on the way in.
 *
 * For each rep count 1..maxReps, inverts Epley (e1RM = w·(1 + reps/30); 1 rep =
 * the 1RM itself, no multiplier) to find the weight at the target intensity,
 * then rounds it UP so the resulting set meets or beats that intensity. The
 * rounding mode: plate mode ceils to a loadable plate increment above the bar
 * (and attaches a per-side breakdown); numpad mode ceils to a clean 5 lbs /
 * 2.5 kg increment with no bar offset. In plate mode a target below the empty
 * bar is dropped (you can't load less than the bar).
 *
 * Returns an empty array when there is nothing meaningful to show — a
 * non-positive 1RM, or a non-positive intensity.
 */
export function generateIntensityTable(
  oneRepMax: number,
  intensityPct: number,
  options: IntensityTableOptions = {},
): IntensityRow[] {
  // `unit` is destructured first so the bar and plate defaults can follow it —
  // a hardcoded 45/LBS_PLATES is read by a kg user as a 45 kg bar (LIFT-1223).
  const {
    unit = 'lbs',
    barWeight = defaultBarWeight(unit),
    perSide = true,
    denominations = unit === 'kg' ? KG_PLATES : LBS_PLATES,
    maxReps = DEFAULT_INTENSITY_MAX_REPS,
    plateMode = true,
  } = options

  if (!Number.isFinite(oneRepMax) || oneRepMax <= 0) return []
  if (!Number.isFinite(intensityPct) || intensityPct <= 0) return []

  const targetE1RM = oneRepMax * (intensityPct / 100)
  const increment = smallestIncrement(denominations, perSide)
  const numpadStep = unit === 'kg' ? KG_NUMPAD_STEP : LBS_NUMPAD_STEP
  const cap = sanitizeIntensityMaxReps(maxReps)
  const rows: IntensityRow[] = []

  for (let r = 1; r <= cap; r++) {
    // Match the app's e1RM convention (see prTargetsTable / xp): a single rep IS
    // the 1RM — no Epley multiplier — so 100% intensity at 1 rep is the 1RM
    // itself. Only multi-rep sets get the (1 + reps/30) factor.
    const raw = r === 1 ? targetE1RM : targetE1RM / (1 + r / 30)

    let weight: number
    let plates: PlateSet | null = null
    if (plateMode) {
      // Below the empty bar there's nothing to load; a target AT the bar is the
      // valid "just the bar" suggestion (ceilToLoadable returns barWeight).
      if (raw < barWeight) continue
      weight = ceilToLoadable(raw, barWeight, increment)
      // The breakdown a per-side card shows is one sleeve's worth; total loading
      // has no such halving, so it gets no breakdown. Pass the mode through
      // rather than leaning on the default (LIFT-1312).
      plates = perSide ? weightToPlates(weight, barWeight, denominations, perSide) : null
    } else {
      // Numpad mode: a clean step in the unit the user reads, no bar offset.
      weight = snapWeight(Math.ceil(raw / numpadStep) * numpadStep)
    }

    // Defensive guard against a non-positive row (e.g. a degenerate 0 target).
    if (weight <= 0) continue
    // Rounded to a whole unit — this is a `~`-prefixed context readout, not a
    // loadable target. That leaves lbs output byte-identical to before the
    // display-unit move; kg users trade a decimal place for a correct number
    // (theirs was previously derived from the mixed-space weight).
    const e1rm = r === 1 ? weight : Math.round(weight * (1 + r / 30))
    rows.push({ reps: r, weight, e1rm, plates })
  }

  return rows
}
