import { describe, it, expect } from 'vitest'
import {
  platesToWeight,
  weightToPlates,
  plateDelta,
  formatPlates,
  formatDelta,
  denomValues,
  sanitizePlateInventory,
  emptyPlateInventory,
  ownedPlateStock,
  defaultOwnedPairs,
  MAX_PLATE_PAIRS,
  type PlateStock,
  KG_PLATES,
  LBS_PLATES,
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

    describe('finite plate supply (#835)', () => {
      it('never suggests more of a plate than the user owns', () => {
        // Owns one pair of 25s. Target 145 = 50 per side. Unlimited greedy would
        // be [25, 25]; with a single 25 available it must use the 25 + 10s + 5.
        const stock: PlateStock[] = [
          { denom: 45, count: 0 },
          { denom: 25, count: 1 },
          { denom: 10, count: 4 },
          { denom: 5, count: 2 },
          { denom: 2.5, count: 2 },
        ]
        const plates = weightToPlates(145, 45, stock)
        expect(plates).not.toBeNull()
        expect(platesToWeight(plates!, 45)).toBe(145)
        expect(plates!.filter(p => p === 25).length).toBeLessThanOrEqual(1)
      })

      it('backtracks when the greedy choice strands the remainder', () => {
        // perSide 30: greedy takes the single 25 then cannot make 5 (no 5s/2.5s),
        // but 3×10 works — the solver must backtrack off the 25.
        const stock: PlateStock[] = [
          { denom: 25, count: 1 },
          { denom: 10, count: 5 },
        ]
        const plates = weightToPlates(105, 45, stock) // 30 per side
        expect(plates).toEqual([10, 10, 10])
      })

      it('returns null when the owned plates cannot reach the target', () => {
        const stock: PlateStock[] = [{ denom: 10, count: 2 }]
        // Max loadable = 45 + 2×(2×10) = 85; 135 is unreachable.
        expect(weightToPlates(135, 45, stock)).toBeNull()
      })

      it('drops zero/negative-count stock entries', () => {
        const stock: PlateStock[] = [
          { denom: 45, count: 0 },
          { denom: 25, count: 2 },
        ]
        // 25s only: 45 + 2×25 = 95.
        expect(weightToPlates(95, 45, stock)).toEqual([25])
      })

      it('treats a plain number[] as unlimited supply (greedy parity)', () => {
        expect(weightToPlates(315, 45, [45, 25, 10, 5, 2.5])).toEqual([45, 45, 45])
      })
    })
  })

  describe('denomValues', () => {
    it('returns the values for a plain denomination list', () => {
      expect(denomValues(LBS_PLATES)).toEqual([45, 25, 10, 5, 2.5])
    })

    it('extracts denominations from stock, dropping empty entries', () => {
      const stock: PlateStock[] = [
        { denom: 45, count: 2 },
        { denom: 25, count: 0 },
        { denom: 10, count: 1 },
      ]
      expect(denomValues(stock)).toEqual([45, 10])
    })
  })

  describe('sanitizePlateInventory', () => {
    it('returns an empty inventory for non-objects', () => {
      expect(sanitizePlateInventory(null)).toEqual(emptyPlateInventory())
      expect(sanitizePlateInventory('nope')).toEqual(emptyPlateInventory())
      expect(sanitizePlateInventory([1, 2])).toEqual(emptyPlateInventory())
    })

    it('coerces enabled to a strict boolean', () => {
      expect(sanitizePlateInventory({ enabled: 'yes', lbs: {}, kg: {} }).enabled).toBe(false)
      expect(sanitizePlateInventory({ enabled: true, lbs: {}, kg: {} }).enabled).toBe(true)
    })

    it('keeps only known denominations and floors/clamps counts, dropping zeros', () => {
      const result = sanitizePlateInventory({
        enabled: true,
        lbs: { '45': 2.9, '25': 0, '99': 5, '5': -3, '2.5': 999 },
        kg: { '20': 4 },
      })
      expect(result.lbs).toEqual({ '45': 2, '2.5': MAX_PLATE_PAIRS })
      expect(result.kg).toEqual({ '20': 4 })
    })
  })

  describe('ownedPlateStock', () => {
    it('returns empty for an inventory with no owned plates for the unit', () => {
      expect(ownedPlateStock(emptyPlateInventory(), 'lbs', true)).toEqual([])
    })

    it('maps pairs to per-side availability', () => {
      const inv = sanitizePlateInventory({ enabled: true, lbs: { '45': 3, '10': 1 }, kg: {} })
      expect(ownedPlateStock(inv, 'lbs', true)).toEqual([
        { denom: 45, count: 3 },
        { denom: 10, count: 1 },
      ])
    })

    it('doubles per-side allowance in total loading mode', () => {
      const inv = sanitizePlateInventory({ enabled: true, lbs: { '45': 2 }, kg: {} })
      expect(ownedPlateStock(inv, 'lbs', false)).toEqual([{ denom: 45, count: 4 }])
    })
  })

  describe('defaultOwnedPairs', () => {
    it('seeds every standard denomination for the unit', () => {
      expect(Object.keys(defaultOwnedPairs('lbs')).map(Number).sort((a, b) => b - a))
        .toEqual([...LBS_PLATES])
      expect(Object.keys(defaultOwnedPairs('kg')).map(Number).sort((a, b) => b - a))
        .toEqual([...KG_PLATES])
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
