import { describe, it, expect } from 'vitest'
import {
  classifyExerciseWarmups,
  classifyWarmupsByExercise,
  normalizeWarmupThreshold,
  WARMUP_THRESHOLD_DEFAULT,
  WARMUP_THRESHOLD_MAX,
  WARMUP_THRESHOLD_MIN,
} from '../warmupFilter'
import type { WorkoutSet } from '../../stores/workout'

function makeSet(overrides: Partial<WorkoutSet> & { id: string; date: string; estimated1RM: number }): WorkoutSet {
  return {
    weight: 100,
    reps: 5,
    ...overrides,
  }
}

describe('classifyExerciseWarmups', () => {
  it('returns empty set for empty input', () => {
    expect(classifyExerciseWarmups([])).toEqual(new Set())
  })

  it('single-set day is never a warmup', () => {
    const sets: WorkoutSet[] = [
      makeSet({ id: 'a', date: '2026-04-17T10:00:00Z', estimated1RM: 50 }),
    ]
    expect(classifyExerciseWarmups(sets)).toEqual(new Set())
  })

  it('classifies a ramp-up set below threshold as warmup', () => {
    // 180 / 300 = 60% → warmup at 75% threshold
    // 240 / 300 = 80% → working at 75% threshold
    const sets: WorkoutSet[] = [
      makeSet({ id: 'warmup1', date: '2026-04-17T10:00:00Z', estimated1RM: 180 }),
      makeSet({ id: 'ramp',    date: '2026-04-17T10:05:00Z', estimated1RM: 240 }),
      makeSet({ id: 'top',     date: '2026-04-17T10:10:00Z', estimated1RM: 300 }),
    ]
    expect(classifyExerciseWarmups(sets, 0.75)).toEqual(new Set(['warmup1']))
  })

  it('sets logged AFTER the top set are never warmups (back-off / drop sets)', () => {
    const sets: WorkoutSet[] = [
      makeSet({ id: 'top',    date: '2026-04-17T10:00:00Z', estimated1RM: 300 }),
      makeSet({ id: 'backoff',date: '2026-04-17T10:05:00Z', estimated1RM: 100 }), // 33% — would be warmup by ratio, but logged after top
    ]
    expect(classifyExerciseWarmups(sets, 0.75)).toEqual(new Set())
  })

  it('top set itself is never a warmup even if ratio == 1.0', () => {
    const sets: WorkoutSet[] = [
      makeSet({ id: 'pre', date: '2026-04-17T10:00:00Z', estimated1RM: 50 }),
      makeSet({ id: 'top', date: '2026-04-17T10:05:00Z', estimated1RM: 200 }),
    ]
    const result = classifyExerciseWarmups(sets, 0.75)
    expect(result.has('top')).toBe(false)
    expect(result.has('pre')).toBe(true)
  })

  it('threshold boundary: ratio exactly equal to threshold is a warmup (inclusive)', () => {
    // 75 / 100 = 0.75 — should be classified as warmup at threshold 0.75
    const sets: WorkoutSet[] = [
      makeSet({ id: 'edge', date: '2026-04-17T10:00:00Z', estimated1RM: 75 }),
      makeSet({ id: 'top',  date: '2026-04-17T10:05:00Z', estimated1RM: 100 }),
    ]
    expect(classifyExerciseWarmups(sets, 0.75)).toEqual(new Set(['edge']))
  })

  it('threshold boundary: ratio just above threshold is NOT a warmup', () => {
    // 76 / 100 = 0.76 — above threshold 0.75
    const sets: WorkoutSet[] = [
      makeSet({ id: 'near', date: '2026-04-17T10:00:00Z', estimated1RM: 76 }),
      makeSet({ id: 'top',  date: '2026-04-17T10:05:00Z', estimated1RM: 100 }),
    ]
    expect(classifyExerciseWarmups(sets, 0.75)).toEqual(new Set())
  })

  it('ties on top e1RM use the chronologically first occurrence as "the top"', () => {
    // Two sets tie for max e1RM; first occurrence wins, second is "after top" → working.
    const sets: WorkoutSet[] = [
      makeSet({ id: 'wu',   date: '2026-04-17T10:00:00Z', estimated1RM: 60 }),  // 60% — warmup
      makeSet({ id: 'top1', date: '2026-04-17T10:05:00Z', estimated1RM: 200 }), // first max → the top
      makeSet({ id: 'low',  date: '2026-04-17T10:10:00Z', estimated1RM: 80 }),  // after top → working
      makeSet({ id: 'top2', date: '2026-04-17T10:15:00Z', estimated1RM: 200 }), // tie after top → working
    ]
    expect(classifyExerciseWarmups(sets, 0.75)).toEqual(new Set(['wu']))
  })

  it('groups by local date — same calendar day across timestamp jitter', () => {
    const sets: WorkoutSet[] = [
      makeSet({ id: 'wuDay1',  date: '2026-04-17T09:00:00Z', estimated1RM: 40 }),
      makeSet({ id: 'topDay1', date: '2026-04-17T10:00:00Z', estimated1RM: 200 }),
      // Different day — independent group
      makeSet({ id: 'soloDay2', date: '2026-04-18T10:00:00Z', estimated1RM: 50 }),
    ]
    const result = classifyExerciseWarmups(sets, 0.75)
    expect(result).toEqual(new Set(['wuDay1']))
    expect(result.has('soloDay2')).toBe(false)
  })

  it('different days do not influence each other', () => {
    // Day 1 has a heavy set (300) and a "warmup" (100)
    // Day 2 has only light sets (50, 60) — nothing should be a warmup on day 2 since max there is 60
    const sets: WorkoutSet[] = [
      makeSet({ id: 'd1-wu',  date: '2026-04-17T10:00:00Z', estimated1RM: 100 }),
      makeSet({ id: 'd1-top', date: '2026-04-17T10:05:00Z', estimated1RM: 300 }),
      makeSet({ id: 'd2-a',   date: '2026-04-18T10:00:00Z', estimated1RM: 50 }),
      makeSet({ id: 'd2-b',   date: '2026-04-18T10:05:00Z', estimated1RM: 60 }),
    ]
    const result = classifyExerciseWarmups(sets, 0.75)
    expect(result.has('d1-wu')).toBe(true)
    // 50 / 60 = 83% — above threshold, not a warmup
    expect(result.has('d2-a')).toBe(false)
    expect(result.has('d2-b')).toBe(false)
  })

  it('handles non-chronological input (sorts internally)', () => {
    const sets: WorkoutSet[] = [
      makeSet({ id: 'top', date: '2026-04-17T10:10:00Z', estimated1RM: 300 }),
      makeSet({ id: 'wu',  date: '2026-04-17T10:00:00Z', estimated1RM: 100 }),
    ]
    expect(classifyExerciseWarmups(sets, 0.75)).toEqual(new Set(['wu']))
  })

  it('ignores non-positive top e1RM defensively', () => {
    const sets: WorkoutSet[] = [
      makeSet({ id: 'a', date: '2026-04-17T10:00:00Z', estimated1RM: 0 }),
      makeSet({ id: 'b', date: '2026-04-17T10:05:00Z', estimated1RM: 0 }),
    ]
    expect(classifyExerciseWarmups(sets, 0.75)).toEqual(new Set())
  })

  it('higher threshold catches more sets as warmups', () => {
    // 76 / 100 = 0.76
    const sets: WorkoutSet[] = [
      makeSet({ id: 'near', date: '2026-04-17T10:00:00Z', estimated1RM: 76 }),
      makeSet({ id: 'top',  date: '2026-04-17T10:05:00Z', estimated1RM: 100 }),
    ]
    expect(classifyExerciseWarmups(sets, 0.75).size).toBe(0)
    expect(classifyExerciseWarmups(sets, 0.8)).toEqual(new Set(['near']))
  })
})

describe('classifyWarmupsByExercise', () => {
  it('classifies per-exercise — does not mix sets across exercises', () => {
    // Bench day: 135×10 (e1RM 180) before 225×5 (e1RM 262) — warmup
    // Squat day: solo heavy single 405×1 (e1RM 405)
    // If we mixed them, 180 / 405 = 44% would classify the bench warmup as a warmup
    // correctly by accident, but the squat solo would still be working.
    // Better test: squat's light set should NOT become a warmup because of bench's heavy set.
    const exercises = [
      {
        id: 'bench',
        sets: [
          makeSet({ id: 'b-wu',  date: '2026-04-17T10:00:00Z', estimated1RM: 180 }),
          makeSet({ id: 'b-top', date: '2026-04-17T10:05:00Z', estimated1RM: 262 }),
        ],
      },
      {
        id: 'squat',
        sets: [
          // Single set — must not be a warmup even though 100 < 262 × 0.75
          makeSet({ id: 's-solo', date: '2026-04-17T11:00:00Z', estimated1RM: 100 }),
        ],
      },
    ]
    const result = classifyWarmupsByExercise(exercises, 0.75)
    expect(result.has('b-wu')).toBe(true)
    expect(result.has('s-solo')).toBe(false)
  })

  it('returns empty set when no exercises', () => {
    expect(classifyWarmupsByExercise([], 0.75)).toEqual(new Set())
  })
})

describe('normalizeWarmupThreshold', () => {
  it('returns default for non-finite input', () => {
    expect(normalizeWarmupThreshold(NaN)).toBe(WARMUP_THRESHOLD_DEFAULT)
    expect(normalizeWarmupThreshold(Infinity)).toBe(WARMUP_THRESHOLD_DEFAULT)
  })

  it('clamps below min', () => {
    expect(normalizeWarmupThreshold(0.1)).toBe(WARMUP_THRESHOLD_MIN)
  })

  it('clamps above max', () => {
    expect(normalizeWarmupThreshold(0.99)).toBe(WARMUP_THRESHOLD_MAX)
  })

  it('snaps to nearest 5% step', () => {
    expect(normalizeWarmupThreshold(0.73)).toBe(0.75)
    expect(normalizeWarmupThreshold(0.77)).toBe(0.75)
    expect(normalizeWarmupThreshold(0.78)).toBe(0.8)
  })

  it('preserves valid step values', () => {
    expect(normalizeWarmupThreshold(0.75)).toBe(0.75)
    expect(normalizeWarmupThreshold(0.85)).toBe(0.85)
  })
})
