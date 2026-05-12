import { describe, it, expect } from 'vitest'
import { computeWeeklyGoal } from '../weeklyGoal'
import type { Exercise } from '../../stores/workout'

function makeExercise(setDates: string[]): Exercise {
  return {
    id: 'ex-1',
    name: 'Bench Press',
    tags: [],
    sets: setDates.map((date, i) => ({
      id: `s-${i}`,
      date,
      weight: 135,
      reps: 10,
      estimated1RM: 180,
    })),
  }
}

describe('computeWeeklyGoal', () => {
  // Wednesday 2026-04-29 (week: Mon Apr 27 – Sun May 3)
  const wednesday = new Date(2026, 3, 29, 14, 0, 0) // local time

  it('returns 0 trained when no exercises exist', () => {
    const result = computeWeeklyGoal([], 3, wednesday)
    expect(result).toEqual({ trained: 0, target: 3, met: false, atRisk: false })
  })

  it('counts unique training days within the Mon–Sun week', () => {
    const ex = makeExercise([
      '2026-04-27T09:00:00', // Monday
      '2026-04-27T16:00:00', // Monday again (same day, should count once)
      '2026-04-28T10:00:00', // Tuesday
      '2026-04-29T08:00:00', // Wednesday (today)
    ])
    const result = computeWeeklyGoal([ex], 5, wednesday)
    expect(result.trained).toBe(3)
    expect(result.target).toBe(5)
    expect(result.met).toBe(false)
  })

  it('marks goal as met when trained >= target', () => {
    const ex = makeExercise([
      '2026-04-27T09:00:00', // Mon
      '2026-04-28T09:00:00', // Tue
      '2026-04-29T09:00:00', // Wed
    ])
    const result = computeWeeklyGoal([ex], 3, wednesday)
    expect(result.met).toBe(true)
    expect(result.atRisk).toBe(false)
  })

  it('marks streak at risk when not enough days remain', () => {
    // Sunday: 0 days trained, target=3, only 1 day left (today = Sunday)
    const sunday = new Date(2026, 4, 3, 14, 0, 0) // Sun May 3
    const result = computeWeeklyGoal([], 3, sunday)
    expect(result.atRisk).toBe(true)
  })

  it('does not mark at risk when enough days remain', () => {
    // Monday, target=5, 0 trained → 7 days left including today, 5 needed → not at risk
    const monday = new Date(2026, 3, 27, 10, 0, 0)
    const result = computeWeeklyGoal([], 5, monday)
    expect(result.atRisk).toBe(false)
  })

  it('excludes sets from previous weeks', () => {
    const ex = makeExercise([
      '2026-04-20T09:00:00', // previous Monday
      '2026-04-26T09:00:00', // previous Sunday
      '2026-04-27T09:00:00', // this Monday
    ])
    const result = computeWeeklyGoal([ex], 3, wednesday)
    expect(result.trained).toBe(1)
  })

  it('aggregates training days across multiple exercises', () => {
    const ex1 = makeExercise(['2026-04-27T09:00:00']) // Mon: exercise 1
    const ex2 = makeExercise(['2026-04-27T16:00:00', '2026-04-29T08:00:00']) // Mon + Wed: exercise 2
    const result = computeWeeklyGoal([ex1, ex2], 3, wednesday)
    expect(result.trained).toBe(2) // Mon + Wed (Mon appears in both but counts once)
  })

  it('handles Sunday correctly as last day of week', () => {
    const sunday = new Date(2026, 4, 3, 20, 0, 0) // Sun May 3
    const ex = makeExercise([
      '2026-04-27T09:00:00', // Mon
      '2026-04-29T09:00:00', // Wed
      '2026-05-01T09:00:00', // Fri
      '2026-05-03T09:00:00', // Sun (today)
    ])
    const result = computeWeeklyGoal([ex], 4, sunday)
    expect(result.trained).toBe(4)
    expect(result.met).toBe(true)
  })

  it('target=1 met with any training day', () => {
    const ex = makeExercise(['2026-04-28T09:00:00']) // Tue
    const result = computeWeeklyGoal([ex], 1, wednesday)
    expect(result.met).toBe(true)
  })

  it('at risk: Saturday with 0/5 trained', () => {
    const saturday = new Date(2026, 4, 2, 10, 0, 0) // Sat May 2
    const result = computeWeeklyGoal([], 5, saturday)
    // 2 days left (Sat + Sun), need 5 → at risk
    expect(result.atRisk).toBe(true)
  })

  it('not at risk when exactly enough days remain', () => {
    // Thursday, 0 trained, target=4 → 4 days left (Thu/Fri/Sat/Sun) → not at risk
    const thursday = new Date(2026, 3, 30, 10, 0, 0)
    const result = computeWeeklyGoal([], 4, thursday)
    expect(result.atRisk).toBe(false)
  })
})
