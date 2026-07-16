import { describe, it, expect } from 'vitest'
import {
  isPlainObject,
  isBoolean,
  isNumber,
  isString,
  mergeValidatedOpen,
  mergeValidatedKnown,
} from '../schema'

describe('schema guards', () => {
  describe('isPlainObject', () => {
    it('accepts a plain object', () => {
      expect(isPlainObject({})).toBe(true)
      expect(isPlainObject({ a: 1 })).toBe(true)
    })
    it('rejects arrays, null, and primitives', () => {
      expect(isPlainObject([])).toBe(false)
      expect(isPlainObject(null)).toBe(false)
      expect(isPlainObject('x')).toBe(false)
      expect(isPlainObject(3)).toBe(false)
      expect(isPlainObject(undefined)).toBe(false)
    })
  })

  describe('scalar guards', () => {
    it('isBoolean only accepts booleans', () => {
      expect(isBoolean(true)).toBe(true)
      expect(isBoolean(false)).toBe(true)
      expect(isBoolean('true')).toBe(false)
      expect(isBoolean(1)).toBe(false)
      expect(isBoolean(null)).toBe(false)
    })
    it('isNumber accepts finite numbers only', () => {
      expect(isNumber(0)).toBe(true)
      expect(isNumber(-2.5)).toBe(true)
      expect(isNumber(NaN)).toBe(false)
      expect(isNumber(Infinity)).toBe(false)
      expect(isNumber('5')).toBe(false)
    })
    it('isString only accepts strings', () => {
      expect(isString('')).toBe(true)
      expect(isString(0)).toBe(false)
    })
  })

  describe('mergeValidatedOpen', () => {
    const defaults = { workouts: true, calendar: true, weight: true }

    it('returns a copy of defaults when raw is not an object', () => {
      expect(mergeValidatedOpen(defaults, null, isBoolean)).toEqual(defaults)
      expect(mergeValidatedOpen(defaults, 'x', isBoolean)).toEqual(defaults)
      expect(mergeValidatedOpen(defaults, [], isBoolean)).toEqual(defaults)
    })

    it('does not mutate defaults or raw', () => {
      const raw = { calendar: false }
      const result = mergeValidatedOpen(defaults, raw, isBoolean)
      expect(result).not.toBe(defaults)
      expect(defaults.calendar).toBe(true)
      expect(raw).toEqual({ calendar: false })
    })

    it('overrides defaults with valid values', () => {
      const result = mergeValidatedOpen(defaults, { calendar: false }, isBoolean)
      expect(result).toEqual({ workouts: true, calendar: false, weight: true })
    })

    it('keeps forward-compatible unknown keys whose value validates', () => {
      const result = mergeValidatedOpen(defaults, { nutrition: false }, isBoolean)
      expect(result.nutrition).toBe(false)
    })

    it('drops keys whose value fails validation (injection guard)', () => {
      const result = mergeValidatedOpen(
        defaults,
        { calendar: 'hacked', weight: 1, evil: { drop: 'table' } },
        isBoolean,
      )
      // Non-boolean values are rejected — defaults stand for known keys
      expect(result.calendar).toBe(true)
      expect(result.weight).toBe(true)
      // Non-boolean unknown key is not injected
      expect('evil' in result).toBe(false)
    })
  })

  describe('mergeValidatedKnown', () => {
    const defaults = { prCelebrations: true, haptics: true }

    it('returns a copy of defaults when raw is not an object', () => {
      expect(mergeValidatedKnown(defaults, undefined, isBoolean)).toEqual(defaults)
      expect(mergeValidatedKnown(defaults, [1, 2], isBoolean)).toEqual(defaults)
    })

    it('only copies known keys with valid values', () => {
      const result = mergeValidatedKnown(defaults, { haptics: false }, isBoolean)
      expect(result).toEqual({ prCelebrations: true, haptics: false })
    })

    it('ignores unknown keys so junk cannot accrete onto a typed shape', () => {
      const result = mergeValidatedKnown(
        defaults,
        { haptics: false, __proto__polluter: true, extra: 5 },
        isBoolean,
      )
      expect(result).toEqual({ prCelebrations: true, haptics: false })
      expect('extra' in result).toBe(false)
    })

    it('rejects wrong-typed known values, keeping the default', () => {
      const result = mergeValidatedKnown(defaults, { haptics: 'nope' }, isBoolean)
      expect(result.haptics).toBe(true)
    })

    it('validates numeric shapes with isNumber', () => {
      const filterDefaults = { warmupThreshold: 0.75 }
      expect(mergeValidatedKnown(filterDefaults, { warmupThreshold: 0.6 }, isNumber))
        .toEqual({ warmupThreshold: 0.6 })
      // Non-finite / wrong-typed value rejected
      expect(mergeValidatedKnown(filterDefaults, { warmupThreshold: 'high' }, isNumber))
        .toEqual({ warmupThreshold: 0.75 })
    })
  })
})
