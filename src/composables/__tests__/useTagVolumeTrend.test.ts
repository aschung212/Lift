import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useTagVolumeTrend } from '../useTagVolumeTrend'
import type { Exercise } from '../../stores/workout'

function makeExercise(
  name: string,
  tags: string[],
  sets: { date: string; weight?: number; reps?: number }[],
): Exercise {
  return {
    id: name.toLowerCase().replace(/\s/g, '-'),
    name,
    tags,
    sets: sets.map((s, i) => ({
      id: `${name}-set-${i}`,
      date: s.date,
      weight: s.weight ?? 100,
      reps: s.reps ?? 10,
      estimated1RM: 133,
    })),
  }
}

describe('useTagVolumeTrend', () => {
  it('buckets per-tag volume by ISO week', () => {
    // Two distinct weeks for Chest.
    const exercises = ref([
      makeExercise('Bench', ['Chest'], [
        { date: '2026-03-02T18:00:00.000Z', weight: 100, reps: 10 }, // week of Mar 2
        { date: '2026-03-09T18:00:00.000Z', weight: 100, reps: 10 }, // week of Mar 9
      ]),
    ])

    const { tagTrends } = useTagVolumeTrend(exercises)
    const chest = tagTrends.value['Chest']
    expect(chest).toHaveLength(2)
    expect(chest[0]).toEqual({ date: '2026-03-02', value: 1000 })
    expect(chest[1]).toEqual({ date: '2026-03-09', value: 1000 })
  })

  it('sums volume across exercises sharing a tag in the same week', () => {
    const exercises = ref([
      makeExercise('Bench', ['Push'], [{ date: '2026-03-02T18:00:00.000Z', weight: 100, reps: 5 }]),
      makeExercise('Overhead Press', ['Push'], [{ date: '2026-03-03T18:00:00.000Z', weight: 50, reps: 8 }]),
    ])

    const { tagTrends } = useTagVolumeTrend(exercises)
    // 100*5 + 50*8 = 500 + 400 = 900
    expect(tagTrends.value['Push']).toEqual([{ date: '2026-03-02', value: 900 }])
  })

  it('fills intervening empty weeks with zero volume', () => {
    const exercises = ref([
      makeExercise('Squat', ['Legs'], [
        { date: '2026-03-02T18:00:00.000Z' }, // week of Mar 2
        { date: '2026-03-16T18:00:00.000Z' }, // week of Mar 16 (skips Mar 9)
      ]),
    ])

    const { tagTrends } = useTagVolumeTrend(exercises)
    const legs = tagTrends.value['Legs']
    expect(legs.map(e => e.date)).toEqual(['2026-03-02', '2026-03-09', '2026-03-16'])
    expect(legs[1].value).toBe(0)
  })

  it('extends a neglected tag with a zero tail up to the most recent trained week', () => {
    // Legs last trained Mar 2, but Chest keeps training through Mar 16.
    const exercises = ref([
      makeExercise('Squat', ['Legs'], [{ date: '2026-03-02T18:00:00.000Z' }]),
      makeExercise('Bench', ['Chest'], [
        { date: '2026-03-09T18:00:00.000Z' },
        { date: '2026-03-16T18:00:00.000Z' },
      ]),
    ])

    const { tagTrends } = useTagVolumeTrend(exercises)
    const legs = tagTrends.value['Legs']
    // Legs starts Mar 2 and is padded with zeros through the global last week (Mar 16).
    expect(legs.map(e => e.date)).toEqual(['2026-03-02', '2026-03-09', '2026-03-16'])
    expect(legs[0].value).toBeGreaterThan(0)
    expect(legs[1].value).toBe(0)
    expect(legs[2].value).toBe(0)
  })

  it('ignores exercises without tags', () => {
    const exercises = ref([
      makeExercise('Custom', [], [{ date: '2026-03-02T18:00:00.000Z' }]),
    ])

    const { tagTrends } = useTagVolumeTrend(exercises)
    expect(tagTrends.value).toEqual({})
  })

  it('returns an empty map when there are no sets', () => {
    const exercises = ref<Exercise[]>([])
    const { tagTrends } = useTagVolumeTrend(exercises)
    expect(tagTrends.value).toEqual({})
  })

  it('reacts to exercise changes', () => {
    const exercises = ref<Exercise[]>([])
    const { tagTrends } = useTagVolumeTrend(exercises)
    expect(tagTrends.value).toEqual({})

    exercises.value = [
      makeExercise('Bench', ['Chest'], [
        { date: '2026-03-02T18:00:00.000Z' },
        { date: '2026-03-09T18:00:00.000Z' },
      ]),
    ]
    expect(tagTrends.value['Chest']).toHaveLength(2)
  })
})
