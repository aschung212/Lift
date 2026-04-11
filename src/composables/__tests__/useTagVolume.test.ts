import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useTagVolume } from '../useTagVolume'
import type { Exercise } from '../../stores/workout'

function makeExercise(name: string, tags: string[], sets: { date: string }[]): Exercise {
  return {
    id: name.toLowerCase().replace(/\s/g, '-'),
    name,
    tags,
    sets: sets.map((s, i) => ({
      id: `set-${i}`,
      date: s.date,
      weight: 100,
      reps: 10,
      estimated1RM: 133,
    })),
  }
}

describe('useTagVolume', () => {
  const weekDates = ref(['2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26', '2026-03-27', '2026-03-28', '2026-03-29'])

  it('counts sets per tag for the week', () => {
    const exercises = ref([
      makeExercise('Bench Press', ['Push', 'Chest'], [
        { date: '2026-03-23T23:59:00.000Z' },
        { date: '2026-03-23T23:59:01.000Z' },
        { date: '2026-03-25T23:59:00.000Z' },
      ]),
      makeExercise('Barbell Row', ['Pull', 'Back'], [
        { date: '2026-03-24T23:59:00.000Z' },
        { date: '2026-03-24T23:59:01.000Z' },
      ]),
    ])

    const { weeklyVolume, totalSets } = useTagVolume(exercises, weekDates)

    const chest = weeklyVolume.value.find(v => v.tag === 'Chest')
    expect(chest?.sets).toBe(3)

    const push = weeklyVolume.value.find(v => v.tag === 'Push')
    expect(push?.sets).toBe(3)

    const back = weeklyVolume.value.find(v => v.tag === 'Back')
    expect(back?.sets).toBe(2)

    const pull = weeklyVolume.value.find(v => v.tag === 'Pull')
    expect(pull?.sets).toBe(2)

    // Total counts each set once per tag, so 3+3+2+2 = 10
    expect(totalSets.value).toBe(10)
  })

  it('excludes sets outside the week', () => {
    const exercises = ref([
      makeExercise('Squat', ['Legs'], [
        { date: '2026-03-23T23:59:00.000Z' }, // in week
        { date: '2026-03-22T23:59:00.000Z' }, // before week
        { date: '2026-03-30T23:59:00.000Z' }, // after week
      ]),
    ])

    const { weeklyVolume, totalSets } = useTagVolume(exercises, weekDates)
    const legs = weeklyVolume.value.find(v => v.tag === 'Legs')
    expect(legs?.sets).toBe(1)
    expect(totalSets.value).toBe(1)
  })

  it('returns empty when no exercises have tags', () => {
    const exercises = ref([
      makeExercise('Custom Move', [], [
        { date: '2026-03-23T23:59:00.000Z' },
      ]),
    ])

    const { weeklyVolume, maxSets, totalSets } = useTagVolume(exercises, weekDates)
    expect(weeklyVolume.value).toEqual([])
    expect(maxSets.value).toBe(0)
    expect(totalSets.value).toBe(0)
  })

  it('returns empty when no sets in the week', () => {
    const exercises = ref([
      makeExercise('Bench Press', ['Chest'], [
        { date: '2026-03-15T23:59:00.000Z' }, // previous week
      ]),
    ])

    const { weeklyVolume } = useTagVolume(exercises, weekDates)
    expect(weeklyVolume.value).toEqual([])
  })

  it('sorts by set count descending', () => {
    const exercises = ref([
      makeExercise('Squat', ['Legs'], [{ date: '2026-03-23T23:59:00.000Z' }]),
      makeExercise('Bench', ['Chest'], [
        { date: '2026-03-23T23:59:00.000Z' },
        { date: '2026-03-23T23:59:01.000Z' },
        { date: '2026-03-23T23:59:02.000Z' },
      ]),
      makeExercise('Row', ['Back'], [
        { date: '2026-03-23T23:59:00.000Z' },
        { date: '2026-03-23T23:59:01.000Z' },
      ]),
    ])

    const { weeklyVolume } = useTagVolume(exercises, weekDates)
    const tags = weeklyVolume.value.map(v => v.tag)
    expect(tags).toEqual(['Chest', 'Back', 'Legs'])
  })

  it('reacts to exercise changes', () => {
    const exercises = ref<Exercise[]>([])

    const { weeklyVolume } = useTagVolume(exercises, weekDates)
    expect(weeklyVolume.value).toEqual([])

    exercises.value = [
      makeExercise('Bench', ['Chest'], [{ date: '2026-03-24T23:59:00.000Z' }]),
    ]

    expect(weeklyVolume.value).toHaveLength(1)
    expect(weeklyVolume.value[0].tag).toBe('Chest')
    expect(weeklyVolume.value[0].sets).toBe(1)
  })
})
