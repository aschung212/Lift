import { describe, it, expect, beforeEach } from 'vitest'
import {
  decideWelcomeBack,
  readWelcomeBackState,
  markWelcomedBack,
  INACTIVITY_GAP_DAYS,
  WELCOME_BACK_KEY,
} from '../welcomeBack'

describe('decideWelcomeBack', () => {
  // 2026-08-07 (local) is "today" for these cases.
  const now = new Date(2026, 7, 7, 10, 0, 0)

  it('returns null when there is no workout history', () => {
    expect(decideWelcomeBack([], '', now)).toBeNull()
  })

  it('returns null when the last workout is inside the gap threshold', () => {
    // 10 days ago (< 14) is not an absence.
    expect(decideWelcomeBack(['2026-07-28'], '', now)).toBeNull()
  })

  it('returns null exactly one day before the threshold', () => {
    // 13 days ago.
    expect(decideWelcomeBack(['2026-07-25'], '', now)).toBeNull()
  })

  it('fires exactly at the threshold', () => {
    // 14 days ago.
    const d = decideWelcomeBack(['2026-07-24'], '', now)
    expect(d).not.toBeNull()
    expect(d!.daysAway).toBe(INACTIVITY_GAP_DAYS)
    expect(d!.lastWorkoutDate).toBe('2026-07-24')
  })

  it('uses the most recent workout date, not the earliest', () => {
    const d = decideWelcomeBack(['2026-01-01', '2026-06-01', '2026-07-20'], '', now)
    expect(d).not.toBeNull()
    expect(d!.lastWorkoutDate).toBe('2026-07-20')
    expect(d!.daysAway).toBe(18)
  })

  it('stays suppressed for an absence already welcomed', () => {
    expect(decideWelcomeBack(['2026-07-20'], '2026-07-20', now)).toBeNull()
  })

  it('re-arms once a fresh workout shifts the last-workout date', () => {
    // Previously welcomed for 2026-07-20, but a new workout on 2026-07-22 then a
    // fresh lapse — the acknowledged date no longer matches, so it fires again.
    const d = decideWelcomeBack(['2026-07-20', '2026-07-22'], '2026-07-20', now)
    expect(d).not.toBeNull()
    expect(d!.lastWorkoutDate).toBe('2026-07-22')
  })

  it('does not fire for a future-dated last workout (clock skew)', () => {
    expect(decideWelcomeBack(['2026-09-01'], '', now)).toBeNull()
  })
})

describe('welcome-back storage', () => {
  beforeEach(() => {
    localStorage.removeItem(WELCOME_BACK_KEY)
  })

  it('defaults to an empty acknowledged date', () => {
    expect(readWelcomeBackState()).toEqual({ acknowledgedWorkoutDate: '' })
  })

  it('round-trips a marked absence', () => {
    markWelcomedBack('2026-07-20')
    expect(readWelcomeBackState().acknowledgedWorkoutDate).toBe('2026-07-20')
  })

  it('overwrites with the most recent absence', () => {
    markWelcomedBack('2026-06-01')
    markWelcomedBack('2026-07-20')
    expect(readWelcomeBackState().acknowledgedWorkoutDate).toBe('2026-07-20')
  })

  it('falls back to default on corrupt storage', () => {
    localStorage.setItem(WELCOME_BACK_KEY, '{not json')
    expect(readWelcomeBackState()).toEqual({ acknowledgedWorkoutDate: '' })
  })
})
