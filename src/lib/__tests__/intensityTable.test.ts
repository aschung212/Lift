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
  it('floors each weight so its e1RM never exceeds the target intensity', () => {
    const rows = generateIntensityTable(456, 80, { maxReps: 8 })
    expect(rows.length).toBeGreaterThan(0)
    const targetE1RM = 456 * 0.8
    for (const row of rows) {
      // Convention: 1 rep IS the 1RM (no Epley multiplier).
      const e1rm = row.reps === 1 ? row.weightLbs : row.weightLbs * (1 + row.reps / 30)
      expect(e1rm).toBeLessThanOrEqual(targetE1RM + 1e-9)
      // Floored to a loadable 5 lb increment above the 45 lb bar.
      expect((row.weightLbs - 45) % 5).toBe(0)
    }
  })

  it('treats 1 rep as the 1RM (no Epley multiplier), matching prTargetsTable', () => {
    // 100% of a 400 1RM at 1 rep must be the 1RM itself (floored), not 400/1.033.
    const rows = generateIntensityTable(400, 100, { maxReps: 1 })
    expect(rows).toEqual([{ reps: 1, weightLbs: 400, plates: expect.any(Array) }])
  })

  it('computes the expected floored weights (400 max, 100%, 3 reps)', () => {
    const rows = generateIntensityTable(400, 100, { maxReps: 3 })
    expect(rows).toEqual([
      { reps: 1, weightLbs: 400, plates: expect.any(Array) },
      { reps: 2, weightLbs: 375, plates: expect.any(Array) },
      { reps: 3, weightLbs: 360, plates: expect.any(Array) },
    ])
  })

  it('never emits a 0-weight row in machine/total mode', () => {
    // Low intensity on a machine (bar 0): floored weights can round to 0 — those
    // rows must be dropped, not surfaced as un-loggable 0-weight suggestions.
    const rows = generateIntensityTable(60, 15, { perSide: false, barWeight: 0, maxReps: 12 })
    expect(rows.every(r => r.weightLbs > 0)).toBe(true)
  })

  it('caps the rows at maxReps (sanitized)', () => {
    expect(generateIntensityTable(456, 90, { maxReps: 3 })).toHaveLength(3)
    // 0 sanitizes to 1 row
    expect(generateIntensityTable(456, 90, { maxReps: 0 })).toHaveLength(1)
  })

  it('drops rep rows whose target weight sits at/below the bar', () => {
    // 20% of 200 = 40 lb target e1RM — below the 45 lb bar at every rep count.
    expect(generateIntensityTable(200, 20)).toEqual([])
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
