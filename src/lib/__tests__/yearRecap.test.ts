/**
 * #1018 — `buildYearRecap` aggregates one calendar year of training into the
 * shape the year-in-review share cards render.
 *
 * Three of these tests exist because the same three mistakes have already
 * shipped elsewhere in this app and every one of them is silent:
 *
 *  - **Day keys.** A year is decided by the first four characters of a LOCAL
 *    day key, so the two storage conventions (#746) both have to survive the
 *    year boundary. CI runs UTC, where the right and wrong derivations agree —
 *    which is why the timezone cases below force a zone on each side of it.
 *  - **The bodyweight fold** (LIFT-834/#1333): a year of pull-ups must not
 *    report zero volume.
 *  - **The load's WORDS** (LIFT-1373): the top lift's load sits beside an e1RM
 *    computed off the folded load, so a pure-bodyweight set must read
 *    "Bodyweight", never "0 lbs".
 */
import { describe, it, expect } from 'vitest'
import { buildYearRecap } from '../yearRecap'
import type { Exercise, WorkoutSet } from '../../stores/workout'

/** Node honors a runtime `process.env.TZ` reassignment (same trick as dates.test.ts). */
function withTZ(tz: string, fn: () => void) {
  const prev = process.env.TZ
  process.env.TZ = tz
  try {
    fn()
  } finally {
    process.env.TZ = prev
  }
}

/** The stamp `logSet` writes for a UI-logged set: the chosen LOCAL day. */
function day(key: string): string {
  return `${key}T23:59:00.000Z`
}

function set(
  id: string,
  date: string,
  weight: number,
  reps: number,
  estimated1RM: number,
  extra: Partial<WorkoutSet> = {},
): WorkoutSet {
  return { id, date, weight, reps, estimated1RM, ...extra }
}

function exercise(id: string, name: string, sets: WorkoutSet[], extra: Partial<Exercise> = {}): Exercise {
  return { id, name, tags: [], sets, ...extra }
}

const KG = (lb: number) => +(lb * 0.453592).toFixed(1)

describe('buildYearRecap', () => {
  describe('totals', () => {
    const exercises = [
      exercise(
        'ex1',
        'Bench Press',
        [
          set('a1', day('2026-01-05'), 185, 5, 208),
          set('a2', day('2026-01-05'), 205, 5, 230),
          set('a3', day('2026-03-10'), 225, 5, 253),
        ],
        { tags: ['Push'] },
      ),
      exercise('ex2', 'Squat', [set('b1', day('2026-01-05'), 315, 5, 354)], { tags: ['Legs'] }),
    ]

    it('counts distinct training days, sets, reps and exercises', () => {
      const recap = buildYearRecap({ year: 2026, exercises })!

      expect(recap.year).toBe(2026)
      expect(recap.workouts).toBe(2)
      expect(recap.sets).toBe(4)
      expect(recap.reps).toBe(20)
      expect(recap.exercises).toBe(2)
    })

    it('sums volume across every exercise', () => {
      const recap = buildYearRecap({ year: 2026, exercises })!
      expect(recap.totalVolume).toBe((185 + 205 + 225 + 315) * 5)
    })

    it('picks the heaviest set of the year by e1RM as the top lift', () => {
      const recap = buildYearRecap({ year: 2026, exercises })!
      expect(recap.topLift).toEqual({
        exerciseId: 'ex2',
        name: 'Squat',
        load: '315 lbs',
        reps: 5,
        e1RM: 354,
      })
    })

    it('names the most-trained tag by set count', () => {
      const recap = buildYearRecap({ year: 2026, exercises })!
      expect(recap.mostTrained).toEqual({ kind: 'tag', name: 'Push', sets: 3 })
    })
  })

  describe('year scoping', () => {
    const exercises = [
      exercise('ex1', 'Bench Press', [
        set('prev', day('2025-11-02'), 185, 5, 208),
        set('cur', day('2026-02-02'), 205, 5, 230),
        set('next', day('2027-01-04'), 225, 5, 253),
      ]),
    ]

    it('counts only the sets logged in the requested year', () => {
      const recap = buildYearRecap({ year: 2026, exercises })!
      expect(recap.sets).toBe(1)
      expect(recap.totalVolume).toBe(205 * 5)
      expect(recap.topLift?.load).toBe('205 lbs')
    })

    it('recaps an earlier year from the same data', () => {
      const recap = buildYearRecap({ year: 2025, exercises })!
      expect(recap.year).toBe(2025)
      expect(recap.sets).toBe(1)
      expect(recap.totalVolume).toBe(185 * 5)
    })

    it('returns null for a year with nothing logged in it', () => {
      expect(buildYearRecap({ year: 2024, exercises })).toBeNull()
      expect(buildYearRecap({ year: 2026, exercises: [] })).toBeNull()
    })

    it('ignores an exercise whose sets all fall outside the year', () => {
      // Deadlift out-trains Bench three to one — but in the WRONG year, so it
      // must count for neither the exercise total nor the most-trained tally.
      const recap = buildYearRecap({
        year: 2026,
        exercises: [
          ...exercises,
          exercise('ex2', 'Deadlift', [
            set('d1', day('2025-06-01'), 405, 3, 445),
            set('d2', day('2025-06-08'), 405, 3, 445),
            set('d3', day('2025-06-15'), 405, 3, 445),
          ]),
        ],
      })!
      expect(recap.exercises).toBe(1)
      expect(recap.mostTrained).toEqual({ kind: 'exercise', name: 'Bench Press', sets: 1 })
    })
  })

  describe('PR days', () => {
    it('counts one PR per exercise per day, never the exercise’s first day', () => {
      const recap = buildYearRecap({
        year: 2026,
        exercises: [
          exercise('ex1', 'Bench Press', [
            // First day ever: a best, but nothing to beat — the `new_exercise`
            // zone, matching scoreSet and the session summary.
            set('a1', day('2026-01-05'), 185, 5, 208),
            // One day, three sets past the old best → still one PR.
            set('a2', day('2026-01-12'), 195, 5, 219),
            set('a3', day('2026-01-12'), 205, 5, 230),
            set('a4', day('2026-01-12'), 215, 5, 242),
            // Below the best → not a PR day.
            set('a5', day('2026-01-19'), 185, 5, 208),
          ]),
        ],
      })!

      expect(recap.prs).toBe(1)
    })

    it('counts a day that beats LAST year’s best', () => {
      const recap = buildYearRecap({
        year: 2026,
        exercises: [
          exercise('ex1', 'Bench Press', [
            set('p1', day('2025-12-01'), 185, 5, 208),
            set('a1', day('2026-01-05'), 225, 5, 253),
          ]),
        ],
      })!

      expect(recap.prs).toBe(1)
    })

    it('does not credit this year for a PR set in another year', () => {
      const recap = buildYearRecap({
        year: 2026,
        exercises: [
          exercise('ex1', 'Bench Press', [
            set('p1', day('2025-12-01'), 185, 5, 208),
            set('p2', day('2025-12-08'), 225, 5, 253), // the PR, in 2025
            set('a1', day('2026-01-05'), 185, 5, 208),
          ]),
        ],
      })!

      expect(recap.prs).toBe(0)
    })
  })

  describe('longest week streak', () => {
    it('counts the longest run of consecutive weeks holding a session', () => {
      const recap = buildYearRecap({
        year: 2026,
        exercises: [
          exercise('ex1', 'Bench Press', [
            // Mondays: three in a row, a skipped week, then two in a row.
            set('a1', day('2026-01-05'), 185, 5, 208),
            set('a2', day('2026-01-12'), 185, 5, 208),
            set('a3', day('2026-01-14'), 185, 5, 208), // same week as a2
            set('a4', day('2026-01-19'), 185, 5, 208),
            set('a5', day('2026-02-02'), 185, 5, 208),
            set('a6', day('2026-02-09'), 185, 5, 208),
          ]),
        ],
      })!

      expect(recap.longestStreakWeeks).toBe(3)
    })

    it('is 1 for a single training day', () => {
      const recap = buildYearRecap({
        year: 2026,
        exercises: [exercise('ex1', 'Bench', [set('a1', day('2026-01-05'), 185, 5, 208)])],
      })!
      expect(recap.longestStreakWeeks).toBe(1)
    })
  })

  describe('most trained', () => {
    it('falls back to the most-logged exercise when nothing is tagged', () => {
      const recap = buildYearRecap({
        year: 2026,
        exercises: [
          exercise('ex1', 'Bench Press', [
            set('a1', day('2026-01-05'), 185, 5, 208),
            set('a2', day('2026-01-05'), 185, 5, 208),
          ]),
          exercise('ex2', 'Squat', [set('b1', day('2026-01-05'), 315, 5, 354)]),
        ],
      })!

      expect(recap.mostTrained).toEqual({ kind: 'exercise', name: 'Bench Press', sets: 2 })
    })

    it('breaks a tie alphabetically so the same data always makes the same card', () => {
      const recap = buildYearRecap({
        year: 2026,
        exercises: [
          exercise('ex1', 'Bench Press', [set('a1', day('2026-01-05'), 185, 5, 208)], {
            tags: ['Push', 'Chest'],
          }),
        ],
      })!

      expect(recap.mostTrained).toEqual({ kind: 'tag', name: 'Chest', sets: 1 })
    })
  })

  describe('display units', () => {
    it('converts volume and the top lift, and carries the unit label', () => {
      const recap = buildYearRecap({
        year: 2026,
        exercises: [exercise('ex1', 'Bench Press', [set('a1', day('2026-01-05'), 225, 5, 253)])],
        toDisplayUnits: KG,
        unitLabel: 'kg',
      })!

      expect(recap.unitLabel).toBe('kg')
      expect(recap.totalVolume).toBe(KG(225 * 5))
      expect(recap.topLift?.load).toBe(`${KG(225)} kg`)
      expect(recap.topLift?.e1RM).toBe(KG(253))
    })
  })

  describe('bodyweight-loaded exercises', () => {
    const pullups = exercise(
      'ex1',
      'Pull-up',
      [
        set('a1', day('2026-01-05'), 0, 12, 252, { bodyweight: 180 }),
        set('a2', day('2026-01-12'), 25, 8, 256, { bodyweight: 180 }),
      ],
      { bodyweightLoaded: true, tags: ['Pull'] },
    )

    it('folds bodyweight into volume rather than reporting a year of nothing', () => {
      const recap = buildYearRecap({ year: 2026, exercises: [pullups] })!
      expect(recap.totalVolume).toBe(180 * 12 + 205 * 8)
    })

    it('words a pure-bodyweight top lift as "Bodyweight", not "0 lbs"', () => {
      const recap = buildYearRecap({
        year: 2026,
        exercises: [exercise('ex1', 'Pull-up', [pullups.sets[0]], { bodyweightLoaded: true })],
      })!

      expect(recap.topLift?.load).toBe('Bodyweight')
      expect(recap.topLift?.e1RM).toBe(252)
    })

    it('marks an added load as added', () => {
      const recap = buildYearRecap({ year: 2026, exercises: [pullups] })!
      expect(recap.topLift?.load).toBe('+25 lbs')
    })

    it('keeps a set that folded nothing reading as the bare weight', () => {
      // Logged before the flag was turned on: no captured bodyweight, so the
      // stored e1RM is off the bare weight and the words must say so.
      const recap = buildYearRecap({
        year: 2026,
        exercises: [
          exercise('ex1', 'Pull-up', [set('a1', day('2026-01-05'), 0, 12, 0)], { bodyweightLoaded: true }),
        ],
      })!

      expect(recap.topLift?.load).toBe('0 lbs')
      expect(recap.totalVolume).toBe(0)
    })
  })

  // The year boundary is where a day-key mistake becomes a whole missing card.
  // Both conventions are tested on the side of UTC that exposes the wrong one.
  describe('timezone handling at the year boundary', () => {
    it('keeps a UI-logged New Year’s Eve set in its own year east of UTC', () => {
      withTZ('Asia/Tokyo', () => {
        // `…T23:59Z` on Dec 31 reads 08:59 on Jan 1 in JST, so a raw
        // `toLocalDateKey` would file this whole session under the next year.
        const exercises = [
          exercise('ex1', 'Bench Press', [set('a1', day('2026-12-31'), 225, 5, 253)]),
        ]

        expect(buildYearRecap({ year: 2026, exercises })?.sets).toBe(1)
        expect(buildYearRecap({ year: 2027, exercises })).toBeNull()
      })
    })

    it('keeps a real-time evening set in its own year west of UTC', () => {
      withTZ('America/Los_Angeles', () => {
        // 2026-12-31 18:00 PST — the UTC instant has already rolled into 2027,
        // so a blanket `slice(0, 10)` would credit the wrong year.
        const exercises = [
          exercise('ex1', 'Bench Press', [set('a1', '2027-01-01T02:00:00.000Z', 225, 5, 253)]),
        ]

        expect(buildYearRecap({ year: 2026, exercises })?.sets).toBe(1)
        expect(buildYearRecap({ year: 2027, exercises })).toBeNull()
      })
    })
  })
})
