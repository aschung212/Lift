import { describe, it, expect } from 'vitest'
import { addedWeightFromEffective, bodyweightFold, effectiveSetWeight } from '../bodyweightLoad'
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

describe('bodyweightFold (#1328)', () => {
  it('is zero for a normal exercise, whatever bodyweight is offered', () => {
    expect(bodyweightFold({ bodyweightLoaded: false }, 160)).toBe(0)
    expect(bodyweightFold(null, 160)).toBe(0)
    expect(bodyweightFold(undefined, 160)).toBe(0)
  })

  it('is the bodyweight for a bodyweight-loaded exercise', () => {
    expect(bodyweightFold({ bodyweightLoaded: true }, 160)).toBe(160)
  })

  it('degrades to zero rather than guessing on an unusable bodyweight', () => {
    // Nothing captured / never tracked / corrupt — fold in nothing, exactly as
    // `effectiveSetWeight` has always done for a set with no capture.
    expect(bodyweightFold({ bodyweightLoaded: true }, undefined)).toBe(0)
    expect(bodyweightFold({ bodyweightLoaded: true }, null)).toBe(0)
    expect(bodyweightFold({ bodyweightLoaded: true }, 0)).toBe(0)
    expect(bodyweightFold({ bodyweightLoaded: true }, -160)).toBe(0)
    expect(bodyweightFold({ bodyweightLoaded: true }, NaN)).toBe(0)
  })
})

describe('addedWeightFromEffective (#1328)', () => {
  it('inverts effectiveSetWeight exactly', () => {
    const exercise = { bodyweightLoaded: true }
    const effective = effectiveSetWeight(set({ weight: 25, bodyweight: 160 }), exercise)
    expect(addedWeightFromEffective(effective, exercise, 160)).toBe(25)
  })

  it('is the identity for a normal exercise', () => {
    expect(addedWeightFromEffective(185, { bodyweightLoaded: false }, 160)).toBe(185)
    expect(addedWeightFromEffective(185)).toBe(185)
  })

  it('returns a non-positive number when bodyweight alone already covers the target', () => {
    // Real state, not an error: 12 bodyweight pull-ups beat a +25 x 5. Left
    // unclamped so callers can tell "add nothing" from "load 0".
    expect(addedWeightFromEffective(154.6, { bodyweightLoaded: true }, 160)).toBeCloseTo(-5.4, 5)
  })

  it('folds nothing back out when nothing was folded in', () => {
    // A flagged exercise on a lifter with no tracked bodyweight: both directions
    // are the identity, so a suggestion is still self-consistent.
    const exercise = { bodyweightLoaded: true }
    const effective = effectiveSetWeight(set({ weight: 25, bodyweight: undefined }), exercise)
    expect(addedWeightFromEffective(effective, exercise, undefined)).toBe(25)
  })
})
