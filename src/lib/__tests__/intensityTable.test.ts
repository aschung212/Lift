import { describe, it, expect } from 'vitest'
import {
  generateIntensityTable,
  sanitizeIntensityMaxReps,
  DEFAULT_INTENSITY_MAX_REPS,
  MAX_INTENSITY_MAX_REPS,
} from '../intensityTable'

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
})
