import { describe, it, expect } from 'vitest'
import { scoreSet, filterSetsSinceBaseline } from '../setScoring'
import { XP_CONFIG } from '../xp'
import type { WorkoutSet } from '../../stores/workout'

function makeSet(overrides: Partial<WorkoutSet> & { estimated1RM: number }): WorkoutSet {
  return {
    id: `set-${Math.random().toString(36).slice(2)}`,
    date: '2026-04-01T10:00:00Z',
    weight: 100,
    reps: 5,
    ...overrides,
  }
}

const TODAY = '2026-06-01T10:00:00Z'

describe('filterSetsSinceBaseline', () => {
  it('returns sets unchanged when no baseline is set', () => {
    const sets = [makeSet({ estimated1RM: 100, date: '2026-01-01T10:00:00Z' })]
    expect(filterSetsSinceBaseline(sets, null)).toBe(sets)
  })

  it('drops sets before the baseline day-key', () => {
    const sets = [
      makeSet({ estimated1RM: 100, date: '2026-01-01T10:00:00Z' }),
      makeSet({ estimated1RM: 200, date: '2026-05-10T10:00:00Z' }),
    ]
    const filtered = filterSetsSinceBaseline(sets, '2026-05-01')
    expect(filtered).toHaveLength(1)
    expect(filtered[0].estimated1RM).toBe(200)
  })

  it('keeps end-of-day day-key sets on the baseline day itself', () => {
    // endOfDayISO stores the chosen local day as the string prefix (…T23:59Z),
    // so setDayKey must bucket it to that day and pass the >= baseline check.
    const sets = [makeSet({ estimated1RM: 150, date: '2026-05-01T23:59:59Z' })]
    expect(filterSetsSinceBaseline(sets, '2026-05-01')).toHaveLength(1)
  })
})

describe('scoreSet', () => {
  it('classifies a brand-new exercise (no prior sets)', () => {
    const score = scoreSet({
      priorSets: [],
      estimated1RM: 120,
      weightLbs: 100,
      reps: 5,
      dateKey: TODAY,
      baseline: null,
    })
    expect(score.zone).toBe('new_exercise')
    expect(score.best1RM).toBeNull()
    expect(score.ratio).toBeNull()
    expect(score.isPR).toBe(false)
    expect(score.baseXP).toBe(XP_CONFIG.newExerciseFlatXP)
  })

  it('suppresses PR detection when all prior sets are from the same day (immature)', () => {
    const priorSets = [makeSet({ estimated1RM: 100, date: TODAY })]
    const score = scoreSet({
      priorSets,
      estimated1RM: 200,
      weightLbs: 100,
      reps: 10,
      dateKey: TODAY,
      baseline: null,
    })
    // Not established → treated as new exercise, no PR.
    expect(score.isEstablished).toBe(false)
    expect(score.best1RM).toBeNull()
    expect(score.zone).toBe('new_exercise')
  })

  it('classifies a PR when beating the established best', () => {
    const priorSets = [makeSet({ estimated1RM: 100, date: '2026-04-01T10:00:00Z' })]
    const score = scoreSet({
      priorSets,
      estimated1RM: 130,
      weightLbs: 120,
      reps: 3,
      dateKey: TODAY,
      baseline: null,
    })
    expect(score.zone).toBe('pr')
    expect(score.isPR).toBe(true)
    expect(score.isTie).toBe(false)
    expect(score.isPRZone).toBe(true)
    expect(score.ratio).toBeCloseTo(1.3)
  })

  it('classifies a tie when matching the established best exactly', () => {
    const priorSets = [makeSet({ estimated1RM: 100, date: '2026-04-01T10:00:00Z' })]
    const score = scoreSet({
      priorSets,
      estimated1RM: 100,
      weightLbs: 100,
      reps: 5,
      dateKey: TODAY,
      baseline: null,
    })
    expect(score.zone).toBe('tie')
    expect(score.isTie).toBe(true)
    expect(score.isPR).toBe(false)
    expect(score.isPRZone).toBe(true)
  })

  it('classifies a warmup below the warmup threshold', () => {
    const priorSets = [makeSet({ estimated1RM: 200, date: '2026-04-01T10:00:00Z' })]
    const score = scoreSet({
      priorSets,
      estimated1RM: 80, // ratio 0.4 < 0.5
      weightLbs: 70,
      reps: 5,
      dateKey: TODAY,
      baseline: null,
    })
    expect(score.zone).toBe('warmup')
    expect(score.baseXP).toBe(XP_CONFIG.warmupFlatXP)
  })

  it('classifies a working set between the threshold and the best', () => {
    const priorSets = [makeSet({ estimated1RM: 200, date: '2026-04-01T10:00:00Z' })]
    const score = scoreSet({
      priorSets,
      estimated1RM: 160, // ratio 0.8
      weightLbs: 150,
      reps: 5,
      dateKey: TODAY,
      baseline: null,
    })
    expect(score.zone).toBe('working')
    expect(score.isPR).toBe(false)
    expect(score.isPRZone).toBe(false)
  })

  it('flags a rep PR (more reps at the same weight) and applies the multiplier', () => {
    const priorSets = [
      makeSet({ estimated1RM: 200, weight: 100, reps: 5, date: '2026-04-01T10:00:00Z' }),
      makeSet({ estimated1RM: 150, weight: 150, reps: 3, date: '2026-04-02T10:00:00Z' }),
    ]
    const score = scoreSet({
      priorSets,
      estimated1RM: 130, // working zone, below best of 200
      weightLbs: 100,
      reps: 8, // more than the prior 5 reps at 100
      dateKey: TODAY,
      baseline: null,
    })
    expect(score.isRepPR).toBe(true)
    expect(score.zone).toBe('working')
    // baseXP includes the repPR multiplier vs the same set without it.
    const withoutRepPR = scoreSet({
      priorSets: [makeSet({ estimated1RM: 200, weight: 999, reps: 5, date: '2026-04-01T10:00:00Z' })],
      estimated1RM: 130,
      weightLbs: 100,
      reps: 8,
      dateKey: TODAY,
      baseline: null,
    })
    expect(score.baseXP).toBeGreaterThan(withoutRepPR.baseXP)
  })

  it('does not flag a rep PR when already in the PR zone', () => {
    const priorSets = [makeSet({ estimated1RM: 100, weight: 100, reps: 5, date: '2026-04-01T10:00:00Z' })]
    const score = scoreSet({
      priorSets,
      estimated1RM: 250, // clear PR
      weightLbs: 100,
      reps: 10, // also more reps at 100
      dateKey: TODAY,
      baseline: null,
    })
    expect(score.isPRZone).toBe(true)
    expect(score.isRepPR).toBe(false)
  })

  it('flags isNewWeight for an improvement at an untried weight', () => {
    const priorSets = [makeSet({ estimated1RM: 200, weight: 100, reps: 5, date: '2026-04-01T10:00:00Z' })]
    const score = scoreSet({
      priorSets,
      estimated1RM: 160, // working zone
      weightLbs: 135, // never lifted 135 before
      reps: 5,
      dateKey: TODAY,
      baseline: null,
    })
    expect(score.isNewWeight).toBe(true)
    expect(score.isRepPR).toBe(false)
    expect(score.isPRZone).toBe(false)
  })

  it('honors the PR baseline when picking the best 1RM', () => {
    const priorSets = [
      makeSet({ estimated1RM: 300, date: '2026-01-01T10:00:00Z' }), // before baseline
      makeSet({ estimated1RM: 150, date: '2026-05-10T10:00:00Z' }), // after baseline
    ]
    const score = scoreSet({
      priorSets,
      estimated1RM: 200, // beats the post-baseline best (150) but not the all-time 300
      weightLbs: 180,
      reps: 3,
      dateKey: TODAY,
      baseline: '2026-05-01',
    })
    expect(score.best1RM).toBe(150)
    expect(score.zone).toBe('pr')
  })
})
