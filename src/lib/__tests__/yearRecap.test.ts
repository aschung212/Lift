import { describe, it, expect, afterEach, vi } from 'vitest'
import { buildYearRecap, hasYearRecapData } from '../yearRecap'
import { makeExercise } from '../../__tests__/helpers'
import { epley } from '../epley'
import type { Exercise, WorkoutSet } from '../../stores/workout'

/**
 * Year in Review aggregation (#1018).
 *
 * `buildYearRecap` is the first thing in the app that folds a whole year of the
 * workout store into one payload, and its output is EXPORTED — a PNG posted to
 * a social feed, where a wrong number is permanent and public. So the cases
 * here are the ones that make the number wrong rather than absent:
 *
 *  - the two stored date conventions (#746), pinned on BOTH sides of UTC,
 *    because CI runs UTC where the two derivations agree;
 *  - the bodyweight fold (#1333 / LIFT-1373), where an unfolded year reports a
 *    pure-bodyweight lifter as having moved nothing;
 *  - PR counting, which has to mean what the PR badge in the app means;
 *  - unit conversion, which must happen once, at the end, on a lbs total.
 */

/** `endOfDayISO(day)`'s shape: the prefix IS the user's chosen local day. */
function endOfDay(day: string): string {
  return `${day}T23:59:07.123Z`
}

/**
 * Local fixture rather than `helpers.makeSet`, which enumerates the fields it
 * copies and so silently drops `bodyweight` — the one field the fold cases
 * below turn on. Same reason `WorkoutTimeline.test.ts` and
 * `ExerciseDetailModal.test.ts` hand-roll theirs: a fixture that quietly
 * discards the field under test asserts against the un-folded path.
 */
function makeSet(over: Partial<WorkoutSet> & { weight: number; reps: number }): WorkoutSet {
  return {
    id: `s-${Math.random().toString(36).slice(2)}`,
    date: endOfDay('2026-04-01'),
    estimated1RM: epley(over.weight, over.reps),
    ...over,
  }
}

/**
 * Node honors a runtime `process.env.TZ` reassignment, which is the only way to
 * see a day-key defect at all: under CI's UTC both derivations agree, so a test
 * that doesn't pin a zone cannot fail (the #746 / LIFT-1247 / #1291 lesson).
 */
function withTZ(tz: string, fn: () => void) {
  const prev = process.env.TZ
  process.env.TZ = tz
  try {
    fn()
  } finally {
    process.env.TZ = prev
  }
}

/** kg conversion matching `useWeightUnit.displayWeight`. */
const toKg = (lbs: number) => +(lbs * 0.453592).toFixed(1)

afterEach(() => {
  vi.useRealTimers()
})

describe('buildYearRecap (#1018)', () => {
  describe('an untrained year', () => {
    const recap = buildYearRecap({ year: 2026, exercises: [makeExercise('Bench', [makeSet({ weight: 135, reps: 5, date: endOfDay('2025-06-01') })])] })

    it('reports zeros and nulls rather than throwing on empty input', () => {
      expect(recap.totalVolume).toBe(0)
      expect(recap.workouts).toBe(0)
      expect(recap.sets).toBe(0)
      expect(recap.exercises).toBe(0)
      expect(recap.prs).toBe(0)
      expect(recap.bestLift).toBeNull()
      expect(recap.topTag).toBeNull()
      expect(recap.longestStreakWeeks).toBe(0)
      expect(recap.busiestMonth).toBeNull()
      expect(recap.monthlyVolume).toEqual(new Array(12).fill(0))
    })

    it('is not worth showing — the entry point hides on this', () => {
      expect(hasYearRecapData(recap)).toBe(false)
      expect(hasYearRecapData(buildYearRecap({ year: 2025, exercises: [] }))).toBe(false)
    })
  })

  describe('the headline numbers', () => {
    const exercises: Exercise[] = [
      makeExercise('Bench Press', [
        makeSet({ weight: 135, reps: 10, date: endOfDay('2026-02-03') }),
        makeSet({ weight: 155, reps: 8, date: endOfDay('2026-02-03') }),
        makeSet({ weight: 185, reps: 3, date: endOfDay('2026-08-11') }),
      ], { id: 'ex-bench', tags: ['Push', 'Chest'] }),
      makeExercise('Squat', [
        makeSet({ weight: 225, reps: 5, date: endOfDay('2026-02-03') }),
        makeSet({ weight: 315, reps: 2, date: endOfDay('2026-08-11') }),
      ], { id: 'ex-squat', tags: ['Legs'] }),
      // Trained, but not in the year being recapped.
      makeExercise('Row', [makeSet({ weight: 95, reps: 10, date: endOfDay('2025-11-02') })], { id: 'ex-row', tags: ['Pull'] }),
    ]
    const recap = buildYearRecap({ year: 2026, exercises })

    it('counts sets, distinct training days and distinct exercises inside the year', () => {
      expect(recap.sets).toBe(5)
      expect(recap.workouts).toBe(2) // Feb 3 and Aug 11
      expect(recap.exercises).toBe(2) // Row was trained in 2025 only
      expect(hasYearRecapData(recap)).toBe(true)
    })

    it('sums volume over the year only', () => {
      // 1350 + 1240 + 555 + 1125 + 630 — the 2025 row (950) is excluded.
      expect(recap.totalVolume).toBe(4900)
    })

    it('buckets volume by month and names the busiest', () => {
      expect(recap.monthlyVolume[1]).toBe(3715) // February
      expect(recap.monthlyVolume[7]).toBe(1185) // August
      expect(recap.monthlyVolume.filter((v) => v > 0)).toHaveLength(2)
      expect(recap.busiestMonth).toBe(1)
    })

    it('picks the year’s heaviest lift by estimated 1RM', () => {
      expect(recap.bestLift).toMatchObject({
        exerciseId: 'ex-squat',
        name: 'Squat',
        loadLabel: '315 lbs',
        reps: 2,
        dateKey: '2026-08-11',
      })
      expect(recap.bestLift!.e1RM).toBe(epley(315, 2))
    })

    it('ranks the most-trained tag by set count, breaking ties by name', () => {
      // Bench carries Push + Chest (3 sets each); Squat carries Legs (2).
      expect(recap.topTag).toEqual({ tag: 'Chest', sets: 3 })
    })
  })

  describe('day-key conventions (#746)', () => {
    it('keeps a UI-logged New Year’s Eve set inside the year, east of UTC', () => {
      withTZ('Asia/Tokyo', () => {
        // `…T23:59Z` is 08:59 the NEXT morning in JST, so a raw toLocalDateKey
        // files this under 2027 — the lifter's last session of the year
        // disappears from the card that exists to celebrate it.
        const ex = makeExercise('Deadlift', [makeSet({ weight: 405, reps: 3, date: endOfDay('2026-12-31') })])
        const recap = buildYearRecap({ year: 2026, exercises: [ex] })
        expect(recap.sets).toBe(1)
        expect(recap.monthlyVolume[11]).toBe(1215)
        expect(recap.bestLift?.dateKey).toBe('2026-12-31')
      })
    })

    it('keeps a real-time evening instant on its LOCAL day, west of UTC', () => {
      withTZ('America/Los_Angeles', () => {
        // 2027-01-01T03:00Z is 7pm on Dec 31 in LA. A raw slice(0, 10) reads
        // the UTC prefix and pushes it into the following year.
        const ex = makeExercise('Deadlift', [makeSet({ weight: 405, reps: 3, date: '2027-01-01T03:00:00Z' })])
        const recap = buildYearRecap({ year: 2026, exercises: [ex] })
        expect(recap.sets).toBe(1)
        expect(recap.workouts).toBe(1)
        expect(recap.monthlyVolume[11]).toBe(1215)
      })
    })

    it('does not drag the next year’s first session backwards, west of UTC', () => {
      withTZ('America/Los_Angeles', () => {
        const ex = makeExercise('Deadlift', [makeSet({ weight: 405, reps: 3, date: endOfDay('2027-01-01') })])
        expect(buildYearRecap({ year: 2026, exercises: [ex] }).sets).toBe(0)
        expect(buildYearRecap({ year: 2027, exercises: [ex] }).sets).toBe(1)
      })
    })
  })

  describe('bodyweight-loaded work (#1333 / LIFT-1373)', () => {
    const pullups = makeExercise('Pull-up', [
      makeSet({ weight: 0, reps: 12, date: endOfDay('2026-05-04'), bodyweight: 170, estimated1RM: epley(170, 12) }),
      makeSet({ weight: 25, reps: 8, date: endOfDay('2026-05-04'), bodyweight: 170, estimated1RM: epley(195, 8) }),
    ], { id: 'ex-pullup', bodyweightLoaded: true, tags: ['Pull'] })

    it('folds bodyweight into volume — a calisthenic year is not a zero-volume year', () => {
      const recap = buildYearRecap({ year: 2026, exercises: [pullups] })
      // 170×12 + 195×8 = 2040 + 1560. Raw `weight × reps` would report 200.
      expect(recap.totalVolume).toBe(3600)
      expect(recap.monthlyVolume[4]).toBe(3600)
    })

    it('says "Bodyweight", never "0 lbs", when the best lift added nothing', () => {
      const soloBodyweight = makeExercise('Pull-up', [
        makeSet({ weight: 0, reps: 12, date: endOfDay('2026-05-04'), bodyweight: 170, estimated1RM: epley(170, 12) }),
      ], { id: 'ex-pullup', bodyweightLoaded: true })
      const recap = buildYearRecap({ year: 2026, exercises: [soloBodyweight] })
      expect(recap.bestLift?.loadLabel).toBe('Bodyweight')
      // The e1RM beside it is the folded one, so the two halves agree.
      expect(recap.bestLift?.e1RM).toBe(epley(170, 12))
    })

    it('marks an added load with a "+" so it reads as the belt, not the bar', () => {
      const recap = buildYearRecap({ year: 2026, exercises: [pullups] })
      expect(recap.bestLift?.loadLabel).toBe('+25 lbs')
    })

    it('leaves a set logged before the flag reading its bare weight', () => {
      // No captured bodyweight → nothing was folded, so the label must not
      // claim a bodyweight the set never recorded.
      const preFlag = makeExercise('Pull-up', [
        makeSet({ weight: 0, reps: 12, date: endOfDay('2026-05-04') }),
      ], { id: 'ex-pullup', bodyweightLoaded: true })
      const recap = buildYearRecap({ year: 2026, exercises: [preFlag] })
      expect(recap.bestLift?.loadLabel).toBe('0 lbs')
      expect(recap.totalVolume).toBe(0)
    })
  })

  describe('PR counting', () => {
    /** One set per day, ascending through `e1RMs`. */
    function exerciseWithDailyBests(id: string, days: [string, number][]): Exercise {
      return makeExercise(id, days.map(([day, e1RM]) =>
        makeSet({ weight: 100, reps: 5, date: endOfDay(day), estimated1RM: e1RM })), { id })
    }

    it('does not count an exercise’s first day — nothing was beaten yet', () => {
      // Matches `scoreSet`: no established best → zone `new_exercise`, not a
      // PR. Counting it would hand a lifter who tried thirty new movements
      // thirty free PRs.
      const recap = buildYearRecap({
        year: 2026,
        exercises: [exerciseWithDailyBests('ex-1', [['2026-01-07', 200]])],
      })
      expect(recap.prs).toBe(0)
    })

    it('counts each day that beats every earlier day', () => {
      const recap = buildYearRecap({
        year: 2026,
        exercises: [exerciseWithDailyBests('ex-1', [
          ['2026-01-07', 200], // first day — not a PR
          ['2026-01-14', 210], // PR
          ['2026-01-21', 205], // no
          ['2026-01-28', 210], // tie — not a PR
          ['2026-02-04', 225], // PR
        ])],
      })
      expect(recap.prs).toBe(2)
    })

    it('counts one PR per exercise-day, not one per ascending set', () => {
      const ex = makeExercise('Bench', [
        makeSet({ weight: 135, reps: 5, date: endOfDay('2026-01-07'), estimated1RM: 150 }),
        makeSet({ weight: 185, reps: 5, date: endOfDay('2026-01-14'), estimated1RM: 200 }),
        makeSet({ weight: 195, reps: 5, date: endOfDay('2026-01-14'), estimated1RM: 210 }),
        makeSet({ weight: 205, reps: 5, date: endOfDay('2026-01-14'), estimated1RM: 220 }),
      ], { id: 'ex-bench' })
      expect(buildYearRecap({ year: 2026, exercises: [ex] }).prs).toBe(1)
    })

    it('measures against history from earlier years, not against the year alone', () => {
      const ex = exerciseWithDailyBests('ex-1', [
        ['2025-11-03', 300], // last year's best
        ['2026-01-07', 250], // well under it — not a PR
        ['2026-06-01', 310], // finally beats it
      ])
      expect(buildYearRecap({ year: 2026, exercises: [ex] }).prs).toBe(1)
    })
  })

  describe('longest streak', () => {
    it('counts consecutive Mon–Sun weeks and resets on a missed week', () => {
      const ex = makeExercise('Bench', [
        makeSet({ weight: 100, reps: 5, date: endOfDay('2026-01-07') }), // week of Mon Jan 5
        makeSet({ weight: 100, reps: 5, date: endOfDay('2026-01-13') }), // week of Mon Jan 12
        makeSet({ weight: 100, reps: 5, date: endOfDay('2026-01-20') }), // week of Mon Jan 19
        // week of Mon Jan 26 skipped
        makeSet({ weight: 100, reps: 5, date: endOfDay('2026-02-03') }), // week of Mon Feb 2
      ], { id: 'ex-bench' })
      expect(buildYearRecap({ year: 2026, exercises: [ex] }).longestStreakWeeks).toBe(3)
    })

    it('treats several days in one week as one week', () => {
      const ex = makeExercise('Bench', [
        makeSet({ weight: 100, reps: 5, date: endOfDay('2026-01-05') }), // Monday
        makeSet({ weight: 100, reps: 5, date: endOfDay('2026-01-08') }), // Thursday
        makeSet({ weight: 100, reps: 5, date: endOfDay('2026-01-11') }), // Sunday
      ], { id: 'ex-bench' })
      expect(buildYearRecap({ year: 2026, exercises: [ex] }).longestStreakWeeks).toBe(1)
    })

    it('does not credit a streak from another year to this one', () => {
      const ex = makeExercise('Bench', [
        makeSet({ weight: 100, reps: 5, date: endOfDay('2025-12-15') }),
        makeSet({ weight: 100, reps: 5, date: endOfDay('2025-12-22') }),
        makeSet({ weight: 100, reps: 5, date: endOfDay('2026-01-07') }),
      ], { id: 'ex-bench' })
      // "Your longest streak in 2026" is the claim the 2026 card makes.
      expect(buildYearRecap({ year: 2026, exercises: [ex] }).longestStreakWeeks).toBe(1)
    })
  })

  describe('display units', () => {
    const ex = makeExercise('Squat', [
      makeSet({ weight: 225, reps: 5, date: endOfDay('2026-03-10') }),
    ], { id: 'ex-squat' })

    it('defaults to lbs and converts nothing', () => {
      const recap = buildYearRecap({ year: 2026, exercises: [ex] })
      expect(recap.unitLabel).toBe('lbs')
      expect(recap.totalVolume).toBe(1125)
    })

    it('converts once, at the end, on a lbs total (LIFT-1315)', () => {
      const recap = buildYearRecap({ year: 2026, exercises: [ex], toDisplayUnits: toKg, unitLabel: 'kg' })
      expect(recap.unitLabel).toBe('kg')
      expect(recap.totalVolume).toBe(510.3) // 1125 lbs → kg, then rounded to 1dp
      expect(recap.monthlyVolume[2]).toBe(510.3)
      expect(recap.bestLift?.loadLabel).toBe('102.1 kg')
      expect(recap.bestLift?.e1RM).toBe(+toKg(epley(225, 5)).toFixed(1))
    })
  })

  describe('clock independence (#1254)', () => {
    it('answers the same thing whatever day it is run on', () => {
      // The year is a parameter, never `new Date()` — so a "2026 in Review"
      // card built on New Year's Day is the same card it was in December, and
      // a fixture here cannot expire on its own the way #1254's did.
      const exercises = [makeExercise('Bench', [
        makeSet({ weight: 135, reps: 5, date: endOfDay('2026-04-02') }),
        makeSet({ weight: 185, reps: 3, date: endOfDay('2026-09-18') }),
      ], { id: 'ex-bench' })]

      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-12-31T12:00:00Z'))
      const during = buildYearRecap({ year: 2026, exercises })
      vi.setSystemTime(new Date('2029-07-04T12:00:00Z'))
      const later = buildYearRecap({ year: 2026, exercises })

      expect(later).toEqual(during)
      expect(later.sets).toBe(2)
    })
  })
})
