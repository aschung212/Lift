import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useVolumeTrend } from '../useVolumeTrend'
import type { Exercise } from '../../stores/workout'

function makeExercise(
  name: string,
  sets: { date: string; weight: number; reps: number; bodyweight?: number }[],
  bodyweightLoaded = false,
): Exercise {
  return {
    id: name.toLowerCase().replace(/\s/g, '-'),
    name,
    tags: [],
    ...(bodyweightLoaded ? { bodyweightLoaded: true } : {}),
    sets: sets.map((s, i) => ({
      id: `${name}-set-${i}`,
      date: s.date,
      weight: s.weight,
      reps: s.reps,
      ...(s.bodyweight !== undefined ? { bodyweight: s.bodyweight } : {}),
      estimated1RM: s.weight * (1 + s.reps / 30),
    })),
  }
}

describe('useVolumeTrend', () => {
  it('returns empty when there are no sets', () => {
    const exercises = ref<Exercise[]>([makeExercise('Bench', [])])
    const { weeklyVolume, totalVolume, weekCount } = useVolumeTrend(exercises)
    expect(weeklyVolume.value).toEqual([])
    expect(totalVolume.value).toBe(0)
    expect(weekCount.value).toBe(0)
  })

  it('sums weight × reps per ISO week, bucketed to Monday', () => {
    // 2026-03-23 is a Monday; 2026-03-25 is a Wednesday (same week).
    const exercises = ref([
      makeExercise('Squat', [
        { date: '2026-03-23T10:00:00', weight: 100, reps: 5 }, // 500
        { date: '2026-03-25T10:00:00', weight: 100, reps: 5 }, // 500
      ]),
    ])
    const { weeklyVolume, totalVolume } = useVolumeTrend(exercises)
    expect(weeklyVolume.value).toEqual([{ date: '2026-03-23', value: 1000 }])
    expect(totalVolume.value).toBe(1000)
  })

  it('buckets a Sunday into the prior Monday week', () => {
    // 2026-03-29 is a Sunday — belongs to the week starting Monday 2026-03-23.
    const exercises = ref([
      makeExercise('Row', [
        { date: '2026-03-29T10:00:00', weight: 50, reps: 10 }, // 500
      ]),
    ])
    const { weeklyVolume } = useVolumeTrend(exercises)
    expect(weeklyVolume.value).toEqual([{ date: '2026-03-23', value: 500 }])
  })

  it('fills empty weeks between first and last with 0 volume', () => {
    const exercises = ref([
      makeExercise('Deadlift', [
        { date: '2026-03-23T10:00:00', weight: 100, reps: 5 }, // week 1: 500
        { date: '2026-04-06T10:00:00', weight: 100, reps: 5 }, // week 3: 500
      ]),
    ])
    const { weeklyVolume, weekCount } = useVolumeTrend(exercises)
    expect(weeklyVolume.value).toEqual([
      { date: '2026-03-23', value: 500 },
      { date: '2026-03-30', value: 0 },
      { date: '2026-04-06', value: 500 },
    ])
    expect(weekCount.value).toBe(3)
  })

  it('aggregates across multiple exercises into the same week', () => {
    const exercises = ref([
      makeExercise('Bench', [{ date: '2026-03-24T10:00:00', weight: 80, reps: 10 }]), // 800
      makeExercise('Curl', [{ date: '2026-03-26T10:00:00', weight: 30, reps: 12 }]), // 360
    ])
    const { weeklyVolume, totalVolume } = useVolumeTrend(exercises)
    expect(weeklyVolume.value).toEqual([{ date: '2026-03-23', value: 1160 }])
    expect(totalVolume.value).toBe(1160)
  })

  // #1333 — the trend summed the raw `set.weight`, which on a bodyweightLoaded
  // exercise is only the ADDED plate weight. Every fixture above (and in every
  // other volume suite) is a normal barbell lift, where `effectiveSetWeight` is
  // the identity, so the whole class of defect was invisible: the fold has to
  // be pinned by a fixture that actually sets the flag.
  describe('bodyweight-loaded exercises (#1333)', () => {
    it('credits a pure-bodyweight set with the lifter’s weight, not zero', () => {
      const exercises = ref([
        makeExercise(
          'Pull-ups',
          [{ date: '2026-03-23T10:00:00', weight: 0, reps: 10, bodyweight: 185 }],
          true,
        ),
      ])
      const { weeklyVolume, totalVolume } = useVolumeTrend(exercises)
      // 185 effective × 10 reps. Before the fix this week read 0 — a training
      // day that vanished from the chart entirely.
      expect(weeklyVolume.value).toEqual([{ date: '2026-03-23', value: 1850 }])
      expect(totalVolume.value).toBe(1850)
    })

    it('folds bodyweight into a weighted set rather than counting only the belt', () => {
      const exercises = ref([
        makeExercise(
          'Weighted Dips',
          [{ date: '2026-03-23T10:00:00', weight: 25, reps: 8, bodyweight: 160 }],
          true,
        ),
      ])
      const { totalVolume } = useVolumeTrend(exercises)
      expect(totalVolume.value).toBe((160 + 25) * 8) // was 25 × 8 = 200
    })

    it('degrades to the added weight when a set captured no bodyweight', () => {
      // Logged before the flag was turned on, or by a lifter who has never
      // weighed in — `bodyweightFold` guesses nothing.
      const exercises = ref([
        makeExercise('Pull-ups', [{ date: '2026-03-23T10:00:00', weight: 45, reps: 5 }], true),
      ])
      const { totalVolume } = useVolumeTrend(exercises)
      expect(totalVolume.value).toBe(225)
    })

    it('leaves a normal barbell lift untouched even when its sets carry a bodyweight', () => {
      const exercises = ref([
        makeExercise('Squat', [{ date: '2026-03-23T10:00:00', weight: 225, reps: 5, bodyweight: 185 }]),
      ])
      const { totalVolume } = useVolumeTrend(exercises)
      expect(totalVolume.value).toBe(1125)
    })
  })

  it('reacts to exercise changes', () => {
    const exercises = ref<Exercise[]>([])
    const { weeklyVolume } = useVolumeTrend(exercises)
    expect(weeklyVolume.value).toEqual([])

    exercises.value = [
      makeExercise('Bench', [{ date: '2026-03-23T10:00:00', weight: 100, reps: 5 }]),
    ]
    expect(weeklyVolume.value).toEqual([{ date: '2026-03-23', value: 500 }])
  })
})
