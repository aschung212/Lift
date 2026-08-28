import { describe, it, expect } from 'vitest'
import { effectiveSetWeight } from '../bodyweightLoad'
import type { WorkoutSet } from '../../stores/workout'

function set(partial: Partial<WorkoutSet>): WorkoutSet {
  return { id: 's', date: '2026-08-01T23:59:00.000Z', weight: 25, reps: 8, estimated1RM: 0, ...partial }
}

describe('effectiveSetWeight (LIFT-834)', () => {
  it('returns the bare weight for a normal exercise', () => {
    expect(effectiveSetWeight(set({ weight: 135 }), { bodyweightLoaded: false })).toBe(135)
  })

  it('returns the bare weight when no exercise context is given', () => {
    expect(effectiveSetWeight(set({ weight: 135 }))).toBe(135)
    expect(effectiveSetWeight(set({ weight: 135 }), null)).toBe(135)
  })

  it('folds captured bodyweight into the load for a bodyweight-loaded exercise', () => {
    expect(effectiveSetWeight(set({ weight: 25, bodyweight: 160 }), { bodyweightLoaded: true })).toBe(185)
  })

  it('gives pure-bodyweight reps (added = 0) full credit', () => {
    expect(effectiveSetWeight(set({ weight: 0, bodyweight: 170 }), { bodyweightLoaded: true })).toBe(170)
  })

  it('degrades to the added weight when the flag is on but no bodyweight was captured', () => {
    // A set logged before the exercise was flagged and never edited: fold in
    // nothing rather than guessing a zero-bodyweight or NaN.
    expect(effectiveSetWeight(set({ weight: 25, bodyweight: undefined }), { bodyweightLoaded: true })).toBe(25)
  })

  it('ignores a captured bodyweight while the flag is off', () => {
    expect(effectiveSetWeight(set({ weight: 25, bodyweight: 160 }), { bodyweightLoaded: false })).toBe(25)
  })
})
