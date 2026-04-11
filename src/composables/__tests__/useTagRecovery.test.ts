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
  // April 11 at 10am local — calendar day comparisons should not depend on time
  const now = ref(new Date('2026-04-11T10:00:00'))
  const noExcluded = ref<string[]>([])

  it('finds the most recent set date per tag', () => {
    const exercises = ref([
      makeExercise('Bench Press', ['Chest', 'Push'], [
        { date: '2026-04-08T23:59:30.000Z' },
        { date: '2026-04-10T23:59:45.000Z' },
      ]),
    ])

    const { recovery } = useTagRecovery(exercises, ref({}), noExcluded, now)
    const chest = recovery.value.find(r => r.tag === 'Chest')
    expect(chest?.lastTrainedDate).toBe('2026-04-10')
    expect(chest?.daysSince).toBe(1)

    const push = recovery.value.find(r => r.tag === 'Push')
    expect(push?.lastTrainedDate).toBe('2026-04-10')
  })

  it('counts calendar days correctly regardless of time', () => {
    // April 9 set, current date April 11 → 2 calendar days
    const exercises = ref([
      makeExercise('Tricep Ext', ['Triceps'], [{ date: '2026-04-09T23:59:42.123Z' }]),
    ])

    const { recovery } = useTagRecovery(exercises, ref({}), noExcluded, now)
    expect(recovery.value[0].daysSince).toBe(2) // April 9 → April 11 = 2 days
  })

  it('classifies status correctly with recovery windows in days', () => {
    const exercises = ref([
      makeExercise('Squat', ['Legs'], [{ date: '2026-04-08T23:59:00.000Z' }]),    // 3 days ago
      makeExercise('OHP', ['Shoulders'], [{ date: '2026-04-10T23:59:00.000Z' }]), // 1 day ago
      makeExercise('Curl', ['Biceps'], [{ date: '2026-04-11T08:00:00' }]),         // same day
    ])

    const recoveryDays = ref({ Legs: 3, Shoulders: 2, Biceps: 2 })
    const { recovery } = useTagRecovery(exercises, recoveryDays, noExcluded, now)

    const legs = recovery.value.find(r => r.tag === 'Legs')
    expect(legs?.status).toBe('recovered') // 3 days >= 3 day window

    const shoulders = recovery.value.find(r => r.tag === 'Shoulders')
    expect(shoulders?.status).toBe('recovering') // 1 day, 1*2 >= 2 day window

    const biceps = recovery.value.find(r => r.tag === 'Biceps')
    expect(biceps?.status).toBe('recent') // 0 days, 0*2 < 2 day window
  })

  it('uses unknown status when no recovery window set', () => {
    const exercises = ref([
      makeExercise('Bench', ['Chest'], [{ date: '2026-04-09T23:59:00.000Z' }]),
    ])

    const { recovery } = useTagRecovery(exercises, ref({}), noExcluded, now)
    expect(recovery.value[0].status).toBe('unknown')
    expect(recovery.value[0].recoveryDays).toBeNull()
  })

  it('sorts recovered first, then unknown, then recovering, then recent', () => {
    const exercises = ref([
      makeExercise('Squat', ['Legs'], [{ date: '2026-04-07T23:59:00.000Z' }]),    // 4 days ago, recovered
      makeExercise('Bench', ['Chest'], [{ date: '2026-04-09T23:59:00.000Z' }]),   // 2 days ago, unknown
      makeExercise('OHP', ['Shoulders'], [{ date: '2026-04-10T23:59:00.000Z' }]), // 1 day ago, recovering
      makeExercise('Curl', ['Biceps'], [{ date: '2026-04-11T08:00:00' }]),         // same day, recent
    ])

    const recoveryDays = ref({ Legs: 3, Shoulders: 2, Biceps: 2 })
    const { recovery } = useTagRecovery(exercises, recoveryDays, noExcluded, now)

    const statuses = recovery.value.map(r => r.status)
    expect(statuses).toEqual(['recovered', 'unknown', 'recovering', 'recent'])
  })

  it('sorts by days since within the same status group', () => {
    const exercises = ref([
      makeExercise('Bench', ['Chest'], [{ date: '2026-04-09T23:59:00.000Z' }]),   // 2 days ago
      makeExercise('Row', ['Back'], [{ date: '2026-04-07T23:59:00.000Z' }]),      // 4 days ago
      makeExercise('OHP', ['Shoulders'], [{ date: '2026-04-10T23:59:00.000Z' }]), // 1 day ago
    ])

    const { recovery } = useTagRecovery(exercises, ref({}), noExcluded, now)
    const tags = recovery.value.map(r => r.tag)
    expect(tags).toEqual(['Back', 'Chest', 'Shoulders'])
  })

  it('excludes exercises with no tags', () => {
    const exercises = ref([
      makeExercise('Untagged', [], [{ date: '2026-04-10T23:59:00.000Z' }]),
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
      makeExercise('Bench Press', ['Chest'], [{ date: '2026-04-08T23:59:00.000Z' }]),
      makeExercise('Incline Press', ['Chest'], [{ date: '2026-04-10T23:59:00.000Z' }]),
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
      makeExercise('Bench', ['Chest'], [{ date: '2026-04-10T23:59:00.000Z' }]),
    ]
    expect(hasData.value).toBe(true)
    expect(recovery.value[0].tag).toBe('Chest')
  })

  it('exposes hoursSince as daysSince * 24 for bar width calculations', () => {
    const exercises = ref([
      makeExercise('Bench', ['Chest'], [{ date: '2026-04-09T23:59:00.000Z' }]), // 2 days ago
    ])

    const { recovery } = useTagRecovery(exercises, ref({ Chest: 3 }), noExcluded, now)
    const chest = recovery.value[0]
    expect(chest.daysSince).toBe(2)
    expect(chest.hoursSince).toBe(48) // 2 * 24
  })

  it('clamps future-dated sets to zero days', () => {
    const exercises = ref([
      makeExercise('Bench', ['Chest'], [{ date: '2026-04-15T23:59:00.000Z' }]),
    ])

    const { recovery } = useTagRecovery(exercises, ref({ Chest: 2 }), noExcluded, now)
    const chest = recovery.value[0]
    expect(chest.hoursSince).toBe(0)
    expect(chest.daysSince).toBe(0)
    expect(chest.status).toBe('recent')
  })

  it('classifies exactly at recovery boundary as recovered', () => {
    const exercises = ref([
      makeExercise('Squat', ['Legs'], [{ date: '2026-04-08T23:59:00.000Z' }]), // 3 days ago
    ])

    const { recovery } = useTagRecovery(exercises, ref({ Legs: 3 }), noExcluded, now)
    expect(recovery.value[0].status).toBe('recovered')
  })

  it('classifies exactly at 50% boundary as recovering', () => {
    const exercises = ref([
      makeExercise('OHP', ['Shoulders'], [{ date: '2026-04-10T23:59:00.000Z' }]), // 1 day ago, 1*2 >= 2
    ])

    const { recovery } = useTagRecovery(exercises, ref({ Shoulders: 2 }), noExcluded, now)
    expect(recovery.value[0].status).toBe('recovering')
  })

  it('excludes tags in the excluded list', () => {
    const exercises = ref([
      makeExercise('Squat', ['Legs', 'Quads'], [{ date: '2026-04-10T23:59:00.000Z' }]),
    ])

    const excluded = ref(['Legs'])
    const { recovery } = useTagRecovery(exercises, ref({}), excluded, now)
    expect(recovery.value).toHaveLength(1)
    expect(recovery.value[0].tag).toBe('Quads')
  })

  it('reacts to excluded list changes', () => {
    const exercises = ref([
      makeExercise('Squat', ['Legs', 'Quads'], [{ date: '2026-04-10T23:59:00.000Z' }]),
    ])

    const excluded = ref<string[]>([])
    const { recovery } = useTagRecovery(exercises, ref({}), excluded, now)
    expect(recovery.value).toHaveLength(2)

    excluded.value = ['Legs']
    expect(recovery.value).toHaveLength(1)
    expect(recovery.value[0].tag).toBe('Quads')
  })

  it('shows today for sets logged today', () => {
    const exercises = ref([
      makeExercise('Bench', ['Chest'], [{ date: '2026-04-11T23:59:00.000Z' }]),
    ])

    const { recovery } = useTagRecovery(exercises, ref({}), noExcluded, now)
    expect(recovery.value[0].daysSince).toBe(0)
  })
})
