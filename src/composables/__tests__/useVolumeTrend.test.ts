import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useVolumeTrend } from '../useVolumeTrend'
import type { Exercise } from '../../stores/workout'

function makeExercise(
  name: string,
  sets: { date: string; weight: number; reps: number }[],
): Exercise {
  return {
    id: name.toLowerCase().replace(/\s/g, '-'),
    name,
    tags: [],
    sets: sets.map((s, i) => ({
      id: `${name}-set-${i}`,
      date: s.date,
      weight: s.weight,
      reps: s.reps,
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
