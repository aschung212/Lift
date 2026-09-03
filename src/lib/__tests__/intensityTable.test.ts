import { describe, it, expect } from 'vitest'
import {
  generateIntensityTable,
  sanitizeIntensityMaxReps,
  sanitizeIntensityPresets,
  nextPresetValue,
  pickNewPresetValue,
  DEFAULT_INTENSITY_MAX_REPS,
  MAX_INTENSITY_MAX_REPS,
  DEFAULT_INTENSITY_PRESETS,
  MAX_INTENSITY_PRESETS,
} from '../intensityTable'
import { KG_PLATES, platesToWeight, weightToPlates } from '../plateCalculator'

describe('sanitizeIntensityMaxReps', () => {
  it('defaults non-numbers', () => {
    expect(sanitizeIntensityMaxReps(undefined)).toBe(DEFAULT_INTENSITY_MAX_REPS)
    expect(sanitizeIntensityMaxReps('abc')).toBe(DEFAULT_INTENSITY_MAX_REPS)
    expect(sanitizeIntensityMaxReps(NaN)).toBe(DEFAULT_INTENSITY_MAX_REPS)
  })

  it('floors fractional values', () => {
    expect(sanitizeIntensityMaxReps(8.9)).toBe(8)
  })

  it('clamps to [1, 100]', () => {
    expect(sanitizeIntensityMaxReps(0)).toBe(1)
    expect(sanitizeIntensityMaxReps(-5)).toBe(1)
    expect(sanitizeIntensityMaxReps(500)).toBe(MAX_INTENSITY_MAX_REPS)
  })
})

describe('sanitizeIntensityPresets', () => {
  it('falls back to defaults for a non-array', () => {
    expect(sanitizeIntensityPresets(undefined)).toEqual(DEFAULT_INTENSITY_PRESETS)
    expect(sanitizeIntensityPresets(null)).toEqual(DEFAULT_INTENSITY_PRESETS)
    expect(sanitizeIntensityPresets('80,90')).toEqual(DEFAULT_INTENSITY_PRESETS)
    // Defaults are returned as a fresh copy, not the shared constant.
    expect(sanitizeIntensityPresets(undefined)).not.toBe(DEFAULT_INTENSITY_PRESETS)
  })

  it('keeps an explicit empty array empty (user cleared all presets)', () => {
    expect(sanitizeIntensityPresets([])).toEqual([])
  })

  it('floors, dedupes, and sorts ascending', () => {
    expect(sanitizeIntensityPresets([90, 60, 80, 60, 75.9])).toEqual([60, 75, 80, 90])
  })

  it('drops out-of-range and non-finite values', () => {
    expect(sanitizeIntensityPresets([0, 1, 100, 101, -5, NaN, Infinity, 'x'])).toEqual([1, 100])
  })

  it('coerces numeric strings', () => {
    expect(sanitizeIntensityPresets(['60', '80'])).toEqual([60, 80])
  })

  it('caps at MAX_INTENSITY_PRESETS (keeps the lowest)', () => {
    const many = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    const out = sanitizeIntensityPresets(many)
    expect(out).toHaveLength(MAX_INTENSITY_PRESETS)
    expect(out).toEqual([10, 20, 30, 40, 50, 60, 70, 80])
  })
})

describe('nextPresetValue', () => {
  it('steps by 5 in the given direction', () => {
    expect(nextPresetValue([80], 80, 1)).toBe(85)
    expect(nextPresetValue([80], 80, -1)).toBe(75)
  })

  it('skips occupied values so two presets never collapse', () => {
    // Stepping 75 up would hit 80 (taken) → jumps to the next free value, 85.
    expect(nextPresetValue([75, 80], 75, 1)).toBe(85)
    expect(nextPresetValue([70, 75, 80], 80, -1)).toBe(65) // 80 → 75(taken) → 70(taken) → 65
  })

  it('returns null when blocked at the range bounds', () => {
    expect(nextPresetValue([100], 100, 1)).toBeNull()
    expect(nextPresetValue([5], 5, -1)).toBeNull()
    // 95 up: 100 free → not blocked.
    expect(nextPresetValue([95], 95, 1)).toBe(100)
  })
})

describe('pickNewPresetValue', () => {
  it('prefers 80 when free', () => {
    expect(pickNewPresetValue([50, 90])).toBe(80)
  })

  it('falls back to the first free step from the minimum when 80 is taken', () => {
    expect(pickNewPresetValue([80])).toBe(5)
    expect(pickNewPresetValue([5, 80])).toBe(10)
  })

  it('returns null when the list is already at the cap', () => {
    const full = [10, 20, 30, 40, 50, 60, 70, 80] // MAX_INTENSITY_PRESETS entries
    expect(pickNewPresetValue(full)).toBeNull()
  })
})

describe('generateIntensityTable', () => {
  it('ceils each weight so its e1RM meets or exceeds the target intensity', () => {
    const rows = generateIntensityTable(456, 80, { maxReps: 8 })
    expect(rows.length).toBeGreaterThan(0)
    const targetE1RM = 456 * 0.8
    for (const row of rows) {
      // Ceiling guarantees the set always meets/beats the selected intensity.
      expect(row.e1rm).toBeGreaterThanOrEqual(targetE1RM - 1e-9)
      // Ceiled to a loadable 5 lb increment above the 45 lb bar.
      expect((row.weight - 45) % 5).toBe(0)
    }
  })

  it('treats 1 rep as the 1RM (no Epley multiplier), matching prTargetsTable', () => {
    // 100% of a 400 1RM at 1 rep must be the 1RM itself (ceiled), not 400/1.033.
    const rows = generateIntensityTable(400, 100, { maxReps: 1 })
    expect(rows).toEqual([{ reps: 1, weight: 400, e1rm: 400, plates: expect.any(Array) }])
  })

  it('computes the expected ceiled weights + e1RM (400 max, 100%, 3 reps)', () => {
    const rows = generateIntensityTable(400, 100, { maxReps: 3 })
    expect(rows).toEqual([
      { reps: 1, weight: 400, e1rm: 400, plates: expect.any(Array) },
      { reps: 2, weight: 375, e1rm: 400, plates: expect.any(Array) },
      { reps: 3, weight: 365, e1rm: 402, plates: expect.any(Array) },
    ])
  })

  it('reaches PR-beating loads at 100% (ceiling is what lets one table span warmup→PR)', () => {
    // Every row at 100% must have an e1RM at least the 1RM — i.e. it "beats or
    // ties" the PR at that rep count, which is the old PR lens's whole job.
    const rows = generateIntensityTable(300, 100, { maxReps: 5 })
    expect(rows.length).toBe(5)
    for (const row of rows) expect(row.e1rm).toBeGreaterThanOrEqual(300)
  })

  it('never emits a 0-weight row in machine/total mode (ceiling rounds up off 0)', () => {
    // Low intensity on a machine (bar 0): ceiling rounds every rep up to at
    // least one increment, so no row is a 0-weight (un-loggable) suggestion.
    const rows = generateIntensityTable(30, 10, { perSide: false, barWeight: 0, maxReps: 12 })
    expect(rows.every(r => r.weight > 0)).toBe(true)
    expect(rows).toHaveLength(12)
  })

  it('numpad mode rounds up to clean 5 lb steps with no bar offset or plates', () => {
    const rows = generateIntensityTable(400, 80, { plateMode: false, maxReps: 3 })
    expect(rows).toEqual([
      { reps: 1, weight: 320, e1rm: 320, plates: null },
      { reps: 2, weight: 300, e1rm: 320, plates: null },
      { reps: 3, weight: 295, e1rm: 325, plates: null },
    ])
  })

  it('numpad mode surfaces light weights that plate mode drops below the bar', () => {
    // 40% of 100 = 40 lb target — below the 45 lb bar.
    expect(generateIntensityTable(100, 40, { plateMode: true, maxReps: 1 })).toEqual([])
    expect(generateIntensityTable(100, 40, { plateMode: false, maxReps: 1 }))
      .toEqual([{ reps: 1, weight: 40, e1rm: 40, plates: null }])
  })

  it('numpad kg mode rounds up to a clean 2.5 kg step (no plates)', () => {
    // A 199.6 kg max at 100%, 1 rep, ceils to the next 2.5 kg step: 200 kg.
    const rows = generateIntensityTable(199.6, 100, { plateMode: false, unit: 'kg', maxReps: 1 })
    expect(rows[0].plates).toBeNull()
    expect(rows[0].weight).toBe(200)
  })

  it('caps the rows at maxReps (sanitized)', () => {
    expect(generateIntensityTable(456, 90, { maxReps: 3 })).toHaveLength(3)
    // 0 sanitizes to 1 row
    expect(generateIntensityTable(456, 90, { maxReps: 0 })).toHaveLength(1)
  })

  it('drops rep rows whose target weight sits below the bar', () => {
    // 20% of 200 = 40 lb target e1RM — below the 45 lb bar at every rep count.
    expect(generateIntensityTable(200, 20)).toEqual([])
  })

  it('surfaces the empty bar when the target lands exactly on it', () => {
    // 100% of a 45 lb 1RM at 1 rep = 45 = the bar itself: a valid "just the bar"
    // row, not dropped.
    expect(generateIntensityTable(45, 100, { maxReps: 1 })).toEqual([
      { reps: 1, weight: 45, e1rm: 45, plates: [] },
    ])
  })

  it('returns empty for a non-positive 1RM or intensity', () => {
    expect(generateIntensityTable(0, 80)).toEqual([])
    expect(generateIntensityTable(-100, 80)).toEqual([])
    expect(generateIntensityTable(456, 0)).toEqual([])
  })

  it('omits plate breakdowns for non-per-side (machine) loading', () => {
    const rows = generateIntensityTable(456, 80, { perSide: false, barWeight: 0, maxReps: 4 })
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(r => r.plates === null)).toBe(true)
  })

  /**
   * Regression: LIFT-1315 — the generator was documented and written in
   * canonical lbs while being handed a DISPLAY-unit bar and DISPLAY-unit
   * denominations (LIFT-1211 put the whole plate subsystem in display units).
   * For lbs users the two spaces coincide, so nothing here caught it; the one
   * kg case that existed was `plateMode: false`, the only path that was already
   * unit-correct. Plate mode + kg had no coverage anywhere.
   *
   * Every weight is now in the display unit, so the invariant a kg case must
   * pin is INTERNAL CONSISTENCY: the row's own plates must total the row's own
   * weight, because the log sheet loads the plates and re-derives the field
   * from them. When they disagreed, a row labelled 69.2 kg filled the field
   * with 152.5 kg — savable, and a fake all-time PR.
   */
  describe('kg plate mode (LIFT-1315)', () => {
    const KG_BAR = 20
    // 220 lbs ≈ 99.8 kg — the issue's repro lifter.
    const KG_MAX = 99.8

    it('ceils onto the kg bar in kg steps, not lbs ones', () => {
      const rows = generateIntensityTable(KG_MAX, 80, {
        unit: 'kg', barWeight: KG_BAR, denominations: KG_PLATES, maxReps: 5,
      })
      for (const row of rows) {
        // Loadable = the 20 kg bar plus a whole number of 2.5 kg (1.25/side) steps.
        expect((row.weight - KG_BAR) % 2.5).toBe(0)
      }
      // 5 reps: 79.84 / (1 + 5/30) = 68.4 kg → next loadable step is 70 kg.
      expect(rows.find(r => r.reps === 5)!.weight).toBe(70)
    })

    it('returns plates whose total IS the row weight (the tapped-row invariant)', () => {
      const rows = generateIntensityTable(KG_MAX, 80, {
        unit: 'kg', barWeight: KG_BAR, denominations: KG_PLATES, maxReps: 10,
      })
      expect(rows.length).toBeGreaterThan(0)
      for (const row of rows) {
        expect(row.plates).not.toBeNull()
        // This is exactly what the log sheet does on tap: load the plates, then
        // re-derive the weight field from them. Pre-fix the field came out 2.2×
        // the label because the plates decomposed a lbs number as kg.
        expect(platesToWeight(row.plates!, KG_BAR)).toBe(row.weight)
      }
    })

    it('drops rows below the kg bar instead of measuring them against a lbs one', () => {
      // 25% of 99.8 = 24.95 kg; past 7 reps the target falls under the 20 kg
      // bar. Pre-fix `raw` was in lbs (55) and the bar in kg (20), so nothing
      // was ever dropped and the lens offered 10 unloadable rows.
      const rows = generateIntensityTable(KG_MAX, 25, {
        unit: 'kg', barWeight: KG_BAR, denominations: KG_PLATES, maxReps: 10,
      })
      expect(rows.map(r => r.reps)).toEqual([1, 2, 3, 4, 5, 6, 7])
      expect(rows.every(r => r.weight >= KG_BAR)).toBe(true)
    })

    it('reports each row e1RM in the same unit as the row weight', () => {
      const rows = generateIntensityTable(KG_MAX, 100, {
        unit: 'kg', barWeight: KG_BAR, denominations: KG_PLATES, maxReps: 3,
      })
      // At 100% every row must meet or beat the kg max — the check that the
      // e1RM column is derived from a same-space weight.
      for (const row of rows) expect(row.e1rm).toBeGreaterThanOrEqual(KG_MAX)
      expect(rows[0]).toEqual({ reps: 1, weight: 100, e1rm: 100, plates: [20, 20] })
    })

    it('defaults an unspecified bar and plate set to the kg ones', () => {
      // No hardcoded 45: a kg caller that omits the bar gets the 20 kg standard
      // (LIFT-1223), and KG_PLATES rather than LBS_PLATES.
      const rows = generateIntensityTable(KG_MAX, 100, { unit: 'kg', maxReps: 1 })
      expect(rows[0].weight).toBe(100)
      expect(platesToWeight(rows[0].plates!, 20)).toBe(100)
    })

    it('keeps a 1.25 kg total-mode step loadable (not rounded to one decimal)', () => {
      // Total mode's increment is a single 1.25 kg plate, so weights land on
      // .25 boundaries. Total mode gets no plate breakdown, so the caller writes
      // the number straight into the weight field and the reverse sync
      // decomposes it — a `toFixed(1)` normalization (which is what the
      // displayWeight() this replaced did) would turn 23.75 into an unloadable
      // 23.8 and blank the plate card.
      const rows = generateIntensityTable(25, 100, {
        unit: 'kg', barWeight: 20, denominations: KG_PLATES, perSide: false, maxReps: 4,
      })
      expect(rows.map(r => r.weight)).toEqual([25, 23.75, 23.75, 22.5])
      for (const row of rows) {
        expect(weightToPlates(row.weight, 20, KG_PLATES, false)).not.toBeNull()
      }
    })
  })
})
