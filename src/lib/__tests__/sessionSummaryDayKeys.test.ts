/**
 * #1291 — `buildSessionSummary` buckets `set.date` through `setDayKey` (#746),
 * not a raw `toLocalDateKey`.
 *
 * Set dates carry TWO storage conventions and CLAUDE.md names `setDayKey` as
 * the single reconciliation point:
 *   - endOfDayISO stamps (`…T23:59:ssZ`) — written by every UI-logged set —
 *     carry the user's chosen LOCAL day directly in the prefix. East of UTC a
 *     raw `toLocalDateKey` shifts them a day forward.
 *   - real UTC instants — `logSet`'s no-date fallback, legacy/imported rows —
 *     where only `toLocalDateKey` gives the right local day, and a blanket
 *     `slice(0, 10)` would roll an Americas evening forward instead.
 *
 * All four of the summary's bucketing sites used the raw derivation while
 * `rawDate` came in as a LOCAL day key (`todayISO()`), so east of UTC they
 * matched nothing: the Workout Complete screen rendered its empty branch and
 * all 11 share cards zeroed out on every session. Each test below isolates one
 * site, using a real-time stamp for "today" wherever the site under test is not
 * the today-filter itself so a single bug cannot mask another.
 *
 * The suite forces a non-UTC process timezone because CI runs UTC, where both
 * derivations agree — which is exactly why nothing here could fail before.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { buildSessionSummary } from '../sessionSummary'
import { getLocalStorageMock } from '../../__tests__/helpers'
import type { Exercise, WorkoutSet } from '../../stores/workout'

const localStorageMock = getLocalStorageMock()

vi.mock('../../lib/supabase', () => ({
  supabase: null,
  isPreviewMode: { value: false },
}))

vi.mock('../../lib/syncQueue', () => ({
  syncQueue: { enqueue: vi.fn(), enqueueDelete: vi.fn(), clear: vi.fn(), rehydrate: vi.fn() },
}))

vi.mock('../../lib/durableStorage', () => ({
  backupToIDB: vi.fn(),
}))

import { useWorkoutStore } from '../../stores/workout'

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

function set(id: string, date: string, weight: number, reps: number, estimated1RM: number): WorkoutSet {
  return { id, date, weight, reps, estimated1RM }
}

function exercise(id: string, name: string, sets: WorkoutSet[]): Exercise {
  return { id, name, tags: [], sets }
}

beforeEach(() => {
  localStorageMock.clear()
  vi.clearAllMocks()
  setActivePinia(createPinia())
})

describe('#1291 session summary day bucketing', () => {
  it('counts a UI-logged session on its own day east of UTC', () => {
    withTZ('Asia/Tokyo', () => {
      // Exactly what `logSet(id, w, r, '2026-04-21')` writes: endOfDayISO stamps
      // whose prefix IS the chosen local day. In JST these read 08:59 on the
      // 22nd, so the raw derivation filed the whole session under tomorrow and
      // the summary came back empty.
      const exercises = [
        exercise('ex1', 'Hack Squat', [
          set('s1', '2026-04-21T23:59:12.345Z', 405, 6, 486),
          set('s2', '2026-04-21T23:59:41.002Z', 405, 5, 473),
        ]),
      ]

      const summary = buildSessionSummary({ rawDate: '2026-04-21', exercises })
      expect(summary.setsCompleted).toBe(2)
      expect(summary.exercises).toBe(1)
      expect(summary.totalVolume).toBe(405 * 6 + 405 * 5)
      expect(summary.bestSet?.e1RM).toBe(486)
      expect(summary.highlights).toHaveLength(1)
    })
  })

  it('buckets a real-time evening stamp to the LOCAL day west of UTC', () => {
    withTZ('America/Los_Angeles', () => {
      // 2026-04-21 19:00 PDT — the UTC instant has already rolled to the 22nd,
      // so a blanket `slice(0, 10)` would drop this set from its own session.
      const exercises = [
        exercise('ex1', 'Bench', [set('s1', '2026-04-22T02:00:00.000Z', 225, 5, 263)]),
      ]

      const summary = buildSessionSummary({ rawDate: '2026-04-21', exercises })
      expect(summary.setsCompleted).toBe(1)
      expect(summary.bestSet?.weight).toBe(225)
    })
  })

  it('keeps yesterday out of today and inside the PR baseline east of UTC', () => {
    withTZ('Asia/Tokyo', () => {
      const exercises = [
        exercise('ex1', 'Hack Squat', [
          set('p1', '2026-04-20T23:59:10.000Z', 405, 5, 473), // UI-logged yesterday
          set('s1', '2026-04-21T01:00:00.000Z', 505, 6, 606), // real-time today
        ]),
      ]

      const summary = buildSessionSummary({ rawDate: '2026-04-21', exercises })
      // Raw bucketing put yesterday's endOfDayISO set on today (inflating the
      // count) AND out of `priorSets` (erasing the PR it should have beaten).
      expect(summary.setsCompleted).toBe(1)
      expect(summary.prs).toBe(1)
      expect(summary.bestSet?.isPR).toBe(true)
    })
  })

  it('assigns week and prior-week volume to the right buckets east of UTC', () => {
    withTZ('Asia/Tokyo', () => {
      // Week of rawDate is Mon 2026-04-20 → Sun 2026-04-26; the prior week is
      // Apr 13 → 19. Under the raw derivation the Sunday-before rolled INTO the
      // current week and the Sunday-after fell out of both, so the WeekChart's
      // delta compared the wrong two weeks.
      const exercises = [
        exercise('ex1', 'Bench', [
          set('a', '2026-04-19T23:59:10.000Z', 100, 10, 133), // prior week, Sun
          set('b', '2026-04-21T23:59:10.000Z', 100, 10, 133), // this week, Tue
          set('c', '2026-04-26T23:59:10.000Z', 100, 10, 133), // this week, Sun
        ]),
      ]

      const summary = buildSessionSummary({ rawDate: '2026-04-21', exercises })
      expect(summary.weekVolume).toEqual([0, 1000, 0, 0, 0, 0, 1000])
      expect(summary.priorWeekVolume).toBe(1000)
    })
  })

  it('dates the progress story from the true first day east of UTC', () => {
    withTZ('Asia/Tokyo', () => {
      // A mixed history — the shape real accounts have. The raw derivation
      // merged the UI-logged Jan 20 into the real-time Jan 21, moving the
      // story's starting point and shrinking the gain it reports.
      const exercises = [
        exercise('ex1', 'Bench', [
          set('p1', '2026-01-20T23:59:10.000Z', 135, 1, 135), // UI-logged, Jan 20
          set('p2', '2026-01-21T01:00:00.000Z', 140, 1, 140), // real-time, Jan 21
          set('s1', '2026-04-21T01:00:00.000Z', 175, 1, 175), // real-time, today
        ]),
      ]

      const summary = buildSessionSummary({ rawDate: '2026-04-21', exercises })
      expect(summary.progress?.startE1RM).toBe(135)
      expect(summary.progress?.currentE1RM).toBe(175)
      expect(summary.progress?.delta).toBe(40)
      expect(summary.progress?.spanDays).toBe(91)
    })
  })

  it('agrees with store.setsLoggedOn about how many sets a day holds', () => {
    withTZ('Asia/Tokyo', () => {
      // The contradiction users actually saw: WorkoutTracker offers "Finish
      // workout" off `setsLoggedOn(todayISO())`, then hands the same day key to
      // `buildSessionSummary`. The two must never disagree.
      const store = useWorkoutStore()
      const id = store.addExercise('Deadlift')!
      const day = '2026-04-21'
      store.logSet(id, 315, 5, day)
      store.logSet(id, 335, 3, day)
      store.logSet(id, 275, 5, '2026-04-20')

      const summary = buildSessionSummary({ rawDate: day, exercises: store.exercises })
      expect(store.setsLoggedOn(day)).toBe(2)
      expect(summary.setsCompleted).toBe(store.setsLoggedOn(day))
    })
  })
})
