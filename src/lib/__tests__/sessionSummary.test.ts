import { describe, it, expect } from 'vitest'
import {
  buildSessionSummary,
  formatSessionDate,
  weekRange,
  formatDuration,
  formatSpanLabel,
} from '../sessionSummary'
import type { Exercise } from '../../stores/workout'
import type { SetXPEntry } from '../../stores/progression'

function makeExercise(
  name: string,
  id: string,
  sets: { id: string; weight: number; reps: number; date: string; createdAt?: string }[],
): Exercise {
  return {
    id,
    name,
    tags: [],
    sets: sets.map((s) => ({
      ...s,
      estimated1RM: s.reps === 1 ? Math.round(s.weight) : Math.round(s.weight * (1 + s.reps / 30)),
    })),
  }
}

/**
 * A set the way `logSet` actually writes one: `date` is the chosen calendar day
 * stamped end-of-day (`endOfDayISO`), and `createdAt` is the real instant it was
 * entered. `hhmm` is UTC and deliberately kept mid-afternoon so the instant lands
 * on `day` in every timezone the suite might run under (CI is UTC, Aaron's
 * machine is UTC-7/8) — vitest.config.js pins no TZ.
 */
function loggedSet(
  id: string,
  day: string,
  hhmm: string,
  extra: { weight?: number; reps?: number; createdAtDay?: string } = {},
) {
  return {
    id,
    weight: extra.weight ?? 225,
    reps: extra.reps ?? 5,
    date: `${day}T23:59:12.345Z`,
    createdAt: `${extra.createdAtDay ?? day}T${hhmm}:00.000Z`,
  }
}

function makeXPEntry(overrides: Partial<SetXPEntry> = {}): SetXPEntry {
  return { xp: 72, theme: 'fire', epoch: 1, zone: 'working', isPR: false, isRepPR: false, ...overrides }
}

describe('formatSessionDate', () => {
  it('formats a YYYY-MM-DD as "Tue, Apr 22" style', () => {
    // 2026-04-21 was a Tuesday
    expect(formatSessionDate('2026-04-21')).toBe('Tue, Apr 21')
  })

  it('returns the raw input when malformed', () => {
    expect(formatSessionDate('not-a-date')).toBe('not-a-date')
  })
})

describe('weekRange', () => {
  it('returns Mon→Sun for a Tuesday in the middle of a week', () => {
    // 2026-04-21 is a Tuesday, so the week is Mon 2026-04-20 → Sun 2026-04-26
    const wk = weekRange('2026-04-21')
    expect(wk).toEqual([
      '2026-04-20',
      '2026-04-21',
      '2026-04-22',
      '2026-04-23',
      '2026-04-24',
      '2026-04-25',
      '2026-04-26',
    ])
  })

  it('rolls back to Monday when given a Sunday', () => {
    // 2026-04-26 is a Sunday — week should be 2026-04-20..04-26
    const wk = weekRange('2026-04-26')
    expect(wk[0]).toBe('2026-04-20')
    expect(wk[6]).toBe('2026-04-26')
  })
})

describe('formatDuration', () => {
  it('renders sub-minute spans as <1m', () => {
    expect(formatDuration(30_000)).toBe('<1m')
  })

  it('renders minute-only spans without an hour', () => {
    expect(formatDuration(45 * 60_000)).toBe('45m')
  })

  it('renders hour+minute spans together', () => {
    expect(formatDuration(74 * 60_000)).toBe('1h 14m')
  })

  it('drops the trailing 0m on whole hours', () => {
    expect(formatDuration(2 * 3_600_000)).toBe('2h')
  })
})

describe('buildSessionSummary', () => {
  it('returns zeros when no sets exist for the date', () => {
    const summary = buildSessionSummary({
      rawDate: '2026-04-21',
      exercises: [],
    })
    expect(summary.totalVolume).toBe(0)
    expect(summary.setsCompleted).toBe(0)
    expect(summary.exercises).toBe(0)
    expect(summary.bestSet).toBeNull()
    expect(summary.highlights).toEqual([])
    expect(summary.prs).toBe(0)
    expect(summary.repPRs).toBe(0)
  })

  it('aggregates volume, set count, and exercise count for a single day', () => {
    const exercises = [
      makeExercise('Hack Squat', 'ex1', [
        { id: 's1', weight: 405, reps: 6, date: '2026-04-21T15:00:00Z' },
        { id: 's2', weight: 405, reps: 6, date: '2026-04-21T15:10:00Z' },
        { id: 's3', weight: 405, reps: 5, date: '2026-04-21T15:20:00Z' },
      ]),
      makeExercise('RDL', 'ex2', [
        { id: 's4', weight: 315, reps: 8, date: '2026-04-21T15:30:00Z' },
      ]),
      // Different day — must not contribute
      makeExercise('Bench', 'ex3', [
        { id: 's5', weight: 225, reps: 5, date: '2026-04-20T15:00:00Z' },
      ]),
    ]

    const summary = buildSessionSummary({ rawDate: '2026-04-21', exercises })
    expect(summary.setsCompleted).toBe(4)
    expect(summary.exercises).toBe(2)
    expect(summary.totalVolume).toBe(405 * 6 + 405 * 6 + 405 * 5 + 315 * 8) // 9405
  })

  it('detects an e1RM PR when today beats prior best', () => {
    const exercises = [
      makeExercise('Hack Squat', 'ex1', [
        // Prior days
        { id: 'p1', weight: 405, reps: 5, date: '2026-04-14T15:00:00Z' },
        // Today — beats prior best (505×6 e1RM = 606 vs prior 473)
        { id: 's1', weight: 505, reps: 6, date: '2026-04-21T15:00:00Z' },
      ]),
    ]
    const summary = buildSessionSummary({ rawDate: '2026-04-21', exercises })
    expect(summary.prs).toBe(1)
    expect(summary.bestSet?.isPR).toBe(true)
    expect(summary.highlights[0].badge).toBe('PR')
  })

  it('does not count a PR when today only ties prior best', () => {
    const exercises = [
      makeExercise('Bench', 'ex1', [
        { id: 'p1', weight: 225, reps: 5, date: '2026-04-14T15:00:00Z' }, // e1RM 263
        { id: 's1', weight: 225, reps: 5, date: '2026-04-21T15:00:00Z' }, // e1RM 263 again
      ]),
    ]
    const summary = buildSessionSummary({ rawDate: '2026-04-21', exercises })
    expect(summary.prs).toBe(0)
  })

  it('detects a rep PR (same weight, more reps than any prior session)', () => {
    const exercises = [
      makeExercise('Pull-Up', 'ex1', [
        // Prior best at bodyweight 0 lb load: 8 reps
        { id: 'p1', weight: 0, reps: 8, date: '2026-04-14T15:00:00Z' },
        // Today: 10 reps at the same load — that's a rep PR
        { id: 's1', weight: 0, reps: 10, date: '2026-04-21T15:00:00Z' },
      ]),
    ]
    const summary = buildSessionSummary({ rawDate: '2026-04-21', exercises })
    expect(summary.repPRs).toBe(1)
  })

  it('dedupes PRs to one per exercise even when multiple sets beat prior best', () => {
    const exercises = [
      makeExercise('Hack Squat', 'ex1', [
        { id: 'p1', weight: 405, reps: 5, date: '2026-04-14T15:00:00Z' }, // prior e1RM 473
        // Two PR-setting sets today
        { id: 's1', weight: 505, reps: 6, date: '2026-04-21T15:00:00Z' }, // 606
        { id: 's2', weight: 515, reps: 5, date: '2026-04-21T15:10:00Z' }, // 601
      ]),
    ]
    const summary = buildSessionSummary({ rawDate: '2026-04-21', exercises })
    expect(summary.prs).toBe(1) // single exercise PR'd, not two
  })

  it('ranks highlights by volume descending', () => {
    const exercises = [
      makeExercise('Leg Curl', 'ex1', [
        { id: 's1', weight: 145, reps: 12, date: '2026-04-21T15:00:00Z' }, // 1740
      ]),
      makeExercise('Hack Squat', 'ex2', [
        { id: 's2', weight: 405, reps: 6, date: '2026-04-21T15:10:00Z' }, // 2430
        { id: 's3', weight: 405, reps: 6, date: '2026-04-21T15:20:00Z' }, // 2430
      ]),
    ]
    const summary = buildSessionSummary({ rawDate: '2026-04-21', exercises })
    expect(summary.highlights[0].name).toBe('Hack Squat')
    expect(summary.highlights[1].name).toBe('Leg Curl')
  })

  it('picks the highest e1RM set as the best set', () => {
    const exercises = [
      makeExercise('Bench', 'ex1', [
        { id: 's1', weight: 225, reps: 5, date: '2026-04-21T15:00:00Z' }, // e1RM 263
        { id: 's2', weight: 245, reps: 3, date: '2026-04-21T15:10:00Z' }, // e1RM 270
      ]),
    ]
    const summary = buildSessionSummary({ rawDate: '2026-04-21', exercises })
    expect(summary.bestSet?.weight).toBe(245)
    expect(summary.bestSet?.reps).toBe(3)
  })

  it('uses xpPerSet flags when supplied (over derived detection)', () => {
    const exercises = [
      makeExercise('Squat', 'ex1', [
        // No prior sets — derived detection would NOT flag PR (priorMaxE1RM is null)
        { id: 's1', weight: 405, reps: 6, date: '2026-04-21T15:00:00Z' },
      ]),
    ]
    const xpPerSet: Record<string, SetXPEntry> = {
      s1: makeXPEntry({ isPR: true }),
    }
    const summary = buildSessionSummary({ rawDate: '2026-04-21', exercises, xpPerSet })
    expect(summary.prs).toBe(1)
    expect(summary.bestSet?.isPR).toBe(true)
  })

  it('derives duration from first→last real-time timestamp', () => {
    const exercises = [
      makeExercise('Bench', 'ex1', [
        { id: 's1', weight: 225, reps: 5, date: '2026-04-21T14:00:00Z' },
        { id: 's2', weight: 225, reps: 5, date: '2026-04-21T14:15:00Z' },
        { id: 's3', weight: 225, reps: 5, date: '2026-04-21T14:30:00Z' },
      ]),
    ]
    const summary = buildSessionSummary({ rawDate: '2026-04-21', exercises })
    expect(summary.duration).toBe('30m')
  })

  it('ignores end-of-day jitter sets when mixed with real-time sets (does not inflate)', () => {
    // Regression: a user logs three real-time sets in a 30-minute window, then
    // adds one bulk-imported set later. The bulk-add lands at 23:59Z. If we
    // include it in the duration max, the span jumps to ~10 hours instead of 30m.
    const exercises = [
      makeExercise('Bench', 'ex1', [
        { id: 's1', weight: 225, reps: 5, date: '2026-04-21T14:00:00Z' },
        { id: 's2', weight: 225, reps: 5, date: '2026-04-21T14:15:00Z' },
        { id: 's3', weight: 225, reps: 5, date: '2026-04-21T14:30:00Z' },
        { id: 's4', weight: 225, reps: 5, date: '2026-04-21T23:59:33.789Z' }, // bulk-add
      ]),
    ]
    const summary = buildSessionSummary({ rawDate: '2026-04-21', exercises })
    expect(summary.duration).toBe('30m')
  })

  it('reports duration as — when every set is in the end-of-day jitter window', () => {
    const exercises = [
      makeExercise('Bulk-Add', 'ex1', [
        { id: 's1', weight: 225, reps: 5, date: '2026-04-21T23:59:12.345Z' },
        { id: 's2', weight: 225, reps: 5, date: '2026-04-21T23:59:33.789Z' },
      ]),
    ]
    const summary = buildSessionSummary({ rawDate: '2026-04-21', exercises })
    expect(summary.duration).toBe('—')
  })

  // #1288 — duration read from `createdAt`.
  //
  // Every set logged through the UI is written with `endOfDayISO(day)`, so the
  // pre-#1288 derivation (which only ever looked at `date`) skipped all of them
  // as jitter and reported '—' for literally every session. The real log instant
  // was sitting on `createdAt` the whole time, unread since #846 populated it.
  describe('duration from createdAt (#1288)', () => {
    it('spans a UI-logged session, whose date stamps are all end-of-day', () => {
      const exercises = [
        makeExercise('Bench', 'ex1', [
          loggedSet('s1', '2026-04-21', '14:00'),
          loggedSet('s2', '2026-04-21', '14:20'),
        ]),
        makeExercise('Row', 'ex2', [loggedSet('s3', '2026-04-21', '14:45')]),
      ]
      const summary = buildSessionSummary({ rawDate: '2026-04-21', exercises })
      expect(summary.duration).toBe('45m')
    })

    it('excludes a set back-dated onto the day from another day', () => {
      // The user trained Tuesday for 30m, then on Friday remembered a fourth set
      // and added it with the date picker set back to Tuesday. Its `createdAt` is
      // Friday. Folding that into the max reports the Tuesday session as '3d 6h'.
      const exercises = [
        makeExercise('Bench', 'ex1', [
          loggedSet('s1', '2026-04-21', '14:00'),
          loggedSet('s2', '2026-04-21', '14:30'),
          loggedSet('s3', '2026-04-21', '15:00', { createdAtDay: '2026-04-24' }),
        ]),
      ]
      const summary = buildSessionSummary({ rawDate: '2026-04-21', exercises })
      expect(summary.duration).toBe('30m')
    })

    it('reports — when every set on the day was back-dated from elsewhere', () => {
      const exercises = [
        makeExercise('Bench', 'ex1', [
          loggedSet('s1', '2026-04-21', '14:00', { createdAtDay: '2026-04-24' }),
          loggedSet('s2', '2026-04-21', '15:00', { createdAtDay: '2026-04-24' }),
        ]),
      ]
      const summary = buildSessionSummary({ rawDate: '2026-04-21', exercises })
      expect(summary.duration).toBe('—')
    })

    it('mixes a legacy set with no createdAt into the same span', () => {
      // Pre-#846 sets kept a real-time `date` on the no-date path. They still
      // count, so a history that straddles #846 does not lose its early span.
      const exercises = [
        makeExercise('Bench', 'ex1', [
          { id: 's1', weight: 225, reps: 5, date: '2026-04-21T14:00:00.000Z' },
          loggedSet('s2', '2026-04-21', '14:50'),
        ]),
      ]
      const summary = buildSessionSummary({ rawDate: '2026-04-21', exercises })
      expect(summary.duration).toBe('50m')
    })

    it('ignores an unparseable createdAt rather than reporting NaN', () => {
      const exercises = [
        makeExercise('Bench', 'ex1', [
          { id: 's1', weight: 225, reps: 5, date: '2026-04-21T23:59:12.345Z', createdAt: 'not-a-date' },
          loggedSet('s2', '2026-04-21', '14:00'),
        ]),
      ]
      const summary = buildSessionSummary({ rawDate: '2026-04-21', exercises })
      // One usable instant → '<1m', never 'NaN' or 'Infinityh'.
      expect(summary.duration).toBe('<1m')
    })
  })

  it('returns 7-entry weekVolume aggregating across all exercises', () => {
    const exercises = [
      makeExercise('Bench', 'ex1', [
        { id: 's1', weight: 100, reps: 10, date: '2026-04-20T15:00:00Z' }, // Mon 1000
        { id: 's2', weight: 100, reps: 10, date: '2026-04-21T15:00:00Z' }, // Tue 1000
      ]),
      makeExercise('Squat', 'ex2', [
        { id: 's3', weight: 200, reps: 5, date: '2026-04-21T16:00:00Z' }, // Tue +1000
        { id: 's4', weight: 200, reps: 5, date: '2026-04-23T15:00:00Z' }, // Thu 1000
      ]),
    ]
    const summary = buildSessionSummary({ rawDate: '2026-04-21', exercises })
    expect(summary.weekVolume).toEqual([1000, 2000, 0, 1000, 0, 0, 0])
  })

  it('passes streak through from input', () => {
    const summary = buildSessionSummary({ rawDate: '2026-04-21', exercises: [], streakWeeks: 7 })
    expect(summary.streak).toBe(7)
  })

  it('defaults to lbs and an identity converter', () => {
    const exercises = [
      makeExercise('Bench', 'ex1', [{ id: 's1', weight: 225, reps: 5, date: '2026-04-21T15:00:00Z' }]),
    ]
    const summary = buildSessionSummary({ rawDate: '2026-04-21', exercises })
    expect(summary.unitLabel).toBe('lbs')
    expect(summary.totalVolume).toBe(225 * 5)
    expect(summary.bestSet?.weight).toBe(225)
  })

  it('aggregates priorWeekVolume from the previous Mon→Sun week', () => {
    const exercises = [
      makeExercise('Bench', 'ex1', [
        // Prior week (Apr 13-19)
        { id: 'p1', weight: 100, reps: 10, date: '2026-04-13T15:00:00Z' }, // 1000
        { id: 'p2', weight: 200, reps: 5, date: '2026-04-15T15:00:00Z' },  // 1000
        { id: 'p3', weight: 150, reps: 4, date: '2026-04-19T15:00:00Z' },  // 600
        // Current week (Apr 20-26)
        { id: 'c1', weight: 100, reps: 10, date: '2026-04-21T15:00:00Z' }, // 1000
      ]),
    ]
    const summary = buildSessionSummary({ rawDate: '2026-04-21', exercises })
    expect(summary.priorWeekVolume).toBe(2600)
    expect(summary.weekVolume[1]).toBe(1000) // Tuesday Apr 21
  })

  it('routes weight fields through toDisplayUnits when supplied', () => {
    const exercises = [
      makeExercise('Bench', 'ex1', [{ id: 's1', weight: 225, reps: 5, date: '2026-04-21T15:00:00Z' }]),
    ]
    const summary = buildSessionSummary({
      rawDate: '2026-04-21',
      exercises,
      unitLabel: 'kg',
      toDisplayUnits: (lb) => +(lb * 0.453592).toFixed(1),
    })
    expect(summary.unitLabel).toBe('kg')
    expect(summary.bestSet?.weight).toBeCloseTo(102.1, 1)
    expect(summary.totalVolume).toBeCloseTo(510.3, 1)
  })

  // ── Bodyweight-loaded volume folding (LIFT-834) ──────────────────
  describe('bodyweight-loaded volume', () => {
    function bwExercise(sets: { id: string; weight: number; reps: number; date: string; bodyweight?: number }[]): Exercise {
      return {
        id: 'bw',
        name: 'Weighted Pull-up',
        tags: [],
        bodyweightLoaded: true,
        sets: sets.map((s) => ({ ...s, estimated1RM: 0 })),
      }
    }

    it('folds captured bodyweight into total + week volume', () => {
      const exercises = [
        bwExercise([{ id: 's1', weight: 25, reps: 8, date: '2026-04-21T15:00:00Z', bodyweight: 160 }]),
      ]
      const summary = buildSessionSummary({ rawDate: '2026-04-21', exercises })
      expect(summary.totalVolume).toBe(185 * 8) // (160 + 25) × 8, not 25 × 8
      expect(summary.weekVolume[1]).toBe(185 * 8) // Tuesday Apr 21
    })

    it('gives pure-bodyweight reps (added = 0) volume credit', () => {
      const exercises = [
        bwExercise([{ id: 's1', weight: 0, reps: 10, date: '2026-04-21T15:00:00Z', bodyweight: 170 }]),
      ]
      const summary = buildSessionSummary({ rawDate: '2026-04-21', exercises })
      expect(summary.totalVolume).toBe(170 * 10) // was 0 before the fold
    })

    it('does not fold when the flag is off, even if a bodyweight is present', () => {
      const exercises: Exercise[] = [
        {
          id: 'bw', name: 'Pull-up', tags: [], bodyweightLoaded: false,
          sets: [{ id: 's1', weight: 25, reps: 8, date: '2026-04-21T15:00:00Z', bodyweight: 160, estimated1RM: 0 }],
        },
      ]
      const summary = buildSessionSummary({ rawDate: '2026-04-21', exercises })
      expect(summary.totalVolume).toBe(25 * 8)
    })
  })
})

describe('formatSpanLabel', () => {
  it('renders short spans in weeks', () => {
    expect(formatSpanLabel(7)).toBe('1 week')
    expect(formatSpanLabel(14)).toBe('2 weeks')
    expect(formatSpanLabel(55)).toBe('8 weeks')
  })

  it('renders medium spans in months (floored at 2)', () => {
    expect(formatSpanLabel(56)).toBe('2 months')
    expect(formatSpanLabel(91)).toBe('3 months')
    expect(formatSpanLabel(365)).toBe('12 months')
  })

  it('renders long spans in years with one decimal', () => {
    expect(formatSpanLabel(548)).toBe('1.5 years')
    expect(formatSpanLabel(730)).toBe('2 years')
  })
})

describe('buildSessionSummary progress story (#1019)', () => {
  it('is null when the trained exercise has only one recorded day', () => {
    const exercises = [
      makeExercise('Bench', 'ex1', [
        { id: 's1', weight: 175, reps: 1, date: '2026-04-21T15:00:00Z' },
      ]),
    ]
    const summary = buildSessionSummary({ rawDate: '2026-04-21', exercises })
    expect(summary.progress).toBeNull()
  })

  it('builds a first-day → peak transformation for a trained exercise', () => {
    const exercises = [
      makeExercise('Bench', 'ex1', [
        { id: 'p1', weight: 135, reps: 1, date: '2026-01-20T15:00:00Z' }, // e1RM 135
        { id: 's1', weight: 175, reps: 1, date: '2026-04-21T15:00:00Z' }, // e1RM 175 (today, peak)
      ]),
    ]
    const summary = buildSessionSummary({ rawDate: '2026-04-21', exercises })
    expect(summary.progress).not.toBeNull()
    expect(summary.progress?.name).toBe('Bench')
    expect(summary.progress?.startE1RM).toBe(135)
    expect(summary.progress?.currentE1RM).toBe(175)
    expect(summary.progress?.delta).toBe(40)
    expect(summary.progress?.spanDays).toBe(91)
    expect(summary.progress?.spanLabel).toBe('3 months')
  })

  it('is null when the gain is below the meaningful threshold', () => {
    const exercises = [
      makeExercise('Bench', 'ex1', [
        { id: 'p1', weight: 135, reps: 1, date: '2026-01-20T15:00:00Z' },
        { id: 's1', weight: 138, reps: 1, date: '2026-04-21T15:00:00Z' }, // +3 lb only
      ]),
    ]
    const summary = buildSessionSummary({ rawDate: '2026-04-21', exercises })
    expect(summary.progress).toBeNull()
  })

  it('is null when the span is too short to read as a journey', () => {
    const exercises = [
      makeExercise('Bench', 'ex1', [
        { id: 'p1', weight: 135, reps: 1, date: '2026-04-10T15:00:00Z' },
        { id: 's1', weight: 175, reps: 1, date: '2026-04-21T15:00:00Z' }, // +40 lb but 11 days
      ]),
    ]
    const summary = buildSessionSummary({ rawDate: '2026-04-21', exercises })
    expect(summary.progress).toBeNull()
  })

  it('picks the biggest gainer among the exercises trained today', () => {
    const exercises = [
      makeExercise('Bench', 'ex1', [
        { id: 'b1', weight: 135, reps: 1, date: '2026-01-20T15:00:00Z' },
        { id: 'b2', weight: 175, reps: 1, date: '2026-04-21T15:00:00Z' }, // +40
      ]),
      makeExercise('Squat', 'ex2', [
        { id: 'q1', weight: 205, reps: 1, date: '2026-01-20T15:00:00Z' },
        { id: 'q2', weight: 315, reps: 1, date: '2026-04-21T15:00:00Z' }, // +110
      ]),
    ]
    const summary = buildSessionSummary({ rawDate: '2026-04-21', exercises })
    expect(summary.progress?.name).toBe('Squat')
    expect(summary.progress?.delta).toBe(110)
  })

  it('ignores an exercise not trained today even if its gain is larger', () => {
    const exercises = [
      // Huge gain, but the last set was days ago — not part of today's session.
      makeExercise('Deadlift', 'ex1', [
        { id: 'd1', weight: 135, reps: 1, date: '2026-01-20T15:00:00Z' },
        { id: 'd2', weight: 405, reps: 1, date: '2026-04-15T15:00:00Z' }, // +270, not today
      ]),
      makeExercise('Bench', 'ex2', [
        { id: 'b1', weight: 135, reps: 1, date: '2026-01-20T15:00:00Z' },
        { id: 'b2', weight: 175, reps: 1, date: '2026-04-21T15:00:00Z' }, // +40, today
      ]),
    ]
    const summary = buildSessionSummary({ rawDate: '2026-04-21', exercises })
    expect(summary.progress?.name).toBe('Bench')
    expect(summary.progress?.delta).toBe(40)
  })

  it('routes the progress e1RM values through toDisplayUnits', () => {
    const exercises = [
      makeExercise('Bench', 'ex1', [
        { id: 'p1', weight: 135, reps: 1, date: '2026-01-20T15:00:00Z' },
        { id: 's1', weight: 175, reps: 1, date: '2026-04-21T15:00:00Z' },
      ]),
    ]
    const summary = buildSessionSummary({
      rawDate: '2026-04-21',
      exercises,
      unitLabel: 'kg',
      toDisplayUnits: (lb) => +(lb * 0.453592).toFixed(1),
    })
    expect(summary.progress?.startE1RM).toBeCloseTo(61.2, 1)
    expect(summary.progress?.currentE1RM).toBeCloseTo(79.4, 1)
    expect(summary.progress?.delta).toBeCloseTo(18.2, 1)
  })
})
