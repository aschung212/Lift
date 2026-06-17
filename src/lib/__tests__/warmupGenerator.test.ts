import { describe, it, expect } from 'vitest'
import {
  generateWarmupRamp,
  DEFAULT_WARMUP_SCHEME,
  sanitizeWarmupScheme,
  schemesEqual,
  MAX_WARMUP_STEPS,
  MIN_WARMUP_PCT,
  MAX_WARMUP_PCT,
  MAX_WARMUP_REPS,
  type WarmupStep,
} from '../warmupGenerator'
import { KG_PLATES, platesToWeight } from '../plateCalculator'

const weights = (steps: WarmupStep[]) => steps.map(s => s.weightLbs)

describe('warmupGenerator', () => {
  describe('generateWarmupRamp', () => {
    it('ramps up to a heavy barbell working weight', () => {
      const ramp = generateWarmupRamp(225)
      // 40/60/80/90% of 225 = 90/135/180/202.5 → loadable: 90/135/180/205
      expect(weights(ramp)).toEqual([90, 135, 180, 205])
      expect(ramp.map(s => s.reps)).toEqual([8, 5, 3, 1])
    })

    it('rounds every step to a loadable per-side weight', () => {
      const ramp = generateWarmupRamp(225)
      for (const step of ramp) {
        expect(step.plates).not.toBeNull()
        // weight must reconstruct exactly from its plates + bar
        expect(platesToWeight(step.plates!, 45)).toBe(step.weightLbs)
      }
    })

    it('keeps the whole ramp strictly below the working weight', () => {
      const ramp = generateWarmupRamp(135)
      for (const step of ramp) {
        expect(step.weightLbs).toBeLessThan(135)
      }
    })

    it('returns nothing for a working weight at or below the bar', () => {
      expect(generateWarmupRamp(45)).toEqual([])
      expect(generateWarmupRamp(30)).toEqual([])
    })

    it('returns nothing for non-positive or non-finite input', () => {
      expect(generateWarmupRamp(0)).toEqual([])
      expect(generateWarmupRamp(-100)).toEqual([])
      expect(generateWarmupRamp(NaN)).toEqual([])
      expect(generateWarmupRamp(Infinity)).toEqual([])
    })

    it('de-duplicates rungs that round to the same weight', () => {
      // Light working weight: percentages collapse onto the bar / same rung.
      const ramp = generateWarmupRamp(65)
      const unique = new Set(weights(ramp))
      expect(unique.size).toBe(ramp.length)
    })

    it('respects a custom bar weight', () => {
      const ramp = generateWarmupRamp(135, { barWeight: 35 })
      for (const step of ramp) {
        // each step is the 35 bar + an even per-side load
        expect((step.weightLbs - 35) % 5).toBeCloseTo(0)
        expect(step.weightLbs).toBeGreaterThanOrEqual(35)
      }
    })

    it('supports kg plate denominations', () => {
      // Work in lbs-space but with the finer kg plate set (smallest 1.25 kg/side → 2.5 lbs increment)
      const ramp = generateWarmupRamp(100, { barWeight: 45, denominations: KG_PLATES })
      for (const step of ramp) {
        expect(platesToWeight(step.plates!, 45)).toBe(step.weightLbs)
      }
    })

    it('omits plate breakdowns for non-per-side (machine) loading', () => {
      const ramp = generateWarmupRamp(200, { perSide: false, barWeight: 0 })
      expect(ramp.length).toBeGreaterThan(0)
      for (const step of ramp) {
        expect(step.plates).toBeNull()
        expect(step.weightLbs).toBeLessThan(200)
      }
    })

    it('honors a custom scheme', () => {
      const ramp = generateWarmupRamp(200, {
        scheme: [{ pct: 0.5, reps: 5 }],
      })
      expect(ramp).toHaveLength(1)
      expect(ramp[0].weightLbs).toBe(100)
      expect(ramp[0].reps).toBe(5)
      expect(ramp[0].pct).toBe(0.5)
    })

    it('exposes a sane default scheme that ascends in weight and descends in reps', () => {
      const pcts = DEFAULT_WARMUP_SCHEME.map(s => s.pct)
      const reps = DEFAULT_WARMUP_SCHEME.map(s => s.reps)
      const ascending = [...pcts].sort((a, b) => a - b)
      const descending = [...reps].sort((a, b) => b - a)
      expect(pcts).toEqual(ascending)
      expect(reps).toEqual(descending)
      expect(pcts[pcts.length - 1]).toBeLessThan(1)
    })
  })

  describe('sanitizeWarmupScheme', () => {
    it('passes a clean scheme through unchanged', () => {
      const scheme = [{ pct: 0.5, reps: 5 }, { pct: 0.75, reps: 3 }]
      expect(sanitizeWarmupScheme(scheme)).toEqual(scheme)
    })

    it('preserves an empty scheme (explicit "no warmup")', () => {
      expect(sanitizeWarmupScheme([])).toEqual([])
    })

    it('falls back to the default for a non-array input (corrupt remote JSON)', () => {
      expect(sanitizeWarmupScheme(null)).toEqual(DEFAULT_WARMUP_SCHEME)
      expect(sanitizeWarmupScheme('nope')).toEqual(DEFAULT_WARMUP_SCHEME)
      expect(sanitizeWarmupScheme({ pct: 0.5 })).toEqual(DEFAULT_WARMUP_SCHEME)
      // A returned default must be a copy, not the shared module constant.
      expect(sanitizeWarmupScheme(null)).not.toBe(DEFAULT_WARMUP_SCHEME)
    })

    it('clamps out-of-range percentages and reps into bounds', () => {
      const out = sanitizeWarmupScheme([
        { pct: 0, reps: 100 },     // pct too low, reps too high
        { pct: 2, reps: 0 },       // pct too high, reps too low
      ])
      expect(out[0]).toEqual({ pct: MIN_WARMUP_PCT, reps: MAX_WARMUP_REPS })
      expect(out[1]).toEqual({ pct: MAX_WARMUP_PCT, reps: 1 })
    })

    it('rounds fractional reps and drops malformed / non-finite entries', () => {
      const out = sanitizeWarmupScheme([
        { pct: 0.5, reps: 5.7 },
        { pct: NaN, reps: 5 },
        { pct: 0.5, reps: Infinity },
        null,
        'garbage',
        { pct: 0.6, reps: 4 },
      ])
      expect(out).toEqual([{ pct: 0.5, reps: 6 }, { pct: 0.6, reps: 4 }])
    })

    it('caps the number of steps at MAX_WARMUP_STEPS', () => {
      const many = Array.from({ length: 20 }, () => ({ pct: 0.5, reps: 5 }))
      expect(sanitizeWarmupScheme(many)).toHaveLength(MAX_WARMUP_STEPS)
    })
  })

  describe('schemesEqual', () => {
    it('is true for value-equal schemes and the default round-trip', () => {
      expect(schemesEqual(DEFAULT_WARMUP_SCHEME, DEFAULT_WARMUP_SCHEME)).toBe(true)
      // Percentages rebuilt from whole-percent editor state still match.
      const rebuilt = DEFAULT_WARMUP_SCHEME.map(s => ({ pct: Math.round(s.pct * 100) / 100, reps: s.reps }))
      expect(schemesEqual(rebuilt, DEFAULT_WARMUP_SCHEME)).toBe(true)
    })

    it('is false when length, percentages, or reps differ', () => {
      expect(schemesEqual([{ pct: 0.4, reps: 8 }], [{ pct: 0.4, reps: 8 }, { pct: 0.6, reps: 5 }])).toBe(false)
      expect(schemesEqual([{ pct: 0.4, reps: 8 }], [{ pct: 0.5, reps: 8 }])).toBe(false)
      expect(schemesEqual([{ pct: 0.4, reps: 8 }], [{ pct: 0.4, reps: 6 }])).toBe(false)
    })
  })

  describe('generateWarmupRamp with a custom (sanitized) scheme', () => {
    it('drives the ramp from a user scheme and stays loadable', () => {
      const scheme = sanitizeWarmupScheme([{ pct: 0.4, reps: 10 }, { pct: 0.7, reps: 2 }])
      const ramp = generateWarmupRamp(225, { scheme })
      expect(ramp.map(s => s.reps)).toEqual([10, 2])
      expect(weights(ramp)).toEqual([90, 160]) // 0.4·225=90; 0.7·225=157.5 → 160 loadable
    })

    it('produces no ramp for an empty scheme', () => {
      expect(generateWarmupRamp(225, { scheme: [] })).toEqual([])
    })
  })
})
