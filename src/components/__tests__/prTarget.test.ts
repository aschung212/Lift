import { describe, it, expect } from 'vitest'
import { epley } from '../../lib/epley'

/**
 * Tests for the inverse Epley formulas used in PR target calculations.
 *
 * Epley: e1RM = weight * (1 + reps / 30)
 * Inverse for weight: weight = e1RM / (1 + reps / 30)
 * Inverse for reps: reps = 30 * (e1RM / weight - 1)
 */

function prTargetWeight(currentPR: number, reps: number): number {
  const target = currentPR + 1
  if (reps === 1) return target
  return Math.ceil(target / (1 + reps / 30))
}

function prTargetReps(currentPR: number, weightLbs: number): number | null {
  const target = currentPR + 1
  if (weightLbs >= target) return 0 // any rep beats it
  const needed = Math.ceil(30 * (target / weightLbs - 1))
  return needed > 30 ? null : needed
}

describe('PR target calculations (inverse Epley)', () => {
  describe('prTargetWeight', () => {
    it('computes weight needed to beat PR at given reps', () => {
      // PR is 300 lbs. At 5 reps, need weight such that epley(w, 5) > 300
      const w = prTargetWeight(300, 5)
      expect(epley(w, 5)).toBeGreaterThan(300)
      // One less pound should NOT beat it
      expect(epley(w - 1, 5)).toBeLessThanOrEqual(300)
    })

    it('at 1 rep, weight = PR + 1', () => {
      expect(prTargetWeight(300, 1)).toBe(301)
    })

    it('at higher reps, less weight is needed', () => {
      const w5 = prTargetWeight(400, 5)
      const w10 = prTargetWeight(400, 10)
      expect(w10).toBeLessThan(w5)
    })
  })

  describe('prTargetReps', () => {
    it('computes reps needed to beat PR at given weight', () => {
      // PR is 300 lbs. At 225 lbs, need enough reps to beat 300
      const r = prTargetReps(300, 225)
      expect(r).not.toBeNull()
      expect(epley(225, r!)).toBeGreaterThan(300)
    })

    it('returns 0 when weight alone exceeds PR', () => {
      // Weight of 350 at 1 rep = 350, which beats PR of 300
      expect(prTargetReps(300, 350)).toBe(0)
    })

    it('returns null when reps needed exceeds 30', () => {
      // Very light weight relative to PR
      expect(prTargetReps(400, 100)).toBeNull()
    })

    it('returns correct reps at weight equal to PR', () => {
      // Weight equals PR exactly — need at least 1 rep at higher e1RM
      const r = prTargetReps(300, 300)
      // 300 * (1 + r/30) > 300 → r > 0, so minimum is 1
      expect(r).toBe(1)
    })
  })
})
