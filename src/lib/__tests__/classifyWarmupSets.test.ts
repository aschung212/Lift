import { describe, it, expect } from 'vitest'
import { buildWarmupSetIds, classifyWarmupSets, type SetLike } from '../classifyWarmupSets'

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Shorthand factory for a set. */
function s(id: string, date: string, estimated1RM: number): SetLike {
  return { id, date, estimated1RM }
}

/* ------------------------------------------------------------------ */
/*  classifyWarmupSets                                                 */
/* ------------------------------------------------------------------ */

describe('classifyWarmupSets', () => {
  it('returns empty map for empty input', () => {
    expect(classifyWarmupSets([])).toEqual(new Map())
  })

  it('marks a single set as working (not warmup)', () => {
    const sets = [s('a', '2026-05-01', 100)]
    const result = classifyWarmupSets(sets)
    expect(result.get('a')).toBe(false)
  })

  it('classifies a typical pyramid warmup sequence', () => {
    // 3 warmup sets ramping up, then a top set at 200 e1RM
    // Default threshold 0.75 → cutoff = 200 * 0.75 = 150
    const sets = [
      s('w1', '2026-05-01', 80),   // warmup (80 < 150)
      s('w2', '2026-05-01', 120),  // warmup (120 < 150)
      s('w3', '2026-05-01', 140),  // warmup (140 ≤ 150)
      s('top', '2026-05-01', 200), // top set
      s('bk', '2026-05-01', 160),  // backoff — after top, always working
    ]
    const result = classifyWarmupSets(sets)
    expect(result.get('w1')).toBe(true)
    expect(result.get('w2')).toBe(true)
    expect(result.get('w3')).toBe(true)
    expect(result.get('top')).toBe(false)
    expect(result.get('bk')).toBe(false)
  })

  it('does not mark sets above the cutoff as warmup even before the top set', () => {
    // threshold 0.75 → cutoff = 200 * 0.75 = 150
    // Set at 160 is above cutoff → working
    const sets = [
      s('a', '2026-05-01', 160),
      s('b', '2026-05-01', 200),
    ]
    const result = classifyWarmupSets(sets)
    expect(result.get('a')).toBe(false) // 160 > 150, working
    expect(result.get('b')).toBe(false)
  })

  it('treats sets exactly at the cutoff as warmup', () => {
    // threshold 0.75 → cutoff = 200 * 0.75 = 150
    // classifyWarmupSets uses ≤ for cutoff comparison
    const sets = [
      s('exact', '2026-05-01', 150),
      s('top', '2026-05-01', 200),
    ]
    const result = classifyWarmupSets(sets)
    expect(result.get('exact')).toBe(true)
  })

  it('groups sets by date — different days are independent', () => {
    const sets = [
      // Day 1: light session (top = 100)
      s('d1-w', '2026-05-01', 60),  // warmup (60 ≤ 75)
      s('d1-t', '2026-05-01', 100),
      // Day 2: heavy session (top = 200)
      s('d2-w', '2026-05-02', 120), // warmup (120 ≤ 150)
      s('d2-t', '2026-05-02', 200),
    ]
    const result = classifyWarmupSets(sets)
    expect(result.get('d1-w')).toBe(true)
    expect(result.get('d1-t')).toBe(false)
    expect(result.get('d2-w')).toBe(true)
    expect(result.get('d2-t')).toBe(false)
  })

  it('respects custom threshold', () => {
    // threshold 0.9 → cutoff = 200 * 0.9 = 180
    const sets = [
      s('a', '2026-05-01', 160), // 160 ≤ 180, warmup
      s('b', '2026-05-01', 200),
    ]
    const result = classifyWarmupSets(sets, 0.9)
    expect(result.get('a')).toBe(true)
  })

  it('skips sessions where top e1RM is 0 or negative', () => {
    const sets = [
      s('a', '2026-05-01', 0),
      s('b', '2026-05-01', 0),
    ]
    const result = classifyWarmupSets(sets)
    // All working since topE1RM ≤ 0 → skip
    expect(result.get('a')).toBe(false)
    expect(result.get('b')).toBe(false)
  })

  it('handles top set as the first set (no warmups possible)', () => {
    const sets = [
      s('top', '2026-05-01', 200),
      s('bk1', '2026-05-01', 100),
      s('bk2', '2026-05-01', 80),
    ]
    const result = classifyWarmupSets(sets)
    // Top is first, nothing before it → no warmups
    expect(result.get('top')).toBe(false)
    expect(result.get('bk1')).toBe(false)
    expect(result.get('bk2')).toBe(false)
  })

  it('uses YYYY-MM-DD prefix for session grouping (ignores time)', () => {
    const sets = [
      s('morning', '2026-05-01T08:00:00Z', 80),
      s('evening', '2026-05-01T20:00:00Z', 200),
    ]
    const result = classifyWarmupSets(sets)
    // Same date prefix → same session
    expect(result.get('morning')).toBe(true)  // 80 ≤ 150
    expect(result.get('evening')).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/*  buildWarmupSetIds                                                  */
/* ------------------------------------------------------------------ */

describe('buildWarmupSetIds', () => {
  it('returns empty set for no exercises', () => {
    expect(buildWarmupSetIds([], 0.75)).toEqual(new Set())
  })

  it('returns empty set for invalid threshold', () => {
    const exercises = [{ sets: [s('a', '2026-05-01', 100)] }]
    expect(buildWarmupSetIds(exercises, 0).size).toBe(0)
    expect(buildWarmupSetIds(exercises, -0.5).size).toBe(0)
    expect(buildWarmupSetIds(exercises, 1.1).size).toBe(0)
  })

  it('allows threshold of exactly 1', () => {
    // threshold = 1 → cutoff = topE1RM, so everything strictly below is warmup
    // but buildWarmupSetIds uses < (strict), not ≤
    const exercises = [{
      sets: [
        s('a', '2026-05-01', 150),
        s('b', '2026-05-01', 200),
      ],
    }]
    const result = buildWarmupSetIds(exercises, 1)
    // cutoff = 200 * 1 = 200, 150 < 200 → warmup
    expect(result.has('a')).toBe(true)
  })

  it('identifies warmups across multiple exercises', () => {
    const exercises = [
      {
        sets: [
          s('sq-w', '2026-05-01', 80),
          s('sq-t', '2026-05-01', 200),
        ],
      },
      {
        sets: [
          s('bp-w', '2026-05-01', 60),
          s('bp-t', '2026-05-01', 150),
        ],
      },
    ]
    const result = buildWarmupSetIds(exercises, 0.75)
    expect(result.has('sq-w')).toBe(true)  // 80 < 150
    expect(result.has('sq-t')).toBe(false)
    expect(result.has('bp-w')).toBe(true)  // 60 < 112.5
    expect(result.has('bp-t')).toBe(false)
  })

  it('uses strict less-than (not ≤) for warmup classification', () => {
    // buildWarmupSetIds uses `< cutoff` whereas classifyWarmupSets uses `≤ cutoff`
    const exercises = [{
      sets: [
        s('exact', '2026-05-01', 150), // exactly at cutoff (200 * 0.75)
        s('top', '2026-05-01', 200),
      ],
    }]
    const result = buildWarmupSetIds(exercises, 0.75)
    // 150 is NOT < 150, so it should NOT be in warmup set
    expect(result.has('exact')).toBe(false)
  })

  it('handles multi-day sessions per exercise', () => {
    const exercises = [{
      sets: [
        s('d1-w', '2026-05-01', 60),
        s('d1-t', '2026-05-01', 200),
        s('d2-w', '2026-05-03', 50),
        s('d2-t', '2026-05-03', 180),
      ],
    }]
    const result = buildWarmupSetIds(exercises, 0.75)
    expect(result.has('d1-w')).toBe(true)  // 60 < 150
    expect(result.has('d2-w')).toBe(true)  // 50 < 135
  })
})
