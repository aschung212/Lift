import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useTagRecovery } from '../useTagRecovery'
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

describe('useTagRecovery', () => {
  const now = ref(new Date('2026-04-11T12:00:00'))
  const noExcluded = ref<string[]>([])

  it('finds the most recent set date per tag', () => {
    const exercises = ref([
      makeExercise('Bench Press', ['Chest', 'Push'], [
        { date: '2026-04-08T12:00:00' },
        { date: '2026-04-10T12:00:00' },
      ]),
    ])

    const { recovery } = useTagRecovery(exercises, ref({}), noExcluded, now)
    const chest = recovery.value.find(r => r.tag === 'Chest')
    expect(chest?.lastTrainedDate).toBe('2026-04-10')
    expect(chest?.daysSince).toBe(1)

    const push = recovery.value.find(r => r.tag === 'Push')
    expect(push?.lastTrainedDate).toBe('2026-04-10')
  })

  it('classifies status correctly with recovery windows in days', () => {
    const exercises = ref([
      makeExercise('Squat', ['Legs'], [{ date: '2026-04-08T12:00:00' }]),    // 3 days ago = 72h
      makeExercise('OHP', ['Shoulders'], [{ date: '2026-04-10T12:00:00' }]), // 1 day ago = 24h
      makeExercise('Curl', ['Biceps'], [{ date: '2026-04-11T08:00:00' }]),   // same day = ~4h
    ])

    const recoveryDays = ref({ Legs: 3, Shoulders: 2, Biceps: 2 })
    const { recovery } = useTagRecovery(exercises, recoveryDays, noExcluded, now)

    const legs = recovery.value.find(r => r.tag === 'Legs')
    expect(legs?.status).toBe('recovered') // 72h >= 72h (3 days)

    const shoulders = recovery.value.find(r => r.tag === 'Shoulders')
    expect(shoulders?.status).toBe('recovering') // 24h >= 24h (50% of 2 days)

    const biceps = recovery.value.find(r => r.tag === 'Biceps')
    expect(biceps?.status).toBe('recent') // ~4h < 24h (50% of 2 days)
  })

  it('uses unknown status when no recovery window set', () => {
    const exercises = ref([
      makeExercise('Bench', ['Chest'], [{ date: '2026-04-09T12:00:00' }]),
    ])

    const { recovery } = useTagRecovery(exercises, ref({}), noExcluded, now)
    expect(recovery.value[0].status).toBe('unknown')
    expect(recovery.value[0].recoveryDays).toBeNull()
  })

  it('sorts recovered first, then unknown, then recovering, then recent', () => {
    const exercises = ref([
      makeExercise('Squat', ['Legs'], [{ date: '2026-04-07T12:00:00' }]),      // 4 days ago, recovered
      makeExercise('Bench', ['Chest'], [{ date: '2026-04-09T12:00:00' }]),     // 2 days ago, unknown
      makeExercise('OHP', ['Shoulders'], [{ date: '2026-04-10T12:00:00' }]),   // 1 day ago, recovering
      makeExercise('Curl', ['Biceps'], [{ date: '2026-04-11T10:00:00' }]),     // same day, recent
    ])

    const recoveryDays = ref({ Legs: 3, Shoulders: 2, Biceps: 2 })
    const { recovery } = useTagRecovery(exercises, recoveryDays, noExcluded, now)

    const statuses = recovery.value.map(r => r.status)
    expect(statuses).toEqual(['recovered', 'unknown', 'recovering', 'recent'])
  })

  it('sorts by days since within the same status group', () => {
    const exercises = ref([
      makeExercise('Bench', ['Chest'], [{ date: '2026-04-09T12:00:00' }]),   // 2 days ago
      makeExercise('Row', ['Back'], [{ date: '2026-04-07T12:00:00' }]),      // 4 days ago
      makeExercise('OHP', ['Shoulders'], [{ date: '2026-04-10T12:00:00' }]), // 1 day ago
    ])

    const { recovery } = useTagRecovery(exercises, ref({}), noExcluded, now)
    const tags = recovery.value.map(r => r.tag)
    expect(tags).toEqual(['Back', 'Chest', 'Shoulders'])
  })

  it('excludes exercises with no tags', () => {
    const exercises = ref([
      makeExercise('Untagged', [], [{ date: '2026-04-10T12:00:00' }]),
    ])

    const { recovery, hasData } = useTagRecovery(exercises, ref({}), noExcluded, now)
    expect(recovery.value).toEqual([])
    expect(hasData.value).toBe(false)
  })

  it('excludes exercises with no sets', () => {
    const exercises = ref([
      makeExercise('Empty', ['Chest'], []),
    ])

    const { recovery, hasData } = useTagRecovery(exercises, ref({}), noExcluded, now)
    expect(recovery.value).toEqual([])
    expect(hasData.value).toBe(false)
  })

  it('aggregates across multiple exercises with the same tag', () => {
    const exercises = ref([
      makeExercise('Bench Press', ['Chest'], [{ date: '2026-04-08T12:00:00' }]),
      makeExercise('Incline Press', ['Chest'], [{ date: '2026-04-10T12:00:00' }]),
    ])

    const { recovery } = useTagRecovery(exercises, ref({}), noExcluded, now)
    expect(recovery.value).toHaveLength(1)
    expect(recovery.value[0].lastTrainedDate).toBe('2026-04-10')
  })

  it('reacts to exercise changes', () => {
    const exercises = ref<Exercise[]>([])
    const { recovery, hasData } = useTagRecovery(exercises, ref({}), noExcluded, now)
    expect(hasData.value).toBe(false)

    exercises.value = [
      makeExercise('Bench', ['Chest'], [{ date: '2026-04-10T12:00:00' }]),
    ]
    expect(hasData.value).toBe(true)
    expect(recovery.value[0].tag).toBe('Chest')
  })

  it('exposes hoursSince for precise bar width calculations', () => {
    const exercises = ref([
      makeExercise('Bench', ['Chest'], [{ date: '2026-04-11T08:00:00' }]),
    ])

    const { recovery } = useTagRecovery(exercises, ref({ Chest: 2 }), noExcluded, now)
    const chest = recovery.value[0]
    expect(chest.hoursSince).toBe(0)
    expect(chest.daysSince).toBe(0)
  })

  it('clamps future-dated sets to zero hours', () => {
    const exercises = ref([
      makeExercise('Bench', ['Chest'], [{ date: '2026-04-15T12:00:00' }]),
    ])

    const { recovery } = useTagRecovery(exercises, ref({ Chest: 2 }), noExcluded, now)
    const chest = recovery.value[0]
    expect(chest.hoursSince).toBe(0)
    expect(chest.daysSince).toBe(0)
    expect(chest.status).toBe('recent')
  })

  it('classifies exactly at recovery boundary as recovered', () => {
    const exercises = ref([
      makeExercise('Squat', ['Legs'], [{ date: '2026-04-08T12:00:00' }]), // exactly 3 days ago
    ])

    const { recovery } = useTagRecovery(exercises, ref({ Legs: 3 }), noExcluded, now)
    expect(recovery.value[0].status).toBe('recovered')
  })

  it('classifies exactly at 50% boundary as recovering', () => {
    const exercises = ref([
      makeExercise('OHP', ['Shoulders'], [{ date: '2026-04-10T12:00:00' }]), // 1 day ago = 50% of 2 days
    ])

    const { recovery } = useTagRecovery(exercises, ref({ Shoulders: 2 }), noExcluded, now)
    expect(recovery.value[0].status).toBe('recovering')
  })

  it('excludes tags in the excluded list', () => {
    const exercises = ref([
      makeExercise('Squat', ['Legs', 'Quads'], [{ date: '2026-04-10T12:00:00' }]),
    ])

    const excluded = ref(['Legs'])
    const { recovery } = useTagRecovery(exercises, ref({}), excluded, now)
    expect(recovery.value).toHaveLength(1)
    expect(recovery.value[0].tag).toBe('Quads')
  })

  it('reacts to excluded list changes', () => {
    const exercises = ref([
      makeExercise('Squat', ['Legs', 'Quads'], [{ date: '2026-04-10T12:00:00' }]),
    ])

    const excluded = ref<string[]>([])
    const { recovery } = useTagRecovery(exercises, ref({}), excluded, now)
    expect(recovery.value).toHaveLength(2)

    excluded.value = ['Legs']
    expect(recovery.value).toHaveLength(1)
    expect(recovery.value[0].tag).toBe('Quads')
  })
})
