/**
 * #961 — per-gym exercise filtering domain logic.
 *
 * Pins the filter semantics (the load-bearing rule: degradation is always
 * "too visible", never "hidden"), the sanitizers guarding every storage/sync
 * boundary, and the device-local active-filter persistence helpers.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { getLocalStorageMock } from '../../__tests__/helpers'
import {
  MAX_GYMS,
  GYM_NAME_MAX_LENGTH,
  ACTIVE_GYM_STORAGE_KEY,
  sanitizeGymName,
  sanitizeGymList,
  sanitizeExerciseGyms,
  matchesGymFilter,
  loadActiveGymFilter,
  saveActiveGymFilter,
} from '../gyms'

const localStorageMock = getLocalStorageMock()

describe('sanitizeGymName', () => {
  it('trims whitespace', () => {
    expect(sanitizeGymName('  Gym A  ')).toBe('Gym A')
  })

  it('rejects empty and non-string values', () => {
    expect(sanitizeGymName('')).toBeNull()
    expect(sanitizeGymName('   ')).toBeNull()
    expect(sanitizeGymName(42)).toBeNull()
    expect(sanitizeGymName(null)).toBeNull()
    expect(sanitizeGymName(undefined)).toBeNull()
    expect(sanitizeGymName(['Gym A'])).toBeNull()
  })

  it('clamps to GYM_NAME_MAX_LENGTH', () => {
    const long = 'x'.repeat(GYM_NAME_MAX_LENGTH + 20)
    expect(sanitizeGymName(long)).toBe('x'.repeat(GYM_NAME_MAX_LENGTH))
  })

  it('re-trims after clamping so a cut at a space cannot leave a trailing space', () => {
    const name = 'y'.repeat(GYM_NAME_MAX_LENGTH - 1) + ' z'
    expect(sanitizeGymName(name)).toBe('y'.repeat(GYM_NAME_MAX_LENGTH - 1))
  })
})

describe('sanitizeGymList', () => {
  it('passes a clean list through', () => {
    expect(sanitizeGymList(['Gym A', 'Gym B'])).toEqual(['Gym A', 'Gym B'])
  })

  it('degrades non-array input to []', () => {
    expect(sanitizeGymList('Gym A')).toEqual([])
    expect(sanitizeGymList({ 0: 'Gym A' })).toEqual([])
    expect(sanitizeGymList(null)).toEqual([])
    expect(sanitizeGymList(undefined)).toEqual([])
  })

  it('drops invalid entries and dedupes', () => {
    expect(sanitizeGymList(['Gym A', '', 7, 'Gym A', '  Gym A ', 'Gym B'])).toEqual(['Gym A', 'Gym B'])
  })

  it('caps at MAX_GYMS', () => {
    const many = Array.from({ length: MAX_GYMS + 5 }, (_, i) => `Gym ${i}`)
    expect(sanitizeGymList(many)).toHaveLength(MAX_GYMS)
  })
})

describe('sanitizeExerciseGyms', () => {
  it('sanitizes entries like the list sanitizer', () => {
    expect(sanitizeExerciseGyms([' Gym A ', 3, 'Gym A'])).toEqual(['Gym A'])
    expect(sanitizeExerciseGyms('nope')).toEqual([])
  })

  it('does not cap membership references (orphaned names are legal)', () => {
    const many = Array.from({ length: MAX_GYMS + 2 }, (_, i) => `Gym ${i}`)
    expect(sanitizeExerciseGyms(many)).toHaveLength(MAX_GYMS + 2)
  })
})

describe('matchesGymFilter', () => {
  const known = ['Gym A', 'Gym B']

  it('passes everything when no gym filter is active', () => {
    expect(matchesGymFilter(['Gym A'], null, known)).toBe(true)
    expect(matchesGymFilter([], null, known)).toBe(true)
    expect(matchesGymFilter(undefined, null, known)).toBe(true)
  })

  it('passes unassigned exercises under every gym (empty/undefined = everywhere)', () => {
    expect(matchesGymFilter(undefined, 'Gym A', known)).toBe(true)
    expect(matchesGymFilter([], 'Gym A', known)).toBe(true)
  })

  it('matches an exercise assigned to the active gym', () => {
    expect(matchesGymFilter(['Gym A'], 'Gym A', known)).toBe(true)
    expect(matchesGymFilter(['Gym B', 'Gym A'], 'Gym A', known)).toBe(true)
  })

  it('excludes an exercise assigned only to other gyms', () => {
    expect(matchesGymFilter(['Gym B'], 'Gym A', known)).toBe(false)
  })

  it('treats fully-orphaned membership as unassigned (rename/delete race safety net)', () => {
    // "Old Name" was renamed/removed on another device — the exercise must
    // degrade to visible-everywhere, never silently hidden.
    expect(matchesGymFilter(['Old Name'], 'Gym A', known)).toBe(true)
  })

  it('ignores orphaned entries when a live one remains', () => {
    expect(matchesGymFilter(['Old Name', 'Gym B'], 'Gym A', known)).toBe(false)
    expect(matchesGymFilter(['Old Name', 'Gym A'], 'Gym A', known)).toBe(true)
  })
})

describe('active gym filter persistence (device-local)', () => {
  beforeEach(() => {
    localStorageMock.clear()
  })

  it('round-trips a saved filter', () => {
    saveActiveGymFilter('Gym A')
    expect(loadActiveGymFilter()).toBe('Gym A')
  })

  it('clears the key when saving null', () => {
    saveActiveGymFilter('Gym A')
    saveActiveGymFilter(null)
    expect(localStorageMock.getItem(ACTIVE_GYM_STORAGE_KEY)).toBeNull()
    expect(loadActiveGymFilter()).toBeNull()
  })

  it('returns null for corrupt storage instead of throwing', () => {
    localStorageMock.setItem(ACTIVE_GYM_STORAGE_KEY, '{not json')
    expect(loadActiveGymFilter()).toBeNull()
    localStorageMock.setItem(ACTIVE_GYM_STORAGE_KEY, JSON.stringify(['array']))
    expect(loadActiveGymFilter()).toBeNull()
    localStorageMock.setItem(ACTIVE_GYM_STORAGE_KEY, JSON.stringify('   '))
    expect(loadActiveGymFilter()).toBeNull()
  })
})
