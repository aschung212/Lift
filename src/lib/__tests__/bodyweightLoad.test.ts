import { describe, it, expect } from 'vitest'
import { effectiveLoad, effective1RM } from '../bodyweightLoad'
import { epley } from '../epley'

describe('effectiveLoad', () => {
  it('folds bodyweight into the load when the exercise is bodyweight-loaded', () => {
    expect(effectiveLoad(25, true, 180)).toBe(205)
  })

  it('credits pure-bodyweight reps (entered weight 0) with the full bodyweight', () => {
    expect(effectiveLoad(0, true, 175)).toBe(175)
  })

  it('leaves the load untouched for standard exercises', () => {
    expect(effectiveLoad(135, false, 180)).toBe(135)
    expect(effectiveLoad(135, undefined, 180)).toBe(135)
  })

  it('does not fold when no bodyweight has been logged', () => {
    expect(effectiveLoad(25, true, null)).toBe(25)
    expect(effectiveLoad(25, true, undefined)).toBe(25)
  })

  it('ignores a non-positive bodyweight rather than subtracting phantom load', () => {
    expect(effectiveLoad(25, true, 0)).toBe(25)
    expect(effectiveLoad(25, true, -50)).toBe(25)
  })
})

describe('effective1RM', () => {
  it('estimates strength from the combined load for bodyweight-loaded lifts', () => {
    // 205 lb (25 + 180) for 5 reps
    expect(effective1RM(25, 5, true, 180)).toBe(epley(205, 5))
  })

  it('gives a bodyweight rep real 1RM credit instead of zero', () => {
    expect(effective1RM(0, 8, true, 170)).toBe(epley(170, 8))
    expect(effective1RM(0, 8, true, 170)).toBeGreaterThan(0)
  })

  it('matches plain Epley for standard exercises', () => {
    expect(effective1RM(135, 5, false, 180)).toBe(epley(135, 5))
    expect(effective1RM(135, 1, undefined, null)).toBe(epley(135, 1))
  })

  it('matches plain Epley when bodyweight is unavailable even if flagged', () => {
    expect(effective1RM(45, 10, true, null)).toBe(epley(45, 10))
  })
})
