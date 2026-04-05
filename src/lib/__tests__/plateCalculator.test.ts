import { describe, it, expect } from 'vitest'
import {
  platesToWeight,
  weightToPlates,
  plateDelta,
  formatPlates,
  formatDelta,
  LBS_PLATES,
  KG_PLATES,
} from '../plateCalculator'

describe('plateCalculator', () => {
  describe('platesToWeight', () => {
    it('returns bar weight with no plates', () => {
      expect(platesToWeight([], 45)).toBe(45)
    })

    it('calculates total from per-side plates', () => {
      // 45 bar + 2 × (45 + 45) = 225
      expect(platesToWeight([45, 45], 45)).toBe(225)
    })

    it('handles mixed plates', () => {
      // 45 bar + 2 × (45 + 25 + 10) = 205
      expect(platesToWeight([45, 25, 10], 45)).toBe(205)
    })

    it('handles custom bar weight', () => {
      // 35 bar + 2 × (45) = 125
      expect(platesToWeight([45], 35)).toBe(125)
    })

    it('handles 2.5 lb plates', () => {
      // 45 bar + 2 × (2.5) = 50
      expect(platesToWeight([2.5], 45)).toBe(50)
    })
  })

  describe('weightToPlates', () => {
    it('returns empty array for bar weight only', () => {
      expect(weightToPlates(45, 45)).toEqual([])
    })

    it('calculates plates for 135', () => {
      // (135 - 45) / 2 = 45 per side → [45]
      expect(weightToPlates(135, 45)).toEqual([45])
    })

    it('calculates plates for 225', () => {
      // (225 - 45) / 2 = 90 per side → [45, 45]
      expect(weightToPlates(225, 45)).toEqual([45, 45])
    })

    it('calculates plates for 315', () => {
      // (315 - 45) / 2 = 135 per side → [45, 45, 45]
      expect(weightToPlates(315, 45)).toEqual([45, 45, 45])
    })

    it('calculates plates for 185', () => {
      // (185 - 45) / 2 = 70 per side → [45, 25]
      expect(weightToPlates(185, 45)).toEqual([45, 25])
    })

    it('calculates plates for 205', () => {
      // (205 - 45) / 2 = 80 per side → [45, 25, 10]
      expect(weightToPlates(205, 45)).toEqual([45, 25, 10])
    })

    it('handles 2.5 lb increments', () => {
      // (50 - 45) / 2 = 2.5 per side → [2.5]
      expect(weightToPlates(50, 45)).toEqual([2.5])
    })

    it('returns null for weight below bar', () => {
      expect(weightToPlates(30, 45)).toBeNull()
    })

    it('returns null for impossible weight (odd remainder)', () => {
      // (46 - 45) / 2 = 0.5 — not achievable with standard plates
      expect(weightToPlates(46, 45)).toBeNull()
    })

    it('works with kg denominations', () => {
      // 20 bar + 2 × (20 + 10) = 80 kg
      expect(weightToPlates(80, 20, KG_PLATES)).toEqual([20, 10])
    })

    it('handles complex kg weight', () => {
      // 20 bar + 2 × (20 + 15 + 2.5) = 95 kg
      expect(weightToPlates(95, 20, KG_PLATES)).toEqual([20, 15, 2.5])
    })

    it('round-trips correctly for standard weights', () => {
      const weights = [45, 95, 135, 185, 225, 275, 315, 365, 405]
      for (const w of weights) {
        const plates = weightToPlates(w, 45)
        expect(plates).not.toBeNull()
        expect(platesToWeight(plates!, 45)).toBe(w)
      }
    })
  })

  describe('plateDelta', () => {
    it('returns empty for no change', () => {
      const delta = plateDelta([45, 25], [45, 25])
      expect(delta.add).toEqual([])
      expect(delta.remove).toEqual([])
    })

    it('detects added plates', () => {
      const delta = plateDelta([45], [45, 25])
      expect(delta.add).toEqual([25])
      expect(delta.remove).toEqual([])
    })

    it('detects removed plates', () => {
      const delta = plateDelta([45, 25], [45])
      expect(delta.add).toEqual([])
      expect(delta.remove).toEqual([25])
    })

    it('detects mixed add/remove', () => {
      // Going from 225 (2×45) to 205 (45+25+10): remove one 45, add 25+10
      const delta = plateDelta([45, 45], [45, 25, 10])
      expect(delta.remove).toEqual([45])
      expect(delta.add).toEqual([25, 10])
    })

    it('handles empty to loaded', () => {
      const delta = plateDelta([], [45, 25])
      expect(delta.add).toEqual([45, 25])
      expect(delta.remove).toEqual([])
    })
  })

  describe('formatPlates', () => {
    it('returns empty string for no plates', () => {
      expect(formatPlates([])).toBe('')
    })

    it('formats single plate type', () => {
      expect(formatPlates([45, 45])).toBe('2×45')
    })

    it('formats mixed plates', () => {
      expect(formatPlates([45, 45, 25, 10])).toBe('2×45 + 1×25 + 1×10')
    })
  })

  describe('formatDelta', () => {
    it('formats add only', () => {
      expect(formatDelta({ add: [25], remove: [] })).toBe('Add 1×25')
    })

    it('formats remove only', () => {
      expect(formatDelta({ add: [], remove: [45] })).toBe('Remove 1×45')
    })

    it('formats mixed', () => {
      expect(formatDelta({ add: [25, 10], remove: [45] })).toBe('Remove 1×45 · Add 1×25 + 1×10')
    })
  })
})
