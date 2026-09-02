/**
 * #1293 — `weeklyGoal` and `trainingReport` bucket a stored `set.date` /
 * `entry.date` through `setDayKey` (#746), not a raw `toLocalDateKey` or a
 * raw `slice(0, 10)`.
 *
 * The app writes dates in TWO conventions and CLAUDE.md names `setDayKey` as
 * the single reconciliation point:
 *   - **endOfDayISO stamps** (`…T23:59:ssZ`) — every UI-logged set and
 *     bodyweight entry — carry the user's chosen LOCAL day in the prefix.
 *     A raw `toLocalDateKey` shifts them +1 day for every user east of UTC.
 *   - **real UTC instants** — `logSet`'s no-date fallback, legacy/imported
 *     rows — where a raw `slice(0, 10)` rolls an Americas evening forward.
 *
 * Both zones are covered deliberately: the east-of-UTC cases are the bug being
 * fixed, and the west-of-UTC cases exist so a future "fix" cannot swing to a
 * blanket `slice(0, 10)` and regress the other convention.
 *
 * These tests force a non-UTC process timezone because CI runs UTC, where both
 * derivations agree — which is exactly why `weeklyGoal.test.ts` (whose fixtures
 * are all local-naive stamps) and `trainingReport.test.ts` never caught this.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { computeWeeklyGoal } from '../weeklyGoal'
import { buildTrainingReport, type ReportInput } from '../trainingReport'
import type { Exercise } from '../../stores/workout'
import type { BodyweightEntry } from '../../stores/bodyweight'

afterEach(() => {
  vi.useRealTimers()
})

/** Same helper as `dates.test.ts` — Node honors a runtime `process.env.TZ` swap. */
function withTZ(tz: string, fn: () => void) {
  const prev = process.env.TZ
  process.env.TZ = tz
  try {
    fn()
  } finally {
    process.env.TZ = prev
  }
}

/** `endOfDayISO(day)`'s shape: the prefix IS the user's chosen local day. */
function endOfDay(day: string): string {
  return `${day}T23:59:07.123Z`
}

function makeExercise(
  sets: { date: string; e1RM?: number }[],
  id = 'ex-1',
  tags: string[] = ['Push'],
): Exercise {
  return {
    id,
    name: 'Bench Press',
    tags,
    sets: sets.map((s, i) => ({
      id: `${id}-s${i}`,
      date: s.date,
      weight: 225,
      reps: 5,
      estimated1RM: s.e1RM ?? 250,
    })),
  }
}

function makeBW(date: string, weight: number): BodyweightEntry {
  return { id: `bw-${date}`, date, weight }
}

// ── computeWeeklyGoal ────────────────────────────────────────────

describe('computeWeeklyGoal day bucketing (#1293)', () => {
  // Sunday 2026-04-26 20:00 — the last day of the Mon Apr 20 – Sun Apr 26 week.
  const sundayEvening = '2026-04-26T20:00:00'

  it('counts TODAY east of UTC, where an endOfDayISO stamp keys to tomorrow', () => {
    withTZ('Asia/Tokyo', () => {
      const ex = makeExercise([
        { date: endOfDay('2026-04-25') }, // Saturday
        { date: endOfDay('2026-04-26') }, // Sunday — the day being trained
      ])
      const result = computeWeeklyGoal([ex], 3, new Date(sundayEvening))

      // A raw toLocalDateKey reads `…T23:59Z` as 08:59 the NEXT morning in JST,
      // pushing Sunday's sets past `endOfToday` — they are dropped for good.
      expect(result.trained).toBe(2)
    })
  })

  it('does not raise a false "streak at risk" alarm on a week that is on track', () => {
    withTZ('Asia/Tokyo', () => {
      const ex = makeExercise([
        { date: endOfDay('2026-04-25') },
        { date: endOfDay('2026-04-26') },
      ])
      // target 3, trained 2, 1 day left (Sunday) → needed 1 is coverable.
      const result = computeWeeklyGoal([ex], 3, new Date(sundayEvening))
      expect(result.atRisk).toBe(false)
    })
  })

  it('keeps the first day of the week inside the window east of UTC', () => {
    withTZ('Asia/Tokyo', () => {
      // Monday's endOfDayISO stamp is the week's opening day; a raw derivation
      // would move it to Tuesday, which is still in-window (silent), so pair it
      // with the previous Sunday, which a raw derivation drags INTO this week.
      const ex = makeExercise([
        { date: endOfDay('2026-04-19') }, // previous Sunday — must NOT count
        { date: endOfDay('2026-04-20') }, // this Monday
      ])
      const result = computeWeeklyGoal([ex], 3, new Date(sundayEvening))
      expect(result.trained).toBe(1)
    })
  })

  it('still counts a real-time evening instant on its LOCAL day west of UTC', () => {
    withTZ('America/Los_Angeles', () => {
      // 2026-04-26 19:00 PDT — the UTC instant has already rolled to the 27th,
      // so a blanket slice(0, 10) would push it past `endOfToday` and drop it.
      const ex = makeExercise([{ date: '2026-04-27T02:00:00.000Z' }])
      const result = computeWeeklyGoal([ex], 3, new Date(sundayEvening))
      expect(result.trained).toBe(1)
    })
  })

  it('merges both conventions onto one day count', () => {
    withTZ('America/Los_Angeles', () => {
      const ex = makeExercise([
        { date: endOfDay('2026-04-26') }, // UI-logged Sunday
        { date: '2026-04-27T02:00:00.000Z' }, // real-time Sunday evening
      ])
      const result = computeWeeklyGoal([ex], 3, new Date(sundayEvening))
      expect(result.trained).toBe(1)
    })
  })
})

// ── buildTrainingReport ──────────────────────────────────────────

const monthInput: ReportInput = {
  exercises: [],
  bodyweight: [],
  period: 'month',
  referenceDate: '2026-04-20',
}

describe('buildTrainingReport day bucketing (#1293)', () => {
  it('keeps a set logged on the last day of the period east of UTC', () => {
    withTZ('Asia/Tokyo', () => {
      const ex = makeExercise([
        { date: endOfDay('2026-04-15') },
        { date: endOfDay('2026-04-30') }, // last day of April
      ])
      const report = buildTrainingReport({ ...monthInput, exercises: [ex] })

      // A raw toLocalDateKey keys Apr 30 to May 1, outside `start..end`.
      expect(report.totalSets).toBe(2)
      expect(report.totalWorkoutDays).toBe(2)
      expect(report.totalVolume).toBe(2250)
    })
  })

  it('attributes each set to the right day in the e1RM timeline east of UTC', () => {
    withTZ('Asia/Tokyo', () => {
      const ex = makeExercise([
        { date: endOfDay('2026-04-10'), e1RM: 300 },
        { date: endOfDay('2026-04-17'), e1RM: 320 },
      ])
      const report = buildTrainingReport({ ...monthInput, exercises: [ex] })
      expect(report.exerciseProgressions[0].timeline.map(t => t.date)).toEqual([
        '2026-04-10',
        '2026-04-17',
      ])
    })
  })

  it('counts a set from the day BEFORE the period as prior history, not a PR', () => {
    withTZ('Asia/Tokyo', () => {
      const ex = makeExercise([
        { date: endOfDay('2026-03-31'), e1RM: 400 }, // last day of March
        { date: endOfDay('2026-04-10'), e1RM: 300 },
      ])
      const report = buildTrainingReport({ ...monthInput, exercises: [ex] })

      // Raw bucketing keys Mar 31 to Apr 1: it leaks into the period AND
      // vanishes from `priorSets`, so a 300 e1RM reads as an all-time PR.
      expect(report.totalSets).toBe(1)
      expect(report.prCount).toBe(0)
    })
  })

  it('buckets a Sunday set into its own week, not the next one', () => {
    withTZ('Asia/Tokyo', () => {
      const ex = makeExercise([{ date: endOfDay('2026-04-26') }]) // Sunday
      const report = buildTrainingReport({ ...monthInput, exercises: [ex] })

      const byWeek = new Map(report.weeklyConsistency.map(w => [w.weekStart, w]))
      expect(byWeek.get('2026-04-20')?.sets).toBe(1)
      expect(byWeek.get('2026-04-27')?.sets).toBe(0)
    })
  })

  it('keeps a real-time evening instant inside the period west of UTC', () => {
    withTZ('America/Los_Angeles', () => {
      // 2026-04-30 19:00 PDT — a blanket slice(0, 10) reads 2026-05-01.
      const ex = makeExercise([{ date: '2026-05-01T02:00:00.000Z' }])
      const report = buildTrainingReport({ ...monthInput, exercises: [ex] })
      expect(report.totalSets).toBe(1)
      expect(report.totalWorkoutDays).toBe(1)
    })
  })

  it('buckets bodyweight entries by the same rule as sets', () => {
    withTZ('America/Los_Angeles', () => {
      const report = buildTrainingReport({
        ...monthInput,
        bodyweight: [
          makeBW(endOfDay('2026-04-02'), 180), // UI-logged
          makeBW('2026-05-01T02:00:00.000Z', 176), // real-time Apr 30 evening
        ],
      })
      expect(report.bodyweight.timeline.map(t => t.date)).toEqual([
        '2026-04-02',
        '2026-04-30',
      ])
      expect(report.bodyweight.delta).toBe(-4)
    })
  })

  it('keeps an endOfDayISO bodyweight entry on its prefix day east of UTC', () => {
    withTZ('Asia/Tokyo', () => {
      const report = buildTrainingReport({
        ...monthInput,
        bodyweight: [makeBW(endOfDay('2026-04-30'), 176)],
      })
      expect(report.bodyweight.timeline.map(t => t.date)).toEqual(['2026-04-30'])
    })
  })

  it('defaults referenceDate to the LOCAL day, not the UTC day', () => {
    withTZ('America/Los_Angeles', () => {
      vi.useFakeTimers()
      // 2026-08-31 19:00 PDT — `toISOString().slice(0, 10)` reads 2026-09-01
      // and reports an empty September to a user still training in August.
      vi.setSystemTime(new Date('2026-09-01T02:00:00.000Z'))
      const report = buildTrainingReport({
        exercises: [],
        bodyweight: [],
        period: 'month',
      })
      expect(report.periodLabel).toBe('August 2026')
      expect(report.startDate).toBe('2026-08-01')
      expect(report.endDate).toBe('2026-08-31')
    })
  })
})
