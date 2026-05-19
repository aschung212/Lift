import { describe, it, expect } from 'vitest'
import {
  classifyWarmupSets,
  buildWarmupSetIds,
  type SetLike,
} from '../classifyWarmupSets'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a SetLike with sensible defaults. */
function makeSet(id: string, date: string, estimated1RM: number): SetLike {
  return { id, date, estimated1RM }
}

// ---------------------------------------------------------------------------
// classifyWarmupSets
// ---------------------------------------------------------------------------

describe('classifyWarmupSets', () => {
  describe('empty / trivial inputs', () => {
    it('returns empty map for empty array', () => {
      expect(classifyWarmupSets([])).toEqual(new Map())
    })

    it('classifies a single set as working', () => {
      const sets = [makeSet('a', '2026-01-01', 100)]
      const result = classifyWarmupSets(sets)
      expect(result.get('a')).toBe(false)
    })
  })

  describe('basic warmup detection', () => {
    it('marks lighter sets before top set as warmups', () => {
      const sets = [
        makeSet('warmup1', '2026-01-01', 50),
        makeSet('warmup2', '2026-01-01', 60),
        makeSet('top', '2026-01-01', 100),
      ]
      const result = classifyWarmupSets(sets, 0.75)
      expect(result.get('warmup1')).toBe(true)
      expect(result.get('warmup2')).toBe(true)
      expect(result.get('top')).toBe(false)
    })

    it('marks sets after top set as working even if light', () => {
      const sets = [
        makeSet('top', '2026-01-01', 100),
        makeSet('backoff', '2026-01-01', 50),
      ]
      const result = classifyWarmupSets(sets, 0.75)
      expect(result.get('top')).toBe(false)
      expect(result.get('backoff')).toBe(false)
    })

    it('does not mark pre-top sets above cutoff as warmup', () => {
      const sets = [
        makeSet('heavy-warm', '2026-01-01', 80), // 80 > 75 cutoff
        makeSet('top', '2026-01-01', 100),
      ]
      const result = classifyWarmupSets(sets, 0.75)
      expect(result.get('heavy-warm')).toBe(false)
      expect(result.get('top')).toBe(false)
    })
  })

  describe('threshold boundary cases', () => {
    it('marks a set exactly at the cutoff as warmup (<=)', () => {
      // cutoff = 100 * 0.75 = 75; set at exactly 75 should be warmup
      const sets = [
        makeSet('boundary', '2026-01-01', 75),
        makeSet('top', '2026-01-01', 100),
      ]
      const result = classifyWarmupSets(sets, 0.75)
      expect(result.get('boundary')).toBe(true)
    })

    it('does not mark a set just above cutoff as warmup', () => {
      // cutoff = 100 * 0.75 = 75; set at 75.1 should NOT be warmup
      const sets = [
        makeSet('above', '2026-01-01', 75.1),
        makeSet('top', '2026-01-01', 100),
      ]
      const result = classifyWarmupSets(sets, 0.75)
      expect(result.get('above')).toBe(false)
    })

    it('uses default threshold of 0.75 when omitted', () => {
      const sets = [
        makeSet('light', '2026-01-01', 70), // 70 <= 75 cutoff → warmup
        makeSet('top', '2026-01-01', 100),
      ]
      const result = classifyWarmupSets(sets)
      expect(result.get('light')).toBe(true)
    })

    it('threshold of 1.0 marks all pre-top sets as warmup (all below top)', () => {
      const sets = [
        makeSet('w1', '2026-01-01', 90),
        makeSet('w2', '2026-01-01', 99),
        makeSet('top', '2026-01-01', 100),
      ]
      const result = classifyWarmupSets(sets, 1.0)
      expect(result.get('w1')).toBe(true)
      expect(result.get('w2')).toBe(true)
      expect(result.get('top')).toBe(false)
    })

    it('very low threshold marks nothing as warmup', () => {
      const sets = [
        makeSet('light', '2026-01-01', 10),
        makeSet('top', '2026-01-01', 100),
      ]
      const result = classifyWarmupSets(sets, 0.05)
      // cutoff = 5; 10 > 5 so not warmup
      expect(result.get('light')).toBe(false)
    })
  })

  describe('multi-session (multi-date)', () => {
    it('classifies each day independently', () => {
      const sets = [
        // Day 1: warmup → top
        makeSet('d1-warm', '2026-01-01', 50),
        makeSet('d1-top', '2026-01-01', 100),
        // Day 2: top → backoff (no warmups, top is first)
        makeSet('d2-top', '2026-01-02', 100),
        makeSet('d2-back', '2026-01-02', 50),
      ]
      const result = classifyWarmupSets(sets, 0.75)
      expect(result.get('d1-warm')).toBe(true)
      expect(result.get('d1-top')).toBe(false)
      expect(result.get('d2-top')).toBe(false)
      expect(result.get('d2-back')).toBe(false)
    })

    it('handles ISO datetime strings by grouping on YYYY-MM-DD', () => {
      const sets = [
        makeSet('morning', '2026-01-01T08:00:00Z', 50),
        makeSet('evening', '2026-01-01T20:00:00Z', 100),
      ]
      const result = classifyWarmupSets(sets, 0.75)
      expect(result.get('morning')).toBe(true)
      expect(result.get('evening')).toBe(false)
    })
  })

  describe('edge cases with zero / negative e1RM', () => {
    it('skips session classification when top e1RM is 0', () => {
      const sets = [
        makeSet('a', '2026-01-01', 0),
        makeSet('b', '2026-01-01', 0),
      ]
      const result = classifyWarmupSets(sets)
      // All remain working (false) since topE1RM <= 0 → skip
      expect(result.get('a')).toBe(false)
      expect(result.get('b')).toBe(false)
    })

    it('skips session classification when top e1RM is negative', () => {
      const sets = [
        makeSet('a', '2026-01-01', -10),
        makeSet('b', '2026-01-01', -5),
      ]
      const result = classifyWarmupSets(sets)
      expect(result.get('a')).toBe(false)
      expect(result.get('b')).toBe(false)
    })
  })

  describe('tie-breaking: multiple sets share top e1RM', () => {
    it('uses the first occurrence as top set index', () => {
      // Two sets with same e1RM — only strict > replaces topIdx,
      // so the FIRST occurrence wins
      const sets = [
        makeSet('first-top', '2026-01-01', 100),
        makeSet('second-top', '2026-01-01', 100),
      ]
      const result = classifyWarmupSets(sets, 0.75)
      // first-top is the top set, second-top is after it → both working
      expect(result.get('first-top')).toBe(false)
      expect(result.get('second-top')).toBe(false)
    })

    it('warmup before first of two tied tops is still classified', () => {
      const sets = [
        makeSet('warm', '2026-01-01', 50),
        makeSet('top1', '2026-01-01', 100),
        makeSet('top2', '2026-01-01', 100),
      ]
      const result = classifyWarmupSets(sets, 0.75)
      expect(result.get('warm')).toBe(true)
      expect(result.get('top1')).toBe(false)
      expect(result.get('top2')).toBe(false)
    })
  })

  describe('realistic workout patterns', () => {
    it('classifies a typical pyramid session', () => {
      // Pyramid: 135→185→225→275→315→275→225
      const sets = [
        makeSet('s1', '2026-01-15', 165), // 135x5 ≈ e1RM 165
        makeSet('s2', '2026-01-15', 215), // 185x3 ≈ e1RM 215
        makeSet('s3', '2026-01-15', 263), // 225x3 ≈ e1RM 263
        makeSet('s4', '2026-01-15', 303), // 275x2 ≈ e1RM 303
        makeSet('s5', '2026-01-15', 347), // 315x2 ≈ e1RM 347 ← top
        makeSet('s6', '2026-01-15', 303), // backoff
        makeSet('s7', '2026-01-15', 263), // backoff
      ]
      const result = classifyWarmupSets(sets, 0.75)
      // cutoff = 347 * 0.75 = 260.25
      expect(result.get('s1')).toBe(true) // 165 ≤ 260.25
      expect(result.get('s2')).toBe(true) // 215 ≤ 260.25
      expect(result.get('s3')).toBe(false) // 263 > 260.25
      expect(result.get('s4')).toBe(false) // 303 > 260.25
      expect(result.get('s5')).toBe(false) // top set
      expect(result.get('s6')).toBe(false) // after top
      expect(result.get('s7')).toBe(false) // after top
    })

    it('classifies straight sets (all same weight) as all working', () => {
      const sets = [
        makeSet('s1', '2026-01-15', 250),
        makeSet('s2', '2026-01-15', 250),
        makeSet('s3', '2026-01-15', 250),
      ]
      const result = classifyWarmupSets(sets, 0.75)
      // First set is top (tie → first wins), rest are after → all working
      expect(result.get('s1')).toBe(false)
      expect(result.get('s2')).toBe(false)
      expect(result.get('s3')).toBe(false)
    })
  })

  describe('return type guarantees', () => {
    it('contains an entry for every input set', () => {
      const sets = [
        makeSet('a', '2026-01-01', 50),
        makeSet('b', '2026-01-02', 100),
        makeSet('c', '2026-01-01', 80),
      ]
      const result = classifyWarmupSets(sets)
      expect(result.size).toBe(3)
      expect(result.has('a')).toBe(true)
      expect(result.has('b')).toBe(true)
      expect(result.has('c')).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// buildWarmupSetIds
// ---------------------------------------------------------------------------

describe('buildWarmupSetIds', () => {
  describe('empty / trivial inputs', () => {
    it('returns empty set for empty exercises', () => {
      expect(buildWarmupSetIds([], 0.75).size).toBe(0)
    })

    it('returns empty set for exercise with no sets', () => {
      expect(buildWarmupSetIds([{ sets: [] }], 0.75).size).toBe(0)
    })
  })

  describe('threshold validation', () => {
    it('returns empty set for threshold <= 0', () => {
      const exercises = [
        {
          sets: [
            makeSet('a', '2026-01-01', 50),
            makeSet('b', '2026-01-01', 100),
          ],
        },
      ]
      expect(buildWarmupSetIds(exercises, 0).size).toBe(0)
      expect(buildWarmupSetIds(exercises, -1).size).toBe(0)
    })

    it('returns empty set for threshold > 1', () => {
      const exercises = [
        {
          sets: [
            makeSet('a', '2026-01-01', 50),
            makeSet('b', '2026-01-01', 100),
          ],
        },
      ]
      expect(buildWarmupSetIds(exercises, 1.5).size).toBe(0)
    })

    it('accepts threshold of exactly 1.0', () => {
      const exercises = [
        {
          sets: [
            makeSet('a', '2026-01-01', 50),
            makeSet('b', '2026-01-01', 100),
          ],
        },
      ]
      // threshold=1.0: cutoff = 100; 50 < 100 → warmup
      const result = buildWarmupSetIds(exercises, 1.0)
      expect(result.has('a')).toBe(true)
    })
  })

  describe('basic warmup detection (uses strict <, not <=)', () => {
    it('marks lighter pre-top sets as warmup', () => {
      const exercises = [
        {
          sets: [
            makeSet('warm', '2026-01-01', 50),
            makeSet('top', '2026-01-01', 100),
          ],
        },
      ]
      const result = buildWarmupSetIds(exercises, 0.75)
      expect(result.has('warm')).toBe(true)
      expect(result.has('top')).toBe(false)
    })

    it('does NOT mark set exactly at cutoff (strict < comparison)', () => {
      // cutoff = 100 * 0.75 = 75; exactly 75 is NOT < 75
      const exercises = [
        {
          sets: [
            makeSet('boundary', '2026-01-01', 75),
            makeSet('top', '2026-01-01', 100),
          ],
        },
      ]
      const result = buildWarmupSetIds(exercises, 0.75)
      expect(result.has('boundary')).toBe(false)
    })
  })

  describe('multiple exercises', () => {
    it('processes each exercise independently', () => {
      const exercises = [
        {
          sets: [
            makeSet('ex1-warm', '2026-01-01', 40),
            makeSet('ex1-top', '2026-01-01', 100),
          ],
        },
        {
          sets: [
            makeSet('ex2-warm', '2026-01-01', 30),
            makeSet('ex2-top', '2026-01-01', 80),
          ],
        },
      ]
      const result = buildWarmupSetIds(exercises, 0.75)
      expect(result.has('ex1-warm')).toBe(true)
      expect(result.has('ex2-warm')).toBe(true)
      expect(result.has('ex1-top')).toBe(false)
      expect(result.has('ex2-top')).toBe(false)
    })
  })

  describe('multi-session within an exercise', () => {
    it('finds warmups independently per date', () => {
      const exercises = [
        {
          sets: [
            makeSet('d1-warm', '2026-01-01', 50),
            makeSet('d1-top', '2026-01-01', 100),
            makeSet('d2-top', '2026-01-02', 90),
            makeSet('d2-back', '2026-01-02', 40),
          ],
        },
      ]
      const result = buildWarmupSetIds(exercises, 0.75)
      expect(result.has('d1-warm')).toBe(true)
      // d2-top is first on day 2 → it IS the top set; d2-back is after → not warmup
      expect(result.has('d2-top')).toBe(false)
      expect(result.has('d2-back')).toBe(false)
    })
  })

  describe('consistency with classifyWarmupSets', () => {
    it('buildWarmupSetIds warmup IDs match classifyWarmupSets true entries', () => {
      const sets = [
        makeSet('w1', '2026-01-01', 40),
        makeSet('w2', '2026-01-01', 60),
        makeSet('top', '2026-01-01', 100),
        makeSet('back', '2026-01-01', 70),
      ]

      const idsFromBuild = buildWarmupSetIds([{ sets }], 0.75)
      const mapFromClassify = classifyWarmupSets(sets, 0.75)

      const classifyWarmupIds = new Set(
        [...mapFromClassify.entries()]
          .filter(([, isWarmup]) => isWarmup)
          .map(([id]) => id),
      )

      // Note: buildWarmupSetIds uses strict < while classifyWarmupSets uses <=
      // So they may differ at exact boundary. Verify each independently.
      for (const id of idsFromBuild) {
        // Every ID in build result should also be warmup in classify
        expect(classifyWarmupIds.has(id)).toBe(true)
      }
    })
  })
})
