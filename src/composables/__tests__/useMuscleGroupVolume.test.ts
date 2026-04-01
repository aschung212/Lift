import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useMuscleGroupVolume } from '../useMuscleGroupVolume'
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

describe('useMuscleGroupVolume', () => {
  const weekDates = ref(['2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26', '2026-03-27', '2026-03-28', '2026-03-29'])

  it('counts sets per muscle group for the week', () => {
    const exercises = ref([
      makeExercise('Bench Press', ['Push', 'Chest'], [
        { date: '2026-03-23T12:00:00' },
        { date: '2026-03-23T12:00:00' },
        { date: '2026-03-25T12:00:00' },
      ]),
      makeExercise('Barbell Row', ['Pull', 'Back'], [
        { date: '2026-03-24T12:00:00' },
        { date: '2026-03-24T12:00:00' },
      ]),
    ])

    const { weeklyVolume, maxSets, totalSets } = useMuscleGroupVolume(exercises, weekDates)

    // Bench Press (Push+Chest): 3 sets → Chest: 3, Shoulders: 3, Triceps: 3
    // Barbell Row (Pull+Back): 2 sets → Back: 2, Biceps: 2
    const chest = weeklyVolume.value.find(v => v.group === 'Chest')
    expect(chest?.sets).toBe(3)

    const back = weeklyVolume.value.find(v => v.group === 'Back')
    expect(back?.sets).toBe(2)

    const shoulders = weeklyVolume.value.find(v => v.group === 'Shoulders')
    expect(shoulders?.sets).toBe(3)

    const biceps = weeklyVolume.value.find(v => v.group === 'Biceps')
    expect(biceps?.sets).toBe(2)

    const triceps = weeklyVolume.value.find(v => v.group === 'Triceps')
    expect(triceps?.sets).toBe(3)

    expect(maxSets.value).toBe(3)
    // Total = 3(Chest) + 2(Back) + 3(Shoulders) + 2(Biceps) + 3(Triceps) = 13
    expect(totalSets.value).toBe(13)
  })

  it('excludes sets outside the week', () => {
    const exercises = ref([
      makeExercise('Squat', ['Legs'], [
        { date: '2026-03-23T12:00:00' }, // in week
        { date: '2026-03-22T12:00:00' }, // before week
        { date: '2026-03-30T12:00:00' }, // after week
      ]),
    ])

    const { weeklyVolume, totalSets } = useMuscleGroupVolume(exercises, weekDates)
    const legs = weeklyVolume.value.find(v => v.group === 'Legs')
    expect(legs?.sets).toBe(1)
    expect(totalSets.value).toBe(1)
  })

  it('returns empty when no exercises have recognized tags', () => {
    const exercises = ref([
      makeExercise('Custom Move', ['Custom'], [
        { date: '2026-03-23T12:00:00' },
      ]),
    ])

    const { weeklyVolume, maxSets, totalSets } = useMuscleGroupVolume(exercises, weekDates)
    expect(weeklyVolume.value).toEqual([])
    expect(maxSets.value).toBe(0)
    expect(totalSets.value).toBe(0)
  })

  it('returns empty when no sets in the week', () => {
    const exercises = ref([
      makeExercise('Bench Press', ['Chest'], [
        { date: '2026-03-15T12:00:00' }, // previous week
      ]),
    ])

    const { weeklyVolume } = useMuscleGroupVolume(exercises, weekDates)
    expect(weeklyVolume.value).toEqual([])
  })

  it('returns muscle groups in canonical order', () => {
    const exercises = ref([
      makeExercise('Squat', ['Legs'], [{ date: '2026-03-23T12:00:00' }]),
      makeExercise('Bench', ['Chest'], [{ date: '2026-03-23T12:00:00' }]),
      makeExercise('Row', ['Back'], [{ date: '2026-03-23T12:00:00' }]),
    ])

    const { weeklyVolume } = useMuscleGroupVolume(exercises, weekDates)
    const groupOrder = weeklyVolume.value.map(v => v.group)
    // Canonical order: Chest, Back, ..., Legs
    expect(groupOrder.indexOf('Chest')).toBeLessThan(groupOrder.indexOf('Back'))
    expect(groupOrder.indexOf('Back')).toBeLessThan(groupOrder.indexOf('Legs'))
  })

  it('reacts to exercise changes', () => {
    const exercises = ref<Exercise[]>([])

    const { weeklyVolume } = useMuscleGroupVolume(exercises, weekDates)
    expect(weeklyVolume.value).toEqual([])

    exercises.value = [
      makeExercise('Bench', ['Chest'], [{ date: '2026-03-24T12:00:00' }]),
    ]

    expect(weeklyVolume.value).toHaveLength(1)
    expect(weeklyVolume.value[0].group).toBe('Chest')
    expect(weeklyVolume.value[0].sets).toBe(1)
  })
})
