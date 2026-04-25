import { describe, it, expect } from 'vitest'
import {
  buildSessionSummary,
  formatSessionDate,
  weekRange,
  formatDuration,
} from '../sessionSummary'
import type { Exercise } from '../../stores/workout'
import type { SetXPEntry } from '../../stores/progression'

function makeExercise(name: string, id: string, sets: { id: string; weight: number; reps: number; date: string }[]): Exercise {
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
})
