import { describe, it, expect } from 'vitest'
import { sanitizeTargetE1RM, MAX_WEIGHT } from '../inputLimits'

describe('sanitizeTargetE1RM (LIFT-1035)', () => {
  it('passes through a valid positive weight', () => {
    expect(sanitizeTargetE1RM(225)).toBe(225)
  })

  it('rounds to one decimal place', () => {
    expect(sanitizeTargetE1RM(225.06)).toBe(225.1)
  })

  it('coerces a numeric string', () => {
    expect(sanitizeTargetE1RM('275')).toBe(275)
  })

  it('clamps above the max weight', () => {
    expect(sanitizeTargetE1RM(999999)).toBe(MAX_WEIGHT)
  })

  it('returns null for zero, negatives, and non-finite values', () => {
    expect(sanitizeTargetE1RM(0)).toBeNull()
    expect(sanitizeTargetE1RM(-50)).toBeNull()
    expect(sanitizeTargetE1RM(NaN)).toBeNull()
    expect(sanitizeTargetE1RM(Infinity)).toBeNull()
  })

  it('returns null for non-numeric input', () => {
    expect(sanitizeTargetE1RM('heavy')).toBeNull()
    expect(sanitizeTargetE1RM(null)).toBeNull()
    expect(sanitizeTargetE1RM(undefined)).toBeNull()
    expect(sanitizeTargetE1RM({})).toBeNull()
  })
})
