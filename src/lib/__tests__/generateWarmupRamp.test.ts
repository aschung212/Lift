import { describe, it, expect } from 'vitest'
import {
  generateWarmupRamp,
  DEFAULT_WARMUP_SCHEME,
  type WarmupStep,
} from '../generateWarmupRamp'
import { LBS_PLATES, KG_PLATES } from '../plateCalculator'

const weights = (steps: WarmupStep[]) => steps.map(s => s.weight)

describe('generateWarmupRamp', () => {
  describe('standard barbell ramp', () => {
    it('ramps an empty bar up to a 225 lb working set', () => {
      const ramp = generateWarmupRamp(225, { barWeight: 45 })
      expect(weights(ramp)).toEqual([45, 90, 135, 180])
      expect(ramp.map(s => s.reps)).toEqual([8, 5, 3, 2])
    })

    it('opens with an empty bar carrying no plates', () => {
      const [bar] = generateWarmupRamp(225, { barWeight: 45 })
      expect(bar.pct).toBe(0)
      expect(bar.weight).toBe(45)
      expect(bar.plates).toEqual([])
    })

    it('computes per-side plate loading for each step', () => {
      const ramp = generateWarmupRamp(225, { barWeight: 45 })
      // 90 = 45 bar + 2×(10+10+2.5); 135 = 45 + 2×45; 180 = 45 + 2×(45+10+10+2.5)
      expect(ramp[1].plates).toEqual([10, 10, 2.5])
      expect(ramp[2].plates).toEqual([45])
      expect(ramp[3].plates).toEqual([45, 10, 10, 2.5])
    })

    it('rounds each step to an achievable load (135 lb working set)', () => {
      const ramp = generateWarmupRamp(135, { barWeight: 45 })
      expect(weights(ramp)).toEqual([45, 55, 80, 110])
    })
  })

  describe('invariants', () => {
    it('returns steps in ascending weight order, all below the working weight', () => {
      const ramp = generateWarmupRamp(315, { barWeight: 45 })
      for (let i = 1; i < ramp.length; i++) {
        expect(ramp[i].weight).toBeGreaterThan(ramp[i - 1].weight)
      }
      for (const step of ramp) {
        expect(step.weight).toBeLessThan(315)
        expect(step.reps).toBeGreaterThan(0)
      }
    })

    it('never emits two steps at the same weight', () => {
      const ramp = generateWarmupRamp(60, { barWeight: 45 })
      const ws = weights(ramp)
      expect(new Set(ws).size).toBe(ws.length)
    })

    it('collapses sub-bar percentage steps into the empty-bar opener', () => {
      // At 60 lb working with a 45 lb bar, the 40%/60% steps round down to the
      // bar and are dropped; only the bar set and the 80% step survive.
      const ramp = generateWarmupRamp(60, { barWeight: 45 })
      expect(weights(ramp)).toEqual([45, 50])
    })
  })

  describe('trivial / invalid inputs', () => {
    it('returns no ramp when the working weight is at or below the bar', () => {
      expect(generateWarmupRamp(45, { barWeight: 45 })).toEqual([])
      expect(generateWarmupRamp(40, { barWeight: 45 })).toEqual([])
    })

    it('returns no ramp for zero, negative, or non-finite working weights', () => {
      expect(generateWarmupRamp(0)).toEqual([])
      expect(generateWarmupRamp(-50)).toEqual([])
      expect(generateWarmupRamp(NaN)).toEqual([])
      expect(generateWarmupRamp(Infinity, { barWeight: 45 })).toEqual([])
    })
  })

  describe('options', () => {
    it('omits the empty-bar opener when includeBarSet is false', () => {
      const ramp = generateWarmupRamp(225, { barWeight: 45, includeBarSet: false })
      expect(weights(ramp)).toEqual([90, 135, 180])
      expect(ramp.every(s => s.pct > 0)).toBe(true)
    })

    it('honours a custom percentage/rep scheme', () => {
      const ramp = generateWarmupRamp(200, {
        barWeight: 45,
        includeBarSet: false,
        scheme: [{ pct: 0.5, reps: 4 }],
      })
      expect(ramp).toHaveLength(1)
      expect(ramp[0].weight).toBe(100)
      expect(ramp[0].reps).toBe(4)
    })

    it('supports total/machine loading where plates are not mirrored', () => {
      const ramp = generateWarmupRamp(100, {
        barWeight: 0,
        perSide: false,
        denominations: LBS_PLATES,
      })
      expect(weights(ramp)).toEqual([40, 60, 80])
      // 40 total = 25 + 10 + 5 (not halved)
      expect(ramp[0].plates).toEqual([25, 10, 5])
    })

    it('works with kilogram denominations and a 20 kg bar', () => {
      const ramp = generateWarmupRamp(100, { barWeight: 20, denominations: KG_PLATES })
      expect(weights(ramp)).toEqual([20, 40, 60, 80])
      expect(ramp[3].plates).toEqual([20, 10])
    })
  })

  describe('DEFAULT_WARMUP_SCHEME', () => {
    it('ramps lighter-for-more-reps to heavier-for-fewer', () => {
      expect(DEFAULT_WARMUP_SCHEME.map(s => s.pct)).toEqual([0.4, 0.6, 0.8])
      expect(DEFAULT_WARMUP_SCHEME.map(s => s.reps)).toEqual([5, 3, 2])
    })
  })
})
