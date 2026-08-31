/**
 * Set-effort ordering (#1271).
 *
 * The load-bearing case is the last one: two sets with IDENTICAL weight and
 * reps are only distinguishable by whether the lifter went for one more rep.
 * That is the entire reason the annotation exists — without it, "8 racked" and
 * "8 + failed 9th" collapse into the same number and the app reads a real
 * effort increase as a flat plateau.
 */
import { describe, it, expect } from 'vitest'
import { attemptedNextRep, compareSetEffort, pickTopSet } from '../setEffort'

describe('attemptedNextRep', () => {
  it('is true only for an explicit true', () => {
    expect(attemptedNextRep({ attemptedNextRep: true })).toBe(true)
    expect(attemptedNextRep({ attemptedNextRep: false })).toBe(false)
    // Absent === re-racked. Legacy sets predate the annotation and are never
    // backfilled, so "unknown" must read as the conservative default.
    expect(attemptedNextRep({})).toBe(false)
  })
})

describe('compareSetEffort', () => {
  it('ranks heavier above lighter regardless of reps', () => {
    expect(compareSetEffort({ weight: 225, reps: 1 }, { weight: 135, reps: 12 })).toBeGreaterThan(0)
  })

  it('ranks more reps above fewer at the same weight', () => {
    expect(compareSetEffort({ weight: 135, reps: 9 }, { weight: 135, reps: 8 })).toBeGreaterThan(0)
  })

  it('ranks an attempted next rep above a re-rack at the same weight and reps', () => {
    const attempted = { weight: 135, reps: 8, attemptedNextRep: true }
    const racked = { weight: 135, reps: 8 }
    expect(compareSetEffort(attempted, racked)).toBeGreaterThan(0)
    expect(compareSetEffort(racked, attempted)).toBeLessThan(0)
  })

  it('treats two equally-annotated sets as tied', () => {
    expect(compareSetEffort({ weight: 135, reps: 8 }, { weight: 135, reps: 8 })).toBe(0)
    expect(compareSetEffort(
      { weight: 135, reps: 8, attemptedNextRep: true },
      { weight: 135, reps: 8, attemptedNextRep: true },
    )).toBe(0)
  })

  it('does not let the attempt outrank a genuinely completed extra rep', () => {
    // A clean 9 is still more work than 8 + a missed 9th — the annotation is a
    // tiebreak, never a substitute for landing the rep.
    const cleanNine = { weight: 135, reps: 9 }
    const missedNinth = { weight: 135, reps: 8, attemptedNextRep: true }
    expect(compareSetEffort(cleanNine, missedNinth)).toBeGreaterThan(0)
  })
})

describe('pickTopSet', () => {
  it('returns null for an empty list', () => {
    expect(pickTopSet([])).toBeNull()
  })

  it('picks the heaviest set', () => {
    const top = { weight: 225, reps: 3 }
    expect(pickTopSet([{ weight: 135, reps: 10 }, top, { weight: 185, reps: 5 }])).toBe(top)
  })

  it('picks the set that went for one more when weight and reps tie', () => {
    const racked = { id: 'a', weight: 135, reps: 8 }
    const attempted = { id: 'b', weight: 135, reps: 8, attemptedNextRep: true }
    expect(pickTopSet([racked, attempted])).toBe(attempted)
    // Order-independent: the annotation wins from either direction.
    expect(pickTopSet([attempted, racked])).toBe(attempted)
  })

  it('keeps the first of fully-tied sets so a 5x5 stays deterministic', () => {
    const first = { id: 'a', weight: 225, reps: 5 }
    const second = { id: 'b', weight: 225, reps: 5 }
    expect(pickTopSet([first, second])).toBe(first)
  })
})
