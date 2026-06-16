import { describe, it, expect } from 'vitest'
import {
  generateWarmupRamp,
  DEFAULT_WARMUP_SCHEME,
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
})
