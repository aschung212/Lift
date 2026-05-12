import { describe, it, expect } from 'vitest'
import { renderReport } from '../reportRenderer'
import type { TrainingReport } from '../trainingReport'

function makeReport(overrides: Partial<TrainingReport> = {}): TrainingReport {
  return {
    periodLabel: 'April 2026',
    startDate: '2026-04-01',
    endDate: '2026-04-30',
    unitLabel: 'lbs',
    totalWorkoutDays: 12,
    totalSets: 48,
    totalVolume: 125000,
    uniqueExercises: 8,
    prCount: 3,
    exerciseProgressions: [],
    tagVolume: [],
    weeklyConsistency: [],
    bodyweight: { timeline: [], startWeight: null, endWeight: null, delta: null },
    prTimeline: [],
    ...overrides,
  }
}

describe('renderReport', () => {
  it('returns valid HTML with doctype and charset', () => {
    const html = renderReport(makeReport())
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<meta charset="utf-8">')
  })

  it('includes the period label in the title and header', () => {
    const html = renderReport(makeReport({ periodLabel: 'Q2 2026' }))
    expect(html).toContain('Q2 2026')
    expect(html).toContain('<title>Lift Training Report')
  })

  it('renders summary stat cards', () => {
    const html = renderReport(makeReport({
      totalWorkoutDays: 15,
      totalSets: 60,
      totalVolume: 200000,
      uniqueExercises: 10,
      prCount: 5,
    }))
    expect(html).toContain('15')      // workout days
    expect(html).toContain('60')      // total sets
    expect(html).toContain('200,000') // volume formatted
    expect(html).toContain('10')      // exercises
    expect(html).toContain('5')       // PRs
  })

  it('renders exercise progression rows', () => {
    const html = renderReport(makeReport({
      exerciseProgressions: [{
        name: 'Bench Press',
        tags: ['chest', 'push'],
        timeline: [
          { date: '2026-04-01', e1RM: 250 },
          { date: '2026-04-15', e1RM: 265 },
        ],
        peakE1RM: 265,
        startE1RM: 250,
        delta: 15,
        totalSets: 12,
        totalVolume: 30000,
      }],
    }))
    expect(html).toContain('Bench Press')
    expect(html).toContain('chest, push')
    expect(html).toContain('250 → 265 lbs')
    expect(html).toContain('+15')
    // Should contain an SVG sparkline
    expect(html).toContain('<svg')
    expect(html).toContain('polyline')
  })

  it('renders PR timeline rows', () => {
    const html = renderReport(makeReport({
      prTimeline: [{
        date: '2026-04-10',
        exerciseName: 'Squat',
        weight: 315,
        reps: 5,
        e1RM: 368,
      }],
    }))
    expect(html).toContain('Squat')
    expect(html).toContain('315 lbs')
    expect(html).toContain('368 lbs')
    expect(html).toContain('Apr 10, 2026')
  })

  it('renders tag volume table', () => {
    const html = renderReport(makeReport({
      tagVolume: [
        { tag: 'legs', sets: 20, volume: 80000 },
        { tag: 'chest', sets: 15, volume: 45000 },
      ],
    }))
    expect(html).toContain('legs')
    expect(html).toContain('chest')
    expect(html).toContain('Volume by Muscle Group')
  })

  it('renders bodyweight section when data exists', () => {
    const html = renderReport(makeReport({
      bodyweight: {
        timeline: [
          { date: '2026-04-01', weight: 185 },
          { date: '2026-04-30', weight: 182 },
        ],
        startWeight: 185,
        endWeight: 182,
        delta: -3,
      },
    }))
    expect(html).toContain('Body Weight')
    expect(html).toContain('185')
    expect(html).toContain('182')
    expect(html).toContain('-3')
  })

  it('omits bodyweight section when no data', () => {
    const html = renderReport(makeReport())
    expect(html).not.toContain('Body Weight')
  })

  it('includes print hint with Cmd+P instruction', () => {
    const html = renderReport(makeReport())
    expect(html).toContain('Cmd+P')
    expect(html).toContain('Ctrl+P')
  })

  it('hides print hint in @media print', () => {
    const html = renderReport(makeReport())
    expect(html).toContain('.print-hint { display: none; }')
  })

  it('escapes HTML in exercise names', () => {
    const html = renderReport(makeReport({
      exerciseProgressions: [{
        name: 'Press <script>alert(1)</script>',
        tags: [],
        timeline: [{ date: '2026-04-01', e1RM: 100 }],
        peakE1RM: 100,
        startE1RM: 100,
        delta: 0,
        totalSets: 1,
        totalVolume: 100,
      }],
    }))
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('uses kg unit label when provided', () => {
    const html = renderReport(makeReport({ unitLabel: 'kg' }))
    expect(html).toContain('Volume (kg)')
  })

  it('renders weekly consistency chart and table', () => {
    const html = renderReport(makeReport({
      weeklyConsistency: [
        { weekStart: '2026-04-06', daysTrained: 4, sets: 20, volume: 50000 },
        { weekStart: '2026-04-13', daysTrained: 3, sets: 15, volume: 40000 },
      ],
    }))
    expect(html).toContain('Weekly Consistency')
    expect(html).toContain('Apr 6')
    expect(html).toContain('Apr 13')
  })
})
