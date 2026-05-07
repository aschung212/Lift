import { describe, it, expect } from 'vitest'
import {
  buildTrainingReport,
  lastNDaysPeriod,
  monthPeriod,
  type ReportPeriod,
} from '../trainingReport'
import { renderTrainingReportHtml } from '../trainingReportHtml'
import type { Exercise } from '../../stores/workout'

// ── Fixtures ──────────────────────────────────────────────────────

function makeExercise(overrides: Partial<Exercise> & { name: string }): Exercise {
  return {
    id: overrides.id ?? overrides.name.toLowerCase().replace(/\s/g, '-'),
    tags: [],
    sets: [],
    ...overrides,
  }
}

const benchPress = makeExercise({
  name: 'Bench Press',
  tags: ['chest', 'push'],
  sets: [
    { id: 's1', date: '2026-04-01T10:00:00.000Z', weight: 200, reps: 5, estimated1RM: 233 },
    { id: 's2', date: '2026-04-05T10:00:00.000Z', weight: 205, reps: 5, estimated1RM: 239 },
    { id: 's3', date: '2026-04-10T10:00:00.000Z', weight: 210, reps: 5, estimated1RM: 245 },
    { id: 's4', date: '2026-04-15T10:00:00.000Z', weight: 215, reps: 5, estimated1RM: 251 },
  ],
})

const squat = makeExercise({
  name: 'Squat',
  tags: ['legs', 'push'],
  sets: [
    { id: 's5', date: '2026-04-02T10:00:00.000Z', weight: 300, reps: 3, estimated1RM: 330 },
    { id: 's6', date: '2026-04-08T10:00:00.000Z', weight: 305, reps: 3, estimated1RM: 336 },
  ],
})

const deadlift = makeExercise({
  name: 'Deadlift',
  tags: ['back', 'pull'],
  sets: [
    { id: 's7', date: '2026-03-15T10:00:00.000Z', weight: 350, reps: 3, estimated1RM: 385 },
    { id: 's8', date: '2026-04-20T10:00:00.000Z', weight: 355, reps: 3, estimated1RM: 391 },
  ],
})

const bodyweight = [
  { date: '2026-04-01T08:00:00.000Z', weight: 185 },
  { date: '2026-04-15T08:00:00.000Z', weight: 183 },
  { date: '2026-04-30T08:00:00.000Z', weight: 182 },
]

const APRIL_2026: ReportPeriod = { label: 'April 2026', startDate: '2026-04-01', endDate: '2026-04-30' }

// ── Period helpers ────────────────────────────────────────────────

describe('lastNDaysPeriod', () => {
  it('computes a 30-day period ending on the given date', () => {
    const p = lastNDaysPeriod(30, '2026-04-30')
    expect(p.startDate).toBe('2026-04-01')
    expect(p.endDate).toBe('2026-04-30')
    expect(p.label).toBe('Last 30 days')
  })

  it('computes a 90-day period', () => {
    const p = lastNDaysPeriod(90, '2026-04-30')
    expect(p.startDate).toBe('2026-01-31')
    expect(p.endDate).toBe('2026-04-30')
  })
})

describe('monthPeriod', () => {
  it('returns correct start and end for April 2026', () => {
    const p = monthPeriod(2026, 4)
    expect(p.startDate).toBe('2026-04-01')
    expect(p.endDate).toBe('2026-04-30')
    expect(p.label).toBe('April 2026')
  })

  it('handles February in a non-leap year', () => {
    const p = monthPeriod(2027, 2)
    expect(p.endDate).toBe('2027-02-28')
  })

  it('handles February in a leap year', () => {
    const p = monthPeriod(2028, 2)
    expect(p.endDate).toBe('2028-02-29')
  })
})

// ── Report building ──────────────────────────────────────────────

describe('buildTrainingReport', () => {
  const report = buildTrainingReport(
    APRIL_2026,
    [benchPress, squat, deadlift],
    bodyweight,
  )

  describe('summary', () => {
    it('counts unique workout days', () => {
      // Bench: 4/1, 4/5, 4/10, 4/15; Squat: 4/2, 4/8; Deadlift: 4/20
      expect(report.summary.totalWorkouts).toBe(7)
      expect(report.summary.activeDays).toBe(7)
    })

    it('counts total sets in period', () => {
      // Bench: 4, Squat: 2, Deadlift: 1 (4/20 only — 3/15 is outside April)
      expect(report.summary.totalSets).toBe(7)
    })

    it('counts unique exercises', () => {
      expect(report.summary.uniqueExercises).toBe(3)
    })

    it('computes total volume', () => {
      // Bench: 200*5 + 205*5 + 210*5 + 215*5 = 4150
      // Squat: 300*3 + 305*3 = 1815
      // Deadlift: 355*3 = 1065
      expect(report.summary.totalVolume).toBe(4150 + 1815 + 1065)
    })

    it('counts PRs (exercises that beat their pre-period best)', () => {
      // Deadlift had a set on 3/15 (e1RM=385), and 4/20 (e1RM=391) > 385 → PR
      // Bench and Squat have no sets before April → no "prior" to beat
      expect(report.summary.prsHit).toBe(1)
    })

    it('computes consistency as percentage of weeks', () => {
      expect(report.summary.consistency).toBeGreaterThan(0)
      expect(report.summary.consistency).toBeLessThanOrEqual(100)
    })
  })

  describe('exercises', () => {
    it('returns exercise reports sorted by most sets', () => {
      expect(report.exercises[0].name).toBe('Bench Press')
      expect(report.exercises[0].totalSets).toBe(4)
    })

    it('includes timeline with best e1RM per date', () => {
      const bench = report.exercises.find(e => e.name === 'Bench Press')!
      expect(bench.timeline).toHaveLength(4)
      expect(bench.timeline[0]).toEqual({
        date: '2026-04-01', e1rm: 233, weight: 200, reps: 5,
      })
    })

    it('computes e1RM delta between first and last session', () => {
      const bench = report.exercises.find(e => e.name === 'Bench Press')!
      expect(bench.e1rmDelta).toBe(251 - 233) // 18
    })

    it('returns null e1rmDelta for exercises with only one session in period', () => {
      const dl = report.exercises.find(e => e.name === 'Deadlift')!
      expect(dl.e1rmDelta).toBeNull()
    })

    it('includes tags', () => {
      const bench = report.exercises.find(e => e.name === 'Bench Press')!
      expect(bench.tags).toEqual(['chest', 'push'])
    })
  })

  describe('tagVolume', () => {
    it('aggregates sets by tag', () => {
      const push = report.tagVolume.find(t => t.tag === 'push')!
      // Bench (4 sets) + Squat (2 sets) both tagged 'push'
      expect(push.totalSets).toBe(6)
    })

    it('counts exercises per tag', () => {
      const push = report.tagVolume.find(t => t.tag === 'push')!
      expect(push.exerciseCount).toBe(2)
    })

    it('is sorted by totalSets descending', () => {
      for (let i = 1; i < report.tagVolume.length; i++) {
        expect(report.tagVolume[i].totalSets).toBeLessThanOrEqual(report.tagVolume[i - 1].totalSets)
      }
    })
  })

  describe('bodyweight', () => {
    it('includes bodyweight entries within the period', () => {
      expect(report.bodyweight.entries).toHaveLength(3)
    })

    it('computes start/end weights', () => {
      expect(report.bodyweight.startWeight).toBe(185)
      expect(report.bodyweight.endWeight).toBe(182)
    })

    it('computes delta', () => {
      expect(report.bodyweight.delta).toBe(-3)
    })
  })

  describe('edge cases', () => {
    it('handles empty data gracefully', () => {
      const empty = buildTrainingReport(APRIL_2026, [], [])
      expect(empty.summary.totalWorkouts).toBe(0)
      expect(empty.summary.totalSets).toBe(0)
      expect(empty.exercises).toHaveLength(0)
      expect(empty.tagVolume).toHaveLength(0)
      expect(empty.bodyweight.entries).toHaveLength(0)
      expect(empty.bodyweight.delta).toBeNull()
    })

    it('excludes sets outside the period', () => {
      const report = buildTrainingReport(
        { label: 'Early April', startDate: '2026-04-01', endDate: '2026-04-05' },
        [benchPress],
        [],
      )
      expect(report.summary.totalSets).toBe(2) // only 4/1 and 4/5
    })
  })
})

// ── HTML rendering ───────────────────────────────────────────────

describe('renderTrainingReportHtml', () => {
  const report = buildTrainingReport(APRIL_2026, [benchPress, squat], bodyweight)

  it('produces a valid HTML document', () => {
    const html = renderTrainingReportHtml(report)
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('</html>')
  })

  it('includes the period label in the title', () => {
    const html = renderTrainingReportHtml(report)
    expect(html).toContain('April 2026')
  })

  it('includes summary stats', () => {
    const html = renderTrainingReportHtml(report)
    expect(html).toContain('Workouts')
    expect(html).toContain('Sets')
    expect(html).toContain('Volume')
    expect(html).toContain('Consistency')
  })

  it('includes exercise names', () => {
    const html = renderTrainingReportHtml(report)
    expect(html).toContain('Bench Press')
    expect(html).toContain('Squat')
  })

  it('includes SVG sparklines for exercises with 2+ sessions', () => {
    const html = renderTrainingReportHtml(report)
    expect(html).toContain('<svg')
    expect(html).toContain('polyline')
  })

  it('respects kg weight unit', () => {
    const html = renderTrainingReportHtml(report, { weightUnit: 'kg' })
    expect(html).toContain('kg')
  })

  it('escapes HTML in exercise names', () => {
    const xssExercise = makeExercise({
      name: '<script>alert("xss")</script>',
      sets: [{ id: 'x1', date: '2026-04-05T10:00:00.000Z', weight: 100, reps: 5, estimated1RM: 117 }],
    })
    const xssReport = buildTrainingReport(APRIL_2026, [xssExercise], [])
    const html = renderTrainingReportHtml(xssReport)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('escapes HTML in tag names (volume section)', () => {
    const xssTagExercise = makeExercise({
      name: 'Curl',
      tags: ['<img src=x onerror=alert(1)>'],
      sets: [{ id: 'x2', date: '2026-04-05T10:00:00.000Z', weight: 50, reps: 10, estimated1RM: 67 }],
    })
    const xssReport = buildTrainingReport(APRIL_2026, [xssTagExercise], [])
    const html = renderTrainingReportHtml(xssReport)
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img')
  })

  it('includes print media query for page breaks', () => {
    const html = renderTrainingReportHtml(report)
    expect(html).toContain('@media print')
    expect(html).toContain('break-inside: avoid')
  })

  it('includes bodyweight data when available', () => {
    const html = renderTrainingReportHtml(report)
    expect(html).toContain('Bodyweight')
    expect(html).toContain('Start:')
    expect(html).toContain('End:')
  })

  it('does not include bodyweight section when no data', () => {
    const noBody = buildTrainingReport(APRIL_2026, [benchPress], [])
    const html = renderTrainingReportHtml(noBody)
    expect(html).not.toContain('Bodyweight')
  })

  it('includes the Lift branding in the footer', () => {
    const html = renderTrainingReportHtml(report)
    expect(html).toContain('Generated by Lift')
  })
})
