import { describe, it, expect } from 'vitest'
import { classifyExercise, buildDerivedAnalytics } from '../coachAnalytics'
import type { Exercise, WorkoutSet } from '../../stores/workout'

/** Fixed "now" so windowing is deterministic. */
const NOW = new Date(2026, 6, 10, 12, 0, 0) // 2026-07-10 local

let idCounter = 0
function set(date: string, weight: number, reps: number, createdAt?: string): WorkoutSet {
  // Epley e1RM, matching the app (1 rep = the weight itself).
  const e1rm = reps === 1 ? weight : weight * (1 + reps / 30)
  return { id: `s${idCounter++}`, date: `${date}T23:59:00Z`, weight, reps, estimated1RM: e1rm, createdAt }
}

function exercise(name: string, tags: string[], sets: WorkoutSet[]): Exercise {
  return { id: `e${idCounter++}`, name, tags, sets }
}

describe('classifyExercise — name heuristic', () => {
  it('classifies free-weight lifts', () => {
    expect(classifyExercise('Bench Press')).toBe('free_weight')
    expect(classifyExercise('Barbell Squat')).toBe('free_weight')
    expect(classifyExercise('Dumbbell Curl')).toBe('free_weight')
    expect(classifyExercise('Deadlift')).toBe('free_weight')
  })

  it('machine markers beat free-weight markers ("seated row" is a cable stack)', () => {
    expect(classifyExercise('Seated Row')).toBe('machine')
    expect(classifyExercise('Smith Machine Squat')).toBe('machine')
    expect(classifyExercise('Leg Press')).toBe('machine')
    expect(classifyExercise('Lat Pulldown')).toBe('machine')
    expect(classifyExercise('Cable Fly')).toBe('machine')
    expect(classifyExercise('Hack Squat')).toBe('machine')
  })

  it('classifies bodyweight movements', () => {
    expect(classifyExercise('Pull-Up')).toBe('bodyweight')
    expect(classifyExercise('Weighted Dip')).toBe('bodyweight')
    expect(classifyExercise('Push Up')).toBe('bodyweight')
  })

  it('returns unknown rather than guessing', () => {
    expect(classifyExercise('Farmers Walk')).toBe('unknown')
    expect(classifyExercise('Sled Drag')).toBe('unknown')
  })
})

describe('buildDerivedAnalytics — progression', () => {
  it('computes first/best/recent e1RM and gain across the window', () => {
    const ex = exercise('Bench Press', ['chest'], [
      set('2026-06-01', 185, 5), // first day: e1rm ≈ 215.8
      set('2026-06-15', 195, 5),
      set('2026-06-29', 205, 5), // last day: e1rm ≈ 239.2
    ])
    const d = buildDerivedAnalytics({ exercises: [ex], now: NOW })
    expect(d.perExerciseProgression).toHaveLength(1)
    const p = d.perExerciseProgression[0]
    expect(p.exerciseName).toBe('Bench Press')
    expect(p.sessions).toBe(3)
    expect(p.spanDays).toBe(28)
    expect(p.recentE1rm).toBeGreaterThan(p.firstE1rm)
    expect(p.gain).toBeCloseTo(p.recentE1rm - p.firstE1rm, 0)
    expect(p.gainPct).toBeGreaterThan(0)
    expect(p.gainPerWeek).toBeGreaterThan(0)
    expect(p.flags).toBeUndefined() // low-rep free-weight lift = reliable
  })

  it('flags high-rep e1RM estimates and machine lifts', () => {
    const highRep = exercise('Overhead Press', ['shoulders'], [
      set('2026-06-01', 95, 15), // window best from a 15-rep set → inflated
      set('2026-06-20', 95, 14),
    ])
    const machine = exercise('Leg Press', ['quads'], [
      set('2026-06-01', 400, 8),
      set('2026-06-20', 450, 8),
    ])
    const d = buildDerivedAnalytics({ exercises: [highRep, machine], now: NOW })
    const byName = Object.fromEntries(d.perExerciseProgression.map((p) => [p.exerciseName, p]))
    expect(byName['Overhead Press'].flags).toContain('high_rep_estimate')
    expect(byName['Leg Press'].flags).toContain('machine')
  })

  it('requires ≥2 training days and ignores sets outside the window', () => {
    const single = exercise('Bench Press', ['chest'], [set('2026-07-01', 185, 5)])
    const stale = exercise('Squat', ['quads'], [
      set('2025-01-01', 225, 5),
      set('2025-02-01', 245, 5),
    ])
    const d = buildDerivedAnalytics({ exercises: [single, stale], now: NOW })
    expect(d.perExerciseProgression).toHaveLength(0)
  })
})

describe('buildDerivedAnalytics — reliable 1RM', () => {
  it('uses the best ≤6-rep set of free-weight lifts only, with bodyweight ratio', () => {
    const bench = exercise('Bench Press', ['chest'], [
      set('2026-06-01', 185, 12), // high-rep — excluded from reliable
      set('2026-06-15', 205, 3),  // e1rm = 225.5 — the reliable number
    ])
    const legPress = exercise('Leg Press', ['quads'], [set('2026-06-15', 500, 5)])
    const d = buildDerivedAnalytics({ exercises: [bench, legPress], bodyweightLb: 200, now: NOW })
    expect(d.reliable1RM).toHaveLength(1) // machine excluded
    const r = d.reliable1RM[0]
    expect(r.exerciseName).toBe('Bench Press')
    expect(r.reps).toBe(3)
    expect(r.weight).toBe(205)
    expect(r.bwRatio).toBeCloseTo(r.e1rm / 200, 1)
  })

  it('omits the ratio when bodyweight is opted out', () => {
    const bench = exercise('Bench Press', ['chest'], [set('2026-06-15', 205, 3)])
    const d = buildDerivedAnalytics({ exercises: [bench], bodyweightLb: null, now: NOW })
    expect(d.reliable1RM[0].bwRatio).toBeUndefined()
  })
})

describe('buildDerivedAnalytics — warm-up ramp', () => {
  it('computes median ramp sets before the top set and first-set % of top', () => {
    // 3 sessions, each: 135 → 185 → 225 (2 ramp sets, first = 60% of top).
    const sets: WorkoutSet[] = []
    for (const day of ['2026-06-01', '2026-06-08', '2026-06-15']) {
      sets.push(set(day, 135, 5), set(day, 185, 5), set(day, 225, 5))
    }
    const d = buildDerivedAnalytics({ exercises: [exercise('Squat', ['quads'], sets)], now: NOW })
    expect(d.warmupRamp).toHaveLength(1)
    expect(d.warmupRamp[0].medianRampSets).toBe(2)
    expect(d.warmupRamp[0].medianFirstPctOfTop).toBe(60)
    expect(d.warmupRamp[0].sessions).toBe(3)
  })

  it('needs ≥3 multi-set sessions for a stable median', () => {
    const sets = [set('2026-06-01', 135, 5), set('2026-06-01', 225, 5)]
    const d = buildDerivedAnalytics({ exercises: [exercise('Squat', ['quads'], sets)], now: NOW })
    expect(d.warmupRamp).toHaveLength(0)
  })
})

describe('buildDerivedAnalytics — session shape + muscle stats', () => {
  it('computes medians and weekly volume/frequency per tag', () => {
    // Two weeks: chest trained Mon+Thu each week (4 days), 3 sets/day.
    const days = ['2026-06-29', '2026-07-02', '2026-07-06', '2026-07-09']
    const sets = days.flatMap((day) => [set(day, 185, 8), set(day, 185, 8), set(day, 185, 8)])
    const d = buildDerivedAnalytics({ exercises: [exercise('Bench Press', ['chest'], sets)], now: NOW })

    expect(d.sessionShape).toEqual({
      setsPerSessionMedian: 3,
      exercisesPerSessionMedian: 1,
      setsPerExerciseMedian: 3,
    })
    expect(d.weeklyVolumeByMuscle).toEqual([{ tagName: 'chest', avgWeeklySets: 6 }]) // 12 sets / 2 wks
    expect(d.weeklyFrequencyByMuscle).toHaveLength(1)
    expect(d.weeklyFrequencyByMuscle[0].avgDaysPerWeek).toBe(2)
    expect(d.weeklyFrequencyByMuscle[0].medianGapDays).toBe(3) // gaps 3,4,3 → median 3
  })
})

describe('buildDerivedAnalytics — distributions', () => {
  it('buckets sets by at-the-time intensity and rep range', () => {
    const ex = exercise('Bench Press', ['chest'], [
      set('2026-06-01', 200, 1),  // establishes e1rm 200; 100% → above85; 1 rep → low
      set('2026-06-08', 100, 8),  // 50% of 200 → below60; 8 reps → mid
      set('2026-06-15', 150, 15), // 75% → from60to85; 15 reps → high
    ])
    const d = buildDerivedAnalytics({ exercises: [ex], now: NOW })
    expect(d.intensityDistribution).toEqual({ below60: 1, from60to85: 1, above85: 1 })
    expect(d.repRangeDistribution).toEqual({ low: 1, mid: 1, high: 1 })
  })

  it('returns null distributions with no in-window sets', () => {
    const d = buildDerivedAnalytics({ exercises: [], now: NOW })
    expect(d.intensityDistribution).toBeNull()
    expect(d.repRangeDistribution).toBeNull()
    expect(d.sessionShape).toBeNull()
  })
})

describe('buildDerivedAnalytics — exercise order (timestamped only)', () => {
  it('computes median position from real createdAt timestamps', () => {
    const days = ['2026-06-01', '2026-06-08']
    const bench = exercise('Bench Press', ['chest'],
      days.map((day) => set(day, 185, 8, `${day}T10:00:00Z`)))
    const curls = exercise('Dumbbell Curl', ['biceps'],
      days.map((day) => set(day, 30, 12, `${day}T10:30:00Z`)))
    const d = buildDerivedAnalytics({ exercises: [bench, curls], now: NOW })
    const byName = Object.fromEntries(d.exerciseOrder.map((o) => [o.exerciseName, o]))
    expect(byName['Bench Press'].medianPosition).toBe(1)
    expect(byName['Dumbbell Curl'].medianPosition).toBe(2)
  })

  it('NEVER fabricates order from untimestamped sets', () => {
    const days = ['2026-06-01', '2026-06-08']
    const bench = exercise('Bench Press', ['chest'], days.map((day) => set(day, 185, 8)))
    const curls = exercise('Dumbbell Curl', ['biceps'], days.map((day) => set(day, 30, 12)))
    const d = buildDerivedAnalytics({ exercises: [bench, curls], now: NOW })
    expect(d.exerciseOrder).toHaveLength(0)
  })
})
