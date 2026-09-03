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
import { epley } from '../epley'

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
      expect((row.weightLbs - 45) % 5).toBe(0)
    }
  })

  it('treats 1 rep as the 1RM (no Epley multiplier), matching prTargetsTable', () => {
    // 100% of a 400 1RM at 1 rep must be the 1RM itself (ceiled), not 400/1.033.
    const rows = generateIntensityTable(400, 100, { maxReps: 1 })
    expect(rows).toEqual([{ reps: 1, weightLbs: 400, e1rm: 400, plates: expect.any(Array) }])
  })

  it('computes the expected ceiled weights + e1RM (400 max, 100%, 3 reps)', () => {
    const rows = generateIntensityTable(400, 100, { maxReps: 3 })
    expect(rows).toEqual([
      { reps: 1, weightLbs: 400, e1rm: 400, plates: expect.any(Array) },
      { reps: 2, weightLbs: 375, e1rm: 400, plates: expect.any(Array) },
      { reps: 3, weightLbs: 365, e1rm: 402, plates: expect.any(Array) },
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
    expect(rows.every(r => r.weightLbs > 0)).toBe(true)
    expect(rows).toHaveLength(12)
  })

  it('numpad mode rounds up to clean 5 lb steps with no bar offset or plates', () => {
    const rows = generateIntensityTable(400, 80, { plateMode: false, maxReps: 3 })
    expect(rows).toEqual([
      { reps: 1, weightLbs: 320, e1rm: 320, plates: null },
      { reps: 2, weightLbs: 300, e1rm: 320, plates: null },
      { reps: 3, weightLbs: 295, e1rm: 325, plates: null },
    ])
  })

  it('numpad mode surfaces light weights that plate mode drops below the bar', () => {
    // 40% of 100 = 40 lb target — below the 45 lb bar.
    expect(generateIntensityTable(100, 40, { plateMode: true, maxReps: 1 })).toEqual([])
    expect(generateIntensityTable(100, 40, { plateMode: false, maxReps: 1 }))
      .toEqual([{ reps: 1, weightLbs: 40, e1rm: 40, plates: null }])
  })

  it('numpad kg mode rounds up in kg-space (clean 2.5 kg step, no plates)', () => {
    // 440 lb = 199.58 kg; 100% at 1 rep ceils to 200 kg → 441 lb.
    const rows = generateIntensityTable(440, 100, { plateMode: false, unit: 'kg', maxReps: 1 })
    expect(rows[0].plates).toBeNull()
    expect(rows[0].weightLbs).toBe(441)
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
      { reps: 1, weightLbs: 45, e1rm: 45, plates: [] },
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

  // A bodyweight-loaded exercise's PR is stored EFFECTIVE (bodyweight + added),
  // but the weight field — and so every row of this table — means ADDED (#1328).
  describe('baseLoadLbs (bodyweight-loaded exercises, #1328)', () => {
    // 163.4 lb lifter deliberately NOT on a 5 lb boundary: that is the case a
    // caller-side subtraction gets wrong.
    const BW = 163.4
    const opts = { perSide: false, barWeight: 0, plateMode: false as const, maxReps: 6 }

    it('returns the ADDED weight, with e1RM still measured on the full load', () => {
      const oneRM = 216 // epley(160 + 25, 5), a +25 x 5 pull-up
      const rows = generateIntensityTable(oneRM, 100, { ...opts, baseLoadLbs: BW })
      expect(rows.length).toBeGreaterThan(0)
      for (const row of rows) {
        // The suggestion is small — belt weight, not a barbell load.
        expect(row.weightLbs).toBeLessThan(oneRM - BW + 5)
        // ...but it still meets the intensity, because e1RM folds bodyweight in.
        expect(row.e1rm).toBeGreaterThanOrEqual(oneRM)
      }
    })

    it('ceils the ADDED portion, so every suggestion is actually loadable', () => {
      // The bug this guards: ceiling the effective total and subtracting the
      // bodyweight afterwards lands off the increment grid entirely (a lifter
      // told to add 16.6 lb).
      const rows = generateIntensityTable(216, 100, { ...opts, baseLoadLbs: BW })
      for (const row of rows) expect(row.weightLbs % 5).toBe(0)
    })

    it('drops rep rows the lifter\'s bodyweight already covers', () => {
      // At 60% of a 216 e1RM every rep target is under 163.4 lb, so there is no
      // added weight to suggest — not a 0-weight row, and not a negative one.
      const rows = generateIntensityTable(216, 60, { ...opts, baseLoadLbs: BW, maxReps: 12 })
      expect(rows).toEqual([])
    })

    it('agrees with the effective load a set logged from a row would store', () => {
      const rows = generateIntensityTable(216, 100, { ...opts, baseLoadLbs: BW, maxReps: 5 })
      for (const row of rows) {
        // `logSet` stores epley(added + bodyweight, reps) — the row's own e1RM.
        expect(epley(row.weightLbs + BW, row.reps)).toBe(Math.round(row.e1rm))
      }
    })

    it('is the identity at 0 / absent / invalid, leaving normal exercises untouched', () => {
      const plain = generateIntensityTable(456, 80, { maxReps: 5 })
      expect(generateIntensityTable(456, 80, { maxReps: 5, baseLoadLbs: 0 })).toEqual(plain)
      expect(generateIntensityTable(456, 80, { maxReps: 5, baseLoadLbs: -10 })).toEqual(plain)
      expect(generateIntensityTable(456, 80, { maxReps: 5, baseLoadLbs: NaN })).toEqual(plain)
    })
  })
})
