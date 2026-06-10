import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useRepRangeDistribution, classifyRepZone } from '../useRepRangeDistribution'
import type { Exercise } from '../../stores/workout'

function makeExercise(name: string, sets: { date: string; reps: number }[]): Exercise {
  return {
    id: name.toLowerCase().replace(/\s/g, '-'),
    name,
    tags: [],
    sets: sets.map((s, i) => ({
      id: `set-${i}`,
      date: s.date,
      weight: 100,
      reps: s.reps,
      estimated1RM: 133,
    })),
  }
}

describe('classifyRepZone', () => {
  it('classifies 1-5 reps as strength', () => {
    expect(classifyRepZone(1)).toBe('strength')
    expect(classifyRepZone(5)).toBe('strength')
  })

  it('classifies 6-12 reps as hypertrophy', () => {
    expect(classifyRepZone(6)).toBe('hypertrophy')
    expect(classifyRepZone(12)).toBe('hypertrophy')
  })

  it('classifies 13+ reps as endurance', () => {
    expect(classifyRepZone(13)).toBe('endurance')
    expect(classifyRepZone(30)).toBe('endurance')
  })

  it('ignores non-positive or non-finite rep counts', () => {
    expect(classifyRepZone(0)).toBeNull()
    expect(classifyRepZone(-3)).toBeNull()
    expect(classifyRepZone(NaN)).toBeNull()
  })
})

describe('useRepRangeDistribution', () => {
  const weekDates = ref(['2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26', '2026-03-27', '2026-03-28', '2026-03-29'])

  it('counts sets into the three zones', () => {
    const exercises = ref([
      makeExercise('Bench Press', [
        { date: '2026-03-23T10:00:00.000Z', reps: 3 },  // strength
        { date: '2026-03-23T10:01:00.000Z', reps: 8 },  // hypertrophy
        { date: '2026-03-25T10:00:00.000Z', reps: 15 }, // endurance
      ]),
      makeExercise('Squat', [
        { date: '2026-03-24T10:00:00.000Z', reps: 10 }, // hypertrophy
      ]),
    ])

    const { zones, totalSets, hasData } = useRepRangeDistribution(exercises, weekDates)

    expect(zones.value.map(z => z.key)).toEqual(['strength', 'hypertrophy', 'endurance'])
    expect(zones.value.find(z => z.key === 'strength')?.sets).toBe(1)
    expect(zones.value.find(z => z.key === 'hypertrophy')?.sets).toBe(2)
    expect(zones.value.find(z => z.key === 'endurance')?.sets).toBe(1)
    expect(totalSets.value).toBe(4)
    expect(hasData.value).toBe(true)
  })

  it('always returns all three zones in a fixed order', () => {
    const exercises = ref([
      makeExercise('Curl', [{ date: '2026-03-23T10:00:00.000Z', reps: 10 }]),
    ])
    const { zones } = useRepRangeDistribution(exercises, weekDates)
    expect(zones.value).toHaveLength(3)
    expect(zones.value.map(z => z.key)).toEqual(['strength', 'hypertrophy', 'endurance'])
  })

  it('excludes sets outside the week', () => {
    const exercises = ref([
      makeExercise('Deadlift', [
        { date: '2026-03-23T10:00:00.000Z', reps: 5 }, // in week
        { date: '2026-03-22T10:00:00.000Z', reps: 5 }, // before
        { date: '2026-03-30T10:00:00.000Z', reps: 5 }, // after
      ]),
    ])
    const { totalSets } = useRepRangeDistribution(exercises, weekDates)
    expect(totalSets.value).toBe(1)
  })

  it('reports no data when nothing logged in the week', () => {
    const exercises = ref([
      makeExercise('Press', [{ date: '2026-03-15T10:00:00.000Z', reps: 8 }]),
    ])
    const { zones, totalSets, hasData } = useRepRangeDistribution(exercises, weekDates)
    expect(totalSets.value).toBe(0)
    expect(hasData.value).toBe(false)
    expect(zones.value.every(z => z.sets === 0)).toBe(true)
  })

  it('reacts to exercise changes', () => {
    const exercises = ref<Exercise[]>([])
    const { totalSets, hasData } = useRepRangeDistribution(exercises, weekDates)
    expect(hasData.value).toBe(false)

    exercises.value = [
      makeExercise('Row', [{ date: '2026-03-24T10:00:00.000Z', reps: 12 }]),
    ]
    expect(totalSets.value).toBe(1)
    expect(hasData.value).toBe(true)
  })
})
