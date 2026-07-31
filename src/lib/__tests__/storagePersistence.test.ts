/**
 * Tests for storagePersistence.ts (LIFT-1063).
 *
 * The module turns the boolean `navigator.storage.persist()` returns — which
 * App.vue previously discarded — into a single decision about whether to warn a
 * user that their local-first workout data is evictable. The gate is pure so all
 * branches are covered here without a DOM.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  shouldWarnStorageEviction,
  isPersistenceSupported,
  hasLocalUserData,
  type StorageEvictionInput,
} from '../storagePersistence'

const base: StorageEvictionInput = {
  supported: true,
  persisted: false,
  standalone: false,
  hasLocalData: true,
  dismissed: false,
}

describe('shouldWarnStorageEviction', () => {
  it('warns when persistence is denied, data exists, not installed, not dismissed', () => {
    expect(shouldWarnStorageEviction(base)).toBe(true)
  })

  it('never warns when the persistence API is unsupported (a false result is meaningless)', () => {
    expect(shouldWarnStorageEviction({ ...base, supported: false })).toBe(false)
  })

  it('does not warn when persistence was granted', () => {
    expect(shouldWarnStorageEviction({ ...base, persisted: true })).toBe(false)
  })

  it('does not warn in an installed (standalone) PWA — the install nudge is moot', () => {
    expect(shouldWarnStorageEviction({ ...base, standalone: true })).toBe(false)
  })

  it('does not warn when there is no local data worth protecting', () => {
    expect(shouldWarnStorageEviction({ ...base, hasLocalData: false })).toBe(false)
  })

  it('stays hidden once the user has dismissed it', () => {
    expect(shouldWarnStorageEviction({ ...base, dismissed: true })).toBe(false)
  })
})

describe('isPersistenceSupported', () => {
  const originalNavigator = globalThis.navigator

  afterEach(() => {
    vi.stubGlobal('navigator', originalNavigator)
  })

  it('is true when navigator.storage.persist is a function', () => {
    vi.stubGlobal('navigator', { storage: { persist: () => Promise.resolve(true) } })
    expect(isPersistenceSupported()).toBe(true)
  })

  it('is false when the Storage API is absent', () => {
    vi.stubGlobal('navigator', {})
    expect(isPersistenceSupported()).toBe(false)
  })

  it('is false when persist is not a function', () => {
    vi.stubGlobal('navigator', { storage: {} })
    expect(isPersistenceSupported()).toBe(false)
  })
})

describe('hasLocalUserData', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('is false when no workout or bodyweight data is stored', () => {
    expect(hasLocalUserData()).toBe(false)
  })

  it('is false when the stored arrays are empty', () => {
    localStorage.setItem('workout-exercises', '[]')
    localStorage.setItem('bodyweight-entries', '[]')
    expect(hasLocalUserData()).toBe(false)
  })

  it('is true when workout data exists', () => {
    localStorage.setItem('workout-exercises', JSON.stringify([{ id: '1', name: 'Bench', sets: [] }]))
    expect(hasLocalUserData()).toBe(true)
  })

  it('is true when bodyweight data exists', () => {
    localStorage.setItem('bodyweight-entries', JSON.stringify([{ date: '2026-07-30', weight: 180 }]))
    expect(hasLocalUserData()).toBe(true)
  })

  it('is false (not thrown) when the stored value is corrupt JSON', () => {
    localStorage.setItem('workout-exercises', '{not json')
    expect(hasLocalUserData()).toBe(false)
  })

  it('is false when the stored value is not an array', () => {
    localStorage.setItem('workout-exercises', JSON.stringify({ nope: true }))
    expect(hasLocalUserData()).toBe(false)
  })
})
