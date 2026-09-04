import { describe, it, expect } from 'vitest'
import { buildTrainingReport, type ReportInput } from '../trainingReport'
import type { Exercise } from '../../stores/workout'
import type { BodyweightEntry } from '../../stores/bodyweight'

function makeExercise(
  name: string,
  tags: string[],
  sets: { date: string; weight: number; reps: number; estimated1RM: number; bodyweight?: number }[],
  bodyweightLoaded = false,
): Exercise {
  return {
    id: `ex-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    tags,
    ...(bodyweightLoaded ? { bodyweightLoaded: true } : {}),
    sets: sets.map((s, i) => ({ id: `set-${name}-${i}`, ...s })),
  }
}

function makeBW(date: string, weight: number): BodyweightEntry {
  return { id: `bw-${date}`, date: `${date}T23:59:00.000Z`, weight }
}

const baseInput: ReportInput = {
  exercises: [],
  bodyweight: [],
  period: 'month',
  referenceDate: '2026-04-15',
}

describe('buildTrainingReport', () => {
  describe('period boundaries', () => {
    it('computes monthly period label and bounds', () => {
      const report = buildTrainingReport({ ...baseInput, referenceDate: '2026-04-15' })
      expect(report.periodLabel).toBe('April 2026')
      expect(report.startDate).toBe('2026-04-01')
      expect(report.endDate).toBe('2026-04-30')
    })

    it('computes quarterly period label and bounds', () => {
      const report = buildTrainingReport({ ...baseInput, period: 'quarter', referenceDate: '2026-05-20' })
      expect(report.periodLabel).toBe('Q2 2026')
      expect(report.startDate).toBe('2026-04-01')
      expect(report.endDate).toBe('2026-06-30')
    })

    it('computes yearly period label and bounds', () => {
      const report = buildTrainingReport({ ...baseInput, period: 'year', referenceDate: '2026-08-01' })
      expect(report.periodLabel).toBe('2026')
      expect(report.startDate).toBe('2026-01-01')
      expect(report.endDate).toBe('2026-12-31')
    })

    it('handles Q1 correctly', () => {
      const report = buildTrainingReport({ ...baseInput, period: 'quarter', referenceDate: '2026-02-10' })
      expect(report.periodLabel).toBe('Q1 2026')
      expect(report.startDate).toBe('2026-01-01')
      expect(report.endDate).toBe('2026-03-31')
    })

    it('handles Q4 correctly', () => {
      const report = buildTrainingReport({ ...baseInput, period: 'quarter', referenceDate: '2026-12-01' })
      expect(report.periodLabel).toBe('Q4 2026')
      expect(report.startDate).toBe('2026-10-01')
      expect(report.endDate).toBe('2026-12-31')
    })
  })

  describe('summary stats', () => {
    it('counts workout days, sets, volume, and exercises', () => {
      const exercises = [
        makeExercise('Bench Press', ['chest'], [
          { date: '2026-04-05T10:00:00.000Z', weight: 225, reps: 5, estimated1RM: 253 },
          { date: '2026-04-05T10:05:00.000Z', weight: 225, reps: 5, estimated1RM: 253 },
          { date: '2026-04-07T10:00:00.000Z', weight: 230, reps: 3, estimated1RM: 253 },
        ]),
        makeExercise('Squat', ['legs'], [
          { date: '2026-04-05T11:00:00.000Z', weight: 315, reps: 5, estimated1RM: 368 },
        ]),
      ]

      const report = buildTrainingReport({ ...baseInput, exercises })
      expect(report.totalWorkoutDays).toBe(2) // Apr 5 and Apr 7
      expect(report.totalSets).toBe(4)
      expect(report.uniqueExercises).toBe(2)
      // Volume: 225*5 + 225*5 + 230*3 + 315*5 = 1125+1125+690+1575 = 4515
      expect(report.totalVolume).toBe(4515)
    })

    it('excludes sets outside the period', () => {
      const exercises = [
        makeExercise('Deadlift', ['back'], [
          { date: '2026-03-31T10:00:00.000Z', weight: 315, reps: 5, estimated1RM: 368 }, // March
          { date: '2026-04-01T10:00:00.000Z', weight: 315, reps: 5, estimated1RM: 368 }, // April
          { date: '2026-05-01T10:00:00.000Z', weight: 315, reps: 5, estimated1RM: 368 }, // May
        ]),
      ]

      const report = buildTrainingReport({ ...baseInput, exercises })
      expect(report.totalSets).toBe(1) // Only April set
    })

    it('returns zeros for empty data', () => {
      const report = buildTrainingReport(baseInput)
      expect(report.totalWorkoutDays).toBe(0)
      expect(report.totalSets).toBe(0)
      expect(report.totalVolume).toBe(0)
      expect(report.uniqueExercises).toBe(0)
      expect(report.prCount).toBe(0)
    })
  })

  describe('exercise progressions', () => {
    it('computes e1RM timeline with best per day', () => {
      const exercises = [
        makeExercise('Bench Press', ['chest'], [
          { date: '2026-04-01T10:00:00.000Z', weight: 200, reps: 5, estimated1RM: 233 },
          { date: '2026-04-01T10:05:00.000Z', weight: 225, reps: 3, estimated1RM: 248 }, // better e1RM same day
          { date: '2026-04-08T10:00:00.000Z', weight: 230, reps: 5, estimated1RM: 268 },
        ]),
      ]

      const report = buildTrainingReport({ ...baseInput, exercises })
      expect(report.exerciseProgressions).toHaveLength(1)

      const bench = report.exerciseProgressions[0]
      expect(bench.name).toBe('Bench Press')
      expect(bench.timeline).toHaveLength(2) // 2 days
      expect(bench.timeline[0].e1RM).toBe(248) // best of day 1
      expect(bench.timeline[1].e1RM).toBe(268) // day 2
      expect(bench.startE1RM).toBe(248)
      expect(bench.peakE1RM).toBe(268)
      expect(bench.delta).toBe(20)
    })

    it('sorts exercises by total volume descending', () => {
      const exercises = [
        makeExercise('Curls', ['arms'], [
          { date: '2026-04-01T10:00:00.000Z', weight: 30, reps: 10, estimated1RM: 40 },
        ]),
        makeExercise('Squat', ['legs'], [
          { date: '2026-04-01T10:00:00.000Z', weight: 315, reps: 5, estimated1RM: 368 },
        ]),
      ]

      const report = buildTrainingReport({ ...baseInput, exercises })
      expect(report.exerciseProgressions[0].name).toBe('Squat')
      expect(report.exerciseProgressions[1].name).toBe('Curls')
    })
  })

  describe('PR detection', () => {
    it('detects PRs when e1RM exceeds prior best', () => {
      const exercises = [
        makeExercise('Bench Press', ['chest'], [
          // Prior sets (before April)
          { date: '2026-03-15T10:00:00.000Z', weight: 200, reps: 5, estimated1RM: 233 },
          // Period sets
          { date: '2026-04-05T10:00:00.000Z', weight: 225, reps: 5, estimated1RM: 253 },
        ]),
      ]

      const report = buildTrainingReport({ ...baseInput, exercises })
      expect(report.prCount).toBe(1)
      expect(report.prTimeline).toHaveLength(1)
      expect(report.prTimeline[0].exerciseName).toBe('Bench Press')
      expect(report.prTimeline[0].e1RM).toBe(253)
    })

    it('does not flag a PR when e1RM is below prior best', () => {
      const exercises = [
        makeExercise('Bench Press', ['chest'], [
          { date: '2026-03-15T10:00:00.000Z', weight: 250, reps: 5, estimated1RM: 292 },
          { date: '2026-04-05T10:00:00.000Z', weight: 225, reps: 5, estimated1RM: 253 },
        ]),
      ]

      const report = buildTrainingReport({ ...baseInput, exercises })
      expect(report.prCount).toBe(0)
      expect(report.prTimeline).toHaveLength(0)
    })

    it('tracks multiple PRs within the period', () => {
      const exercises = [
        makeExercise('Bench Press', ['chest'], [
          { date: '2026-03-15T10:00:00.000Z', weight: 200, reps: 5, estimated1RM: 233 },
          { date: '2026-04-05T10:00:00.000Z', weight: 225, reps: 5, estimated1RM: 253 },
          { date: '2026-04-15T10:00:00.000Z', weight: 240, reps: 5, estimated1RM: 280 },
        ]),
      ]

      const report = buildTrainingReport({ ...baseInput, exercises })
      expect(report.prCount).toBe(2)
      expect(report.prTimeline).toHaveLength(2)
    })
  })

  describe('tag volume', () => {
    it('aggregates volume by tag', () => {
      const exercises = [
        makeExercise('Bench Press', ['chest', 'push'], [
          { date: '2026-04-05T10:00:00.000Z', weight: 225, reps: 5, estimated1RM: 253 },
        ]),
        makeExercise('OHP', ['shoulders', 'push'], [
          { date: '2026-04-05T10:00:00.000Z', weight: 135, reps: 8, estimated1RM: 171 },
        ]),
      ]

      const report = buildTrainingReport({ ...baseInput, exercises })
      const pushTag = report.tagVolume.find(t => t.tag === 'push')
      expect(pushTag).toBeDefined()
      expect(pushTag!.sets).toBe(2) // 1 bench + 1 OHP
      // Volume: 225*5 + 135*8 = 1125 + 1080 = 2205
      expect(pushTag!.volume).toBe(2205)
    })

    it('sorts tags by sets descending', () => {
      const exercises = [
        makeExercise('Bench Press', ['chest'], [
          { date: '2026-04-05T10:00:00.000Z', weight: 225, reps: 5, estimated1RM: 253 },
        ]),
        makeExercise('Squat', ['legs'], [
          { date: '2026-04-05T10:00:00.000Z', weight: 315, reps: 5, estimated1RM: 368 },
          { date: '2026-04-06T10:00:00.000Z', weight: 315, reps: 5, estimated1RM: 368 },
        ]),
      ]

      const report = buildTrainingReport({ ...baseInput, exercises })
      expect(report.tagVolume[0].tag).toBe('legs')
      expect(report.tagVolume[1].tag).toBe('chest')
    })
  })

  describe('weekly consistency', () => {
    it('groups sets into weeks and counts training days', () => {
      const exercises = [
        makeExercise('Bench Press', ['chest'], [
          // Week of Apr 6 (Mon)
          { date: '2026-04-06T10:00:00.000Z', weight: 225, reps: 5, estimated1RM: 253 },
          { date: '2026-04-08T10:00:00.000Z', weight: 225, reps: 5, estimated1RM: 253 },
          // Week of Apr 13 (Mon)
          { date: '2026-04-14T10:00:00.000Z', weight: 225, reps: 5, estimated1RM: 253 },
        ]),
      ]

      const report = buildTrainingReport({ ...baseInput, exercises })
      // Should have multiple weeks filling the month
      expect(report.weeklyConsistency.length).toBeGreaterThanOrEqual(4)

      const week1 = report.weeklyConsistency.find(w => w.weekStart === '2026-04-06')
      expect(week1).toBeDefined()
      expect(week1!.daysTrained).toBe(2)
      expect(week1!.sets).toBe(2)

      const week2 = report.weeklyConsistency.find(w => w.weekStart === '2026-04-13')
      expect(week2).toBeDefined()
      expect(week2!.daysTrained).toBe(1)
    })

    it('fills empty weeks with zeros', () => {
      const report = buildTrainingReport(baseInput)
      // April 2026 should have ~5 weeks
      expect(report.weeklyConsistency.length).toBeGreaterThanOrEqual(4)
      for (const week of report.weeklyConsistency) {
        expect(week.daysTrained).toBe(0)
        expect(week.sets).toBe(0)
        expect(week.volume).toBe(0)
      }
    })
  })

  describe('bodyweight', () => {
    it('extracts bodyweight entries within the period', () => {
      const bodyweight = [
        makeBW('2026-03-30', 185), // Before period
        makeBW('2026-04-01', 184),
        makeBW('2026-04-15', 182),
        makeBW('2026-04-30', 180),
        makeBW('2026-05-01', 179), // After period
      ]

      const report = buildTrainingReport({ ...baseInput, bodyweight })
      expect(report.bodyweight.timeline).toHaveLength(3) // 3 in April
      expect(report.bodyweight.startWeight).toBe(184)
      expect(report.bodyweight.endWeight).toBe(180)
      expect(report.bodyweight.delta).toBe(-4)
    })

    it('handles no bodyweight data', () => {
      const report = buildTrainingReport(baseInput)
      expect(report.bodyweight.timeline).toHaveLength(0)
      expect(report.bodyweight.startWeight).toBeNull()
      expect(report.bodyweight.endWeight).toBeNull()
      expect(report.bodyweight.delta).toBeNull()
    })
  })

  describe('unit conversion', () => {
    it('applies toDisplayUnits to volume and e1RM values', () => {
      const exercises = [
        makeExercise('Bench Press', ['chest'], [
          { date: '2026-04-05T10:00:00.000Z', weight: 225, reps: 5, estimated1RM: 253 },
        ]),
      ]

      const toKg = (lbs: number) => Math.round(lbs * 0.453592 * 10) / 10

      const report = buildTrainingReport({
        ...baseInput,
        exercises,
        toDisplayUnits: toKg,
        unitLabel: 'kg',
      })

      expect(report.unitLabel).toBe('kg')
      // Volume should be in kg: 225*0.453592 * 5 ≈ 510
      expect(report.totalVolume).toBeGreaterThan(500)
      expect(report.totalVolume).toBeLessThan(520)
    })
  })

  // #1333 — all four of this file's volume sums multiplied the raw `set.weight`,
  // which on a bodyweightLoaded exercise is only the ADDED plate weight. The
  // report is what the AI coach reads, so a pull-up block reached the model as
  // near-zero volume and the digest read the lifter's hardest work as a deload.
  describe('bodyweight-loaded volume (#1333)', () => {
    const pullups = makeExercise(
      'Pull-ups',
      ['back'],
      [
        // Added 0 — the pure-bodyweight case LIFT-834 exists for. 185 × 10.
        { date: '2026-04-06T10:00:00.000Z', weight: 0, reps: 10, estimated1RM: 246, bodyweight: 185 },
        // Added 25 on a belt. (185 + 25) × 6.
        { date: '2026-04-06T10:05:00.000Z', weight: 25, reps: 6, estimated1RM: 252, bodyweight: 185 },
      ],
      true,
    )
    const EXPECTED = 185 * 10 + 210 * 6 // 3110; was 0 + 150 = 150

    it('folds bodyweight into every volume the report emits', () => {
      const report = buildTrainingReport({ ...baseInput, exercises: [pullups] })

      expect(report.totalVolume).toBe(EXPECTED)
      expect(report.exerciseProgressions[0].totalVolume).toBe(EXPECTED)
      expect(report.tagVolume.find(t => t.tag === 'back')?.volume).toBe(EXPECTED)
      // 2026-04-06 is a Monday, so the week bucket is its own start.
      expect(report.weeklyConsistency.find(w => w.weekStart === '2026-04-06')?.volume).toBe(EXPECTED)
    })

    it('folds in lbs BEFORE converting to display units', () => {
      // `set.bodyweight` is stored in lbs like `set.weight`, so converting
      // first and folding after would add a pound count to a kilo count —
      // the mixed-space failure LIFT-1315 fixed in the intensity table.
      const toKg = (lbs: number) => lbs * 0.453592
      const report = buildTrainingReport({
        ...baseInput,
        exercises: [pullups],
        toDisplayUnits: toKg,
        unitLabel: 'kg',
      })

      expect(report.totalVolume).toBe(Math.round(toKg(EXPECTED)))
      // Fold-after-convert would land near 185*10 + 210*6 with only the added
      // weight converted — an order of magnitude out. Pin the gap explicitly.
      expect(report.totalVolume).toBeLessThan(EXPECTED / 2)
    })

    it('leaves a normal barbell lift untouched even when its sets carry a bodyweight', () => {
      const squat = makeExercise('Squat', ['legs'], [
        { date: '2026-04-06T10:00:00.000Z', weight: 315, reps: 5, estimated1RM: 368, bodyweight: 185 },
      ])
      const report = buildTrainingReport({ ...baseInput, exercises: [squat] })
      expect(report.totalVolume).toBe(1575)
    })

    it('degrades to the added weight when a set captured no bodyweight', () => {
      const dips = makeExercise(
        'Dips',
        ['chest'],
        [{ date: '2026-04-06T10:00:00.000Z', weight: 45, reps: 8, estimated1RM: 57 }],
        true,
      )
      const report = buildTrainingReport({ ...baseInput, exercises: [dips] })
      expect(report.totalVolume).toBe(360)
    })
  })
})
