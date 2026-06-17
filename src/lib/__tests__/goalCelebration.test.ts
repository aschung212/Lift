import { describe, it, expect, beforeEach } from 'vitest'
import {
  weekKeyOf,
  decideGoalCelebration,
  readGoalCelebrationState,
  markGoalWeekCelebrated,
  GOAL_CELEBRATION_KEY,
} from '../goalCelebration'

describe('weekKeyOf', () => {
  it('returns the Monday of the local week (Tuesday input)', () => {
    // 2026-06-16 is a Tuesday; its Monday is 2026-06-15.
    expect(weekKeyOf(new Date(2026, 5, 16, 10, 0, 0))).toBe('2026-06-15')
  })

  it('returns the same Monday for every day in the Mon–Sun week', () => {
    const monday = new Date(2026, 5, 15) // Mon
    const sunday = new Date(2026, 5, 21) // Sun
    expect(weekKeyOf(monday)).toBe('2026-06-15')
    expect(weekKeyOf(sunday)).toBe('2026-06-15')
  })

  it('treats Sunday as the end of the current week, not the start of the next', () => {
    expect(weekKeyOf(new Date(2026, 5, 21, 23, 59, 0))).toBe('2026-06-15')
  })
})

describe('decideGoalCelebration', () => {
  const now = new Date(2026, 5, 16) // Tue → week key 2026-06-15

  it('returns null when the goal is not met', () => {
    expect(decideGoalCelebration(false, 0, '', now)).toBeNull()
  })

  it('returns null when this week was already celebrated', () => {
    expect(decideGoalCelebration(true, 0, '2026-06-15', now)).toBeNull()
  })

  it('fires when the goal is met and the week has not been celebrated', () => {
    const d = decideGoalCelebration(true, 0, '', now)
    expect(d).not.toBeNull()
    expect(d!.weekKey).toBe('2026-06-15')
  })

  it('fires again in a new week even if a prior week was celebrated', () => {
    const d = decideGoalCelebration(true, 2, '2026-06-08', now)
    expect(d).not.toBeNull()
    expect(d!.weekKey).toBe('2026-06-15')
  })

  it('projects the streak forward by one week', () => {
    expect(decideGoalCelebration(true, 0, '', now)!.streak).toBe(1)
    expect(decideGoalCelebration(true, 3, '', now)!.streak).toBe(4)
  })

  it('flags a milestone only when the duration multiplier tier increases', () => {
    // tiers bump at 2, 4, 8, 12 weeks
    expect(decideGoalCelebration(true, 0, '', now)!.milestone).toBe(false) // →1, no bump
    expect(decideGoalCelebration(true, 1, '', now)!.milestone).toBe(true)  // →2, bump
    expect(decideGoalCelebration(true, 2, '', now)!.milestone).toBe(false) // →3, no bump
    expect(decideGoalCelebration(true, 3, '', now)!.milestone).toBe(true)  // →4, bump
    expect(decideGoalCelebration(true, 7, '', now)!.milestone).toBe(true)  // →8, bump
    expect(decideGoalCelebration(true, 11, '', now)!.milestone).toBe(true) // →12, bump
  })
})

describe('goal celebration storage', () => {
  beforeEach(() => {
    localStorage.removeItem(GOAL_CELEBRATION_KEY)
  })

  it('defaults to an empty last-celebrated week', () => {
    expect(readGoalCelebrationState()).toEqual({ lastCelebratedWeek: '' })
  })

  it('round-trips a marked week', () => {
    markGoalWeekCelebrated('2026-06-15')
    expect(readGoalCelebrationState().lastCelebratedWeek).toBe('2026-06-15')
  })

  it('overwrites with the most recent week', () => {
    markGoalWeekCelebrated('2026-06-08')
    markGoalWeekCelebrated('2026-06-15')
    expect(readGoalCelebrationState().lastCelebratedWeek).toBe('2026-06-15')
  })

  it('falls back to default on corrupt storage', () => {
    localStorage.setItem(GOAL_CELEBRATION_KEY, '{not json')
    expect(readGoalCelebrationState()).toEqual({ lastCelebratedWeek: '' })
  })
})
