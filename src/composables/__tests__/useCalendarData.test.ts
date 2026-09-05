import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useCalendarData } from '../useCalendarData'
import type { Exercise, WorkoutSet } from '../../stores/workout'

let setSeq = 0
function makeSet(date: string, weight: number, reps: number, e1rm: number, bodyweight?: number): WorkoutSet {
  return {
    id: `set-${setSeq++}`,
    date,
    weight,
    reps,
    estimated1RM: e1rm,
    ...(bodyweight !== undefined ? { bodyweight } : {}),
  }
}

function makeExercise(id: string, name: string, sets: WorkoutSet[], bodyweightLoaded = false): Exercise {
  return { id, name, tags: [], sets, ...(bodyweightLoaded ? { bodyweightLoaded: true } : {}) }
}

// A getExercisePR stand-in mirroring the store: max e1RM on/after an optional baseline.
function makeGetPR(exercises: Exercise[]) {
  return (exerciseId: string, sinceDate?: string | null): number => {
    const ex = exercises.find(e => e.id === exerciseId)
    if (!ex || ex.sets.length === 0) return 0
    const filtered = sinceDate
      ? ex.sets.filter(s => s.date.slice(0, 10) >= sinceDate)
      : ex.sets
    if (filtered.length === 0) return 0
    return Math.max(...filtered.map(s => s.estimated1RM))
  }
}

const identity = (v: number) => v

describe('useCalendarData', () => {
  describe('trainingMap', () => {
    it('maps each day to its unique exercise names', () => {
      const exercises = ref([
        makeExercise('bench', 'Bench Press', [
          makeSet('2026-03-23T23:59:00.000Z', 135, 10, 180),
          makeSet('2026-03-23T23:59:01.000Z', 135, 8, 175),
          makeSet('2026-03-25T23:59:00.000Z', 140, 5, 163),
        ]),
        makeExercise('squat', 'Squat', [
          makeSet('2026-03-23T23:59:02.000Z', 225, 5, 262),
        ]),
      ])
      const { trainingMap } = useCalendarData({
        exercises,
        selectedDay: ref(null),
        prBaselineDate: ref(null),
        getExercisePR: makeGetPR(exercises.value),
        displayWeight: identity,
      })

      expect(trainingMap.value['2026-03-23']).toEqual(['Bench Press', 'Squat'])
      expect(trainingMap.value['2026-03-25']).toEqual(['Bench Press'])
    })

    it('reacts to exercise changes', () => {
      const exercises = ref<Exercise[]>([])
      const { trainingMap } = useCalendarData({
        exercises,
        selectedDay: ref(null),
        prBaselineDate: ref(null),
        getExercisePR: makeGetPR([]),
        displayWeight: identity,
      })
      expect(trainingMap.value).toEqual({})

      exercises.value = [
        makeExercise('bench', 'Bench', [makeSet('2026-03-24T23:59:00.000Z', 135, 5, 157)]),
      ]
      expect(trainingMap.value['2026-03-24']).toEqual(['Bench'])
    })
  })

  describe('prMap / isPRExercise / hasPR', () => {
    it('awards the PR to the earliest date the record e1RM was reached', () => {
      // Two sets hit the same top e1RM (200); the earlier date owns the record.
      const exercises = ref([
        makeExercise('bench', 'Bench Press', [
          makeSet('2026-03-20T23:59:00.000Z', 150, 5, 200),
          makeSet('2026-03-25T23:59:00.000Z', 150, 5, 200),
          makeSet('2026-03-22T23:59:00.000Z', 140, 5, 163),
        ]),
      ])
      const { hasPR, isPRExercise } = useCalendarData({
        exercises,
        selectedDay: ref(null),
        prBaselineDate: ref(null),
        getExercisePR: makeGetPR(exercises.value),
        displayWeight: identity,
      })

      expect(hasPR('2026-03-20')).toBe(true)
      expect(isPRExercise('2026-03-20', 'Bench Press')).toBe(true)
      // The later tie is not a new record.
      expect(hasPR('2026-03-25')).toBe(false)
      expect(isPRExercise('2026-03-25', 'Bench Press')).toBe(false)
    })

    it('excludes sets before the PR baseline from record resolution', () => {
      const exercises = ref([
        makeExercise('bench', 'Bench Press', [
          makeSet('2026-03-01T23:59:00.000Z', 200, 5, 233), // pre-baseline all-time best
          makeSet('2026-03-20T23:59:00.000Z', 150, 5, 175), // best within baseline window
        ]),
      ])
      const { hasPR } = useCalendarData({
        exercises,
        selectedDay: ref(null),
        prBaselineDate: ref('2026-03-10'),
        getExercisePR: makeGetPR(exercises.value),
        displayWeight: identity,
      })

      // Pre-baseline set is ignored; the in-window best owns the PR.
      expect(hasPR('2026-03-01')).toBe(false)
      expect(hasPR('2026-03-20')).toBe(true)
    })
  })

  describe('daySummary', () => {
    it('aggregates exercises, sets, volume, and PR count for the selected day', () => {
      const exercises = ref([
        makeExercise('bench', 'Bench Press', [
          makeSet('2026-03-23T23:59:00.000Z', 100, 10, 133), // PR set
          makeSet('2026-03-23T23:59:01.000Z', 90, 10, 120),
        ]),
        makeExercise('squat', 'Squat', [
          makeSet('2026-03-23T23:59:02.000Z', 200, 5, 233), // PR set
        ]),
      ])
      const { daySummary } = useCalendarData({
        exercises,
        selectedDay: ref('2026-03-23'),
        prBaselineDate: ref(null),
        getExercisePR: makeGetPR(exercises.value),
        displayWeight: identity,
      })

      expect(daySummary.value).toEqual({
        exercises: 2,
        sets: 3,
        volumeDisplay: '2900', // 100*10 + 90*10 + 200*5 = 2900
        prs: 2,
      })
    })

    it('returns null when no day is selected', () => {
      const exercises = ref([
        makeExercise('bench', 'Bench Press', [makeSet('2026-03-23T23:59:00.000Z', 100, 10, 133)]),
      ])
      const { daySummary } = useCalendarData({
        exercises,
        selectedDay: ref(null),
        prBaselineDate: ref(null),
        getExercisePR: makeGetPR(exercises.value),
        displayWeight: identity,
      })
      expect(daySummary.value).toBeNull()
    })

    it('formats large volumes as a k-suffixed value', () => {
      const exercises = ref([
        makeExercise('squat', 'Squat', [makeSet('2026-03-23T23:59:00.000Z', 250, 50, 999)]),
      ])
      const { daySummary } = useCalendarData({
        exercises,
        selectedDay: ref('2026-03-23'),
        prBaselineDate: ref(null),
        getExercisePR: makeGetPR(exercises.value),
        displayWeight: identity,
      })
      // 250*50 = 12500 → 12.5k
      expect(daySummary.value?.volumeDisplay).toBe('12.5k')
    })

    // #1333 — the summary summed the raw `set.weight`, so tapping a day whose
    // only work was pull-ups reported "0 lbs" next to a real set count, while
    // the same sets on the same day charted ~5,550 in the exercise graph. Two
    // answers, both from the store, one screen apart.
    it('folds bodyweight into the day’s volume for a bodyweight-loaded exercise (#1333)', () => {
      const exercises = ref([
        makeExercise(
          'pullups',
          'Pull-ups',
          [
            makeSet('2026-03-23T23:59:00.000Z', 0, 10, 246, 185), // 1850
            makeSet('2026-03-23T23:59:01.000Z', 25, 6, 252, 185), // 1260
          ],
          true,
        ),
      ])
      const { daySummary } = useCalendarData({
        exercises,
        selectedDay: ref('2026-03-23'),
        prBaselineDate: ref(null),
        getExercisePR: makeGetPR(exercises.value),
        displayWeight: identity,
      })

      // Before the fix: 0*10 + 25*6 = '150'.
      expect(daySummary.value?.volumeDisplay).toBe('3110')
    })

    it('leaves the day’s volume alone for a normal lift whose sets carry a bodyweight', () => {
      const exercises = ref([
        makeExercise('squat', 'Squat', [makeSet('2026-03-23T23:59:00.000Z', 200, 5, 233, 185)]),
      ])
      const { daySummary } = useCalendarData({
        exercises,
        selectedDay: ref('2026-03-23'),
        prBaselineDate: ref(null),
        getExercisePR: makeGetPR(exercises.value),
        displayWeight: identity,
      })
      expect(daySummary.value?.volumeDisplay).toBe('1000')
    })
  })

  describe('getSetsForDay', () => {
    it('returns the day\'s sets sorted by e1RM descending, flagging the PR set', () => {
      const exercises = ref([
        makeExercise('bench', 'Bench Press', [
          makeSet('2026-03-23T23:59:00.000Z', 135, 8, 171),
          makeSet('2026-03-23T23:59:01.000Z', 155, 5, 181), // top / PR
          makeSet('2026-03-23T23:59:02.000Z', 115, 12, 161),
        ]),
      ])
      const { getSetsForDay } = useCalendarData({
        exercises,
        selectedDay: ref(null),
        prBaselineDate: ref(null),
        getExercisePR: makeGetPR(exercises.value),
        displayWeight: identity,
      })

      const sets = getSetsForDay('2026-03-23', 'Bench Press')
      expect(sets.map(s => s.estimated1RM)).toEqual([181, 171, 161])
      expect(sets[0].isPR).toBe(true)
      expect(sets[1].isPR).toBe(false)
    })

    it('does not flag any set as PR on a non-record day', () => {
      const exercises = ref([
        makeExercise('bench', 'Bench Press', [
          makeSet('2026-03-20T23:59:00.000Z', 155, 5, 181), // PR day
          makeSet('2026-03-23T23:59:00.000Z', 135, 5, 157), // later, lighter day
        ]),
      ])
      const { getSetsForDay } = useCalendarData({
        exercises,
        selectedDay: ref(null),
        prBaselineDate: ref(null),
        getExercisePR: makeGetPR(exercises.value),
        displayWeight: identity,
      })
      expect(getSetsForDay('2026-03-23', 'Bench Press').every(s => !s.isPR)).toBe(true)
    })

    it('returns an empty array for an unknown exercise name', () => {
      const exercises = ref<Exercise[]>([])
      const { getSetsForDay } = useCalendarData({
        exercises,
        selectedDay: ref(null),
        prBaselineDate: ref(null),
        getExercisePR: makeGetPR([]),
        displayWeight: identity,
      })
      expect(getSetsForDay('2026-03-23', 'Nope')).toEqual([])
    })
  })

  describe('getSetCount', () => {
    it('counts only the sets logged on the given day', () => {
      const exercises = ref([
        makeExercise('bench', 'Bench Press', [
          makeSet('2026-03-23T23:59:00.000Z', 135, 8, 171),
          makeSet('2026-03-23T23:59:01.000Z', 135, 8, 171),
          makeSet('2026-03-24T23:59:00.000Z', 135, 8, 171),
        ]),
      ])
      const { getSetCount } = useCalendarData({
        exercises,
        selectedDay: ref(null),
        prBaselineDate: ref(null),
        getExercisePR: makeGetPR(exercises.value),
        displayWeight: identity,
      })
      expect(getSetCount('2026-03-23', 'Bench Press')).toBe(2)
      expect(getSetCount('2026-03-24', 'Bench Press')).toBe(1)
      expect(getSetCount('2026-03-23', 'Nope')).toBe(0)
    })
  })
})
