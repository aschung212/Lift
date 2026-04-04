import { describe, it, expect } from 'vitest'
import {
  calculateSetXP,
  calculateBest1RM,
  calculateBodyweightXP,
  applyStreakMultiplier,
  checkRepPR,
  XP_CONFIG,
  type StreakHistoryEntry,
} from '../xp'
import type { WorkoutSet } from '../../stores/workout'

// --- Helpers ---

function makeSet(overrides: Partial<WorkoutSet> & { estimated1RM: number }): WorkoutSet {
  return {
    id: 'test-set',
    date: '2026-04-01T10:00:00Z',
    weight: 100,
    reps: 5,
    ...overrides,
  }
}

/** Temporarily override XP_CONFIG values, restoring originals after the test. */
function withConfig<K extends keyof typeof XP_CONFIG>(
  overrides: Partial<Pick<typeof XP_CONFIG, K>>,
  fn: () => void
) {
  const originals = {} as Record<string, unknown>
  for (const key of Object.keys(overrides) as K[]) {
    originals[key] = XP_CONFIG[key]
    ;(XP_CONFIG as Record<string, unknown>)[key] = overrides[key]
  }
  try {
    fn()
  } finally {
    for (const key of Object.keys(originals)) {
      ;(XP_CONFIG as Record<string, unknown>)[key] = originals[key]
    }
  }
}

// --- calculateSetXP ---

describe('calculateSetXP', () => {
  describe('warmup zone (<50%)', () => {
    it('returns flat 10 XP', () => {
      expect(calculateSetXP({
        setEstimated1RM: 40, exerciseBest1RM: 100, setIndex: 0,
      })).toBe(10)
    })

    it('returns 10 at 0% ratio', () => {
      expect(calculateSetXP({
        setEstimated1RM: 0, exerciseBest1RM: 100, setIndex: 0,
      })).toBe(10)
    })

    it('returns 10 at 49%', () => {
      expect(calculateSetXP({
        setEstimated1RM: 49, exerciseBest1RM: 100, setIndex: 0,
      })).toBe(10)
    })
  })

  describe('working zone (50–99%)', () => {
    it('returns ~54 at 75%', () => {
      // 10 + (0.75 - 0.5) * 176 = 10 + 44 = 54
      expect(calculateSetXP({
        setEstimated1RM: 75, exerciseBest1RM: 100, setIndex: 0,
      })).toBe(54)
    })

    it('returns ~89 at 95%', () => {
      // 10 + (0.95 - 0.5) * 176 = 10 + 79.2 = 89.2 → 89
      expect(calculateSetXP({
        setEstimated1RM: 95, exerciseBest1RM: 100, setIndex: 0,
      })).toBe(89)
    })

    it('returns 10 at exactly 50%', () => {
      // 10 + (0.5 - 0.5) * 176 = 10
      expect(calculateSetXP({
        setEstimated1RM: 50, exerciseBest1RM: 100, setIndex: 0,
      })).toBe(10)
    })

    it('returns ~96 at 99%', () => {
      // 10 + (0.99 - 0.5) * 176 = 10 + 86.24 = 96.24 → 96
      expect(calculateSetXP({
        setEstimated1RM: 99, exerciseBest1RM: 100, setIndex: 0,
      })).toBe(96)
    })
  })

  describe('tie zone (exactly 100%)', () => {
    it('returns 200 at exactly 100% (2x multiplier)', () => {
      // 1.0 * 100 * 2 = 200
      expect(calculateSetXP({
        setEstimated1RM: 100, exerciseBest1RM: 100, setIndex: 0,
      })).toBe(200)
    })
  })

  describe('PR zone (>100%)', () => {
    it('returns 315 at 105% (3x multiplier)', () => {
      // 1.05 * 100 * 3 = 315
      expect(calculateSetXP({
        setEstimated1RM: 105, exerciseBest1RM: 100, setIndex: 0,
      })).toBe(315)
    })

    it('returns 600 at 200%', () => {
      // 2.0 * 100 * 3 = 600
      expect(calculateSetXP({
        setEstimated1RM: 200, exerciseBest1RM: 100, setIndex: 0,
      })).toBe(600)
    })

    it('returns 303 at 101% (barely over)', () => {
      // 1.01 * 100 * 3 = 303
      expect(calculateSetXP({
        setEstimated1RM: 101, exerciseBest1RM: 100, setIndex: 0,
      })).toBe(303)
    })
  })

  describe('rep PR bonus', () => {
    it('adds repPRBonus on top of working zone XP', () => {
      // Working: 54 + repPRBonus: 25 = 79
      expect(calculateSetXP({
        setEstimated1RM: 75, exerciseBest1RM: 100, setIndex: 0, isRepPR: true,
      })).toBe(79)
    })

    it('adds repPRBonus on top of warmup XP', () => {
      // Warmup: 10 + 25 = 35
      expect(calculateSetXP({
        setEstimated1RM: 30, exerciseBest1RM: 100, setIndex: 0, isRepPR: true,
      })).toBe(35)
    })

    it('adds repPRBonus on top of PR XP', () => {
      // PR: 315 + 25 = 340
      expect(calculateSetXP({
        setEstimated1RM: 105, exerciseBest1RM: 100, setIndex: 0, isRepPR: true,
      })).toBe(340)
    })

    it('does not add bonus when isRepPR is false', () => {
      expect(calculateSetXP({
        setEstimated1RM: 75, exerciseBest1RM: 100, setIndex: 0, isRepPR: false,
      })).toBe(54)
    })

    it('does not add bonus when isRepPR is omitted', () => {
      expect(calculateSetXP({
        setEstimated1RM: 75, exerciseBest1RM: 100, setIndex: 0,
      })).toBe(54)
    })
  })

  describe('new exercise (null best)', () => {
    it('returns 50 for first set', () => {
      expect(calculateSetXP({
        setEstimated1RM: 80, exerciseBest1RM: null, setIndex: 0,
      })).toBe(50)
    })

    it('returns 50 for second set', () => {
      expect(calculateSetXP({
        setEstimated1RM: 80, exerciseBest1RM: null, setIndex: 1,
      })).toBe(50)
    })

    it('returns 50 for third set', () => {
      expect(calculateSetXP({
        setEstimated1RM: 80, exerciseBest1RM: null, setIndex: 2,
      })).toBe(50)
    })

    it('returns minimum XP for fourth set', () => {
      expect(calculateSetXP({
        setEstimated1RM: 80, exerciseBest1RM: null, setIndex: 3,
      })).toBe(10)
    })
  })

  describe('floor enforcement', () => {
    it('never returns below minXP', () => {
      expect(calculateSetXP({
        setEstimated1RM: 1, exerciseBest1RM: 100, setIndex: 0,
      })).toBeGreaterThanOrEqual(10)
    })

    it('handles zero best1RM gracefully', () => {
      expect(calculateSetXP({
        setEstimated1RM: 50, exerciseBest1RM: 0, setIndex: 0,
      })).toBe(10)
    })
  })

  describe('config tunability', () => {
    it('respects a changed prMultiplier', () => {
      withConfig({ prMultiplier: 5 }, () => {
        // 1.05 * 100 * 5 = 525
        expect(calculateSetXP({
          setEstimated1RM: 105, exerciseBest1RM: 100, setIndex: 0,
        })).toBe(525)
      })
    })

    it('respects a changed tieMultiplier', () => {
      withConfig({ tieMultiplier: 4 }, () => {
        // 1.0 * 100 * 4 = 400
        expect(calculateSetXP({
          setEstimated1RM: 100, exerciseBest1RM: 100, setIndex: 0,
        })).toBe(400)
      })
    })

    it('respects a changed workingSlope', () => {
      withConfig({ workingSlope: 200 }, () => {
        // 10 + (0.75 - 0.5) * 200 = 10 + 50 = 60
        expect(calculateSetXP({
          setEstimated1RM: 75, exerciseBest1RM: 100, setIndex: 0,
        })).toBe(60)
      })
    })

    it('respects a changed repPRBonus', () => {
      withConfig({ repPRBonus: 100 }, () => {
        // Working: 54 + 100 = 154
        expect(calculateSetXP({
          setEstimated1RM: 75, exerciseBest1RM: 100, setIndex: 0, isRepPR: true,
        })).toBe(154)
      })
    })
  })
})

// --- calculateBest1RM ---

describe('calculateBest1RM', () => {
  it('returns null for empty sets', () => {
    expect(calculateBest1RM([])).toBeNull()
  })

  it('returns the highest estimated1RM within 6 months', () => {
    const sets = [
      makeSet({ estimated1RM: 100, date: '2026-03-01T10:00:00Z' }),
      makeSet({ estimated1RM: 120, date: '2026-03-15T10:00:00Z' }),
      makeSet({ estimated1RM: 110, date: '2026-04-01T10:00:00Z' }),
    ]
    expect(calculateBest1RM(sets)).toBe(120)
  })

  it('excludes sets older than 6 months', () => {
    const sets = [
      makeSet({ estimated1RM: 200, date: '2025-01-01T10:00:00Z' }),
      makeSet({ estimated1RM: 100, date: '2026-03-01T10:00:00Z' }),
    ]
    expect(calculateBest1RM(sets)).toBe(100)
  })

  it('returns null when all sets are outside the window', () => {
    const sets = [
      makeSet({ estimated1RM: 200, date: '2024-01-01T10:00:00Z' }),
    ]
    expect(calculateBest1RM(sets)).toBeNull()
  })

  it('respects custom window', () => {
    const sets = [
      makeSet({ estimated1RM: 150, date: '2026-02-01T10:00:00Z' }),
      makeSet({ estimated1RM: 100, date: '2026-03-20T10:00:00Z' }),
    ]
    expect(calculateBest1RM(sets, { windowMonths: 1 })).toBe(100)
  })
})

// --- calculateBodyweightXP ---

describe('calculateBodyweightXP', () => {
  it('returns 100 for a new date', () => {
    expect(calculateBodyweightXP('2026-04-01', [])).toBe(100)
  })

  it('returns 0 for a duplicate date', () => {
    expect(calculateBodyweightXP('2026-04-01', ['2026-04-01'])).toBe(0)
  })

  it('matches on date portion only (ignores time)', () => {
    expect(calculateBodyweightXP(
      '2026-04-01T15:30:00Z',
      ['2026-04-01T08:00:00Z']
    )).toBe(0)
  })

  it('returns 100 when existing dates are different days', () => {
    expect(calculateBodyweightXP(
      '2026-04-02',
      ['2026-04-01', '2026-04-03']
    )).toBe(100)
  })
})

// --- applyStreakMultiplier ---

describe('applyStreakMultiplier', () => {
  const baseXP = 100

  it('returns baseXP with empty history', () => {
    expect(applyStreakMultiplier(baseXP, [], '2026-04-01')).toBe(100)
  })

  it('returns baseXP when streak count is 0', () => {
    const history: StreakHistoryEntry[] = [
      { weekStart: '2026-03-30', streakCount: 0, weeklyTarget: 3 },
    ]
    expect(applyStreakMultiplier(baseXP, history, '2026-04-01')).toBe(100)
  })

  it('applies 1.0x duration for 1-week streak', () => {
    const history: StreakHistoryEntry[] = [
      { weekStart: '2026-03-30', streakCount: 1, weeklyTarget: 1 },
    ]
    expect(applyStreakMultiplier(baseXP, history, '2026-04-01')).toBe(100)
  })

  it('applies 1.1x duration for 2-week streak', () => {
    const history: StreakHistoryEntry[] = [
      { weekStart: '2026-03-30', streakCount: 2, weeklyTarget: 1 },
    ]
    expect(applyStreakMultiplier(baseXP, history, '2026-04-01')).toBe(110)
  })

  it('applies 1.25x duration for 4-week streak', () => {
    const history: StreakHistoryEntry[] = [
      { weekStart: '2026-03-30', streakCount: 4, weeklyTarget: 1 },
    ]
    expect(applyStreakMultiplier(baseXP, history, '2026-04-01')).toBe(125)
  })

  it('applies 1.5x duration for 8-week streak', () => {
    const history: StreakHistoryEntry[] = [
      { weekStart: '2026-03-30', streakCount: 8, weeklyTarget: 1 },
    ]
    expect(applyStreakMultiplier(baseXP, history, '2026-04-01')).toBe(150)
  })

  it('applies 1.75x duration for 12+ week streak', () => {
    const history: StreakHistoryEntry[] = [
      { weekStart: '2026-03-30', streakCount: 15, weeklyTarget: 1 },
    ]
    expect(applyStreakMultiplier(baseXP, history, '2026-04-01')).toBe(175)
  })

  it('applies target aggressiveness multiplier', () => {
    const history: StreakHistoryEntry[] = [
      { weekStart: '2026-03-30', streakCount: 1, weeklyTarget: 5 },
    ]
    expect(applyStreakMultiplier(baseXP, history, '2026-04-01')).toBe(130)
  })

  it('stacks duration and target multipliers', () => {
    const history: StreakHistoryEntry[] = [
      { weekStart: '2026-03-30', streakCount: 12, weeklyTarget: 6 },
    ]
    // 1.75 * 1.5 = 2.625 → 263
    expect(applyStreakMultiplier(baseXP, history, '2026-04-01')).toBe(263)
  })

  it('is date-anchored — uses the correct week entry', () => {
    const history: StreakHistoryEntry[] = [
      { weekStart: '2026-03-23', streakCount: 4, weeklyTarget: 3 },
      { weekStart: '2026-03-30', streakCount: 5, weeklyTarget: 3 },
    ]
    // Apr 1 → Mar 30 week. duration 5w=1.25x, target 3d=1.1x → 138
    expect(applyStreakMultiplier(baseXP, history, '2026-04-01')).toBe(138)
  })

  it('returns baseXP when no matching week in history', () => {
    const history: StreakHistoryEntry[] = [
      { weekStart: '2026-01-06', streakCount: 10, weeklyTarget: 5 },
    ]
    expect(applyStreakMultiplier(baseXP, history, '2026-04-01')).toBe(100)
  })

  it('handles Sunday correctly (end of ISO week)', () => {
    const history: StreakHistoryEntry[] = [
      { weekStart: '2026-03-30', streakCount: 2, weeklyTarget: 4 },
    ]
    // 1.1 * 1.2 = 1.32 → 132
    expect(applyStreakMultiplier(baseXP, history, '2026-04-05')).toBe(132)
  })

  it('handles Monday correctly (start of ISO week)', () => {
    const history: StreakHistoryEntry[] = [
      { weekStart: '2026-03-30', streakCount: 2, weeklyTarget: 4 },
    ]
    expect(applyStreakMultiplier(baseXP, history, '2026-03-30')).toBe(132)
  })
})

// --- checkRepPR ---

describe('checkRepPR', () => {
  it('returns true when reps exceed best at same weight', () => {
    const prior = [
      makeSet({ weight: 135, reps: 5, estimated1RM: 158 }),
      makeSet({ weight: 135, reps: 7, estimated1RM: 167 }),
    ]
    expect(checkRepPR(135, 8, prior)).toBe(true)
  })

  it('returns false when reps equal best at same weight', () => {
    const prior = [
      makeSet({ weight: 135, reps: 7, estimated1RM: 167 }),
    ]
    expect(checkRepPR(135, 7, prior)).toBe(false)
  })

  it('returns false when reps are below best at same weight', () => {
    const prior = [
      makeSet({ weight: 135, reps: 7, estimated1RM: 167 }),
    ]
    expect(checkRepPR(135, 5, prior)).toBe(false)
  })

  it('returns false when no prior sets at same weight', () => {
    const prior = [
      makeSet({ weight: 185, reps: 5, estimated1RM: 216 }),
    ]
    expect(checkRepPR(135, 8, prior)).toBe(false)
  })

  it('returns false with empty prior sets', () => {
    expect(checkRepPR(135, 8, [])).toBe(false)
  })

  it('only considers sets at the exact same weight', () => {
    const prior = [
      makeSet({ weight: 135, reps: 10, estimated1RM: 180 }),
      makeSet({ weight: 140, reps: 3, estimated1RM: 154 }),
    ]
    // 140 x 5 — only prior at 140 is 3 reps → rep PR
    expect(checkRepPR(140, 5, prior)).toBe(true)
    // 135 x 8 — prior at 135 is 10 reps → not a rep PR
    expect(checkRepPR(135, 8, prior)).toBe(false)
  })
})
