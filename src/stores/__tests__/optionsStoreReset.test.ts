/**
 * Integration test: the options stores (bodyweight, progression, preferences)
 * clear BOTH in-memory state and localStorage on $reset — on a real Pinia
 * instance, not mocked.
 *
 * Regression for LIFT-818: these are options stores whose Pinia-provided
 * $reset() re-invokes the state factory. bodyweight/progression factories call
 * load(), which reads the PREVIOUS user's data straight back out of the
 * still-populated localStorage; preferences returns to defaults in memory but
 * leaves the prior user's blob on disk. On a shared device that stale local data
 * is then merged into the NEXT user's Supabase account by _fetchFromSupabase.
 *
 * The fix overrides $reset() in each store to clear state, drop _userId, and
 * persist the empty/default state — mirroring the workout store's hand-rolled
 * reset. These tests verify that contract directly.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

vi.mock('../../lib/supabase', () => ({
  supabase: null,
  isPreviewMode: { value: false },
}))
vi.mock('../../lib/syncQueue', () => ({
  syncQueue: { enqueue: vi.fn(), enqueueDelete: vi.fn(), clear: vi.fn() },
}))
vi.mock('../../lib/durableStorage', () => ({
  backupToIDB: vi.fn(),
}))

describe('bodyweight store $reset (real Pinia, not mocked)', () => {
  beforeEach(() => {
    localStorageMock.clear()
    setActivePinia(createPinia())
  })

  it('clears entries in memory and overwrites localStorage', async () => {
    const { useBodyweightStore } = await import('../bodyweight')
    const store = useBodyweightStore()

    store.addEntry(180, '2026-06-01')
    expect(store.entries.length).toBeGreaterThan(0)
    expect(JSON.parse(localStorage.getItem('bodyweight-entries') || '[]').length).toBeGreaterThan(0)

    store.$reset()

    expect(store.entries).toEqual([])
    expect(JSON.parse(localStorage.getItem('bodyweight-entries') || '[]')).toEqual([])
  })

  it('does NOT re-read the previous user data when a new store instance loads', async () => {
    const { useBodyweightStore } = await import('../bodyweight')
    const user1 = useBodyweightStore()
    user1.addEntry(200, '2026-06-02')
    user1.$reset()

    // Simulate the next user signing in on a shared device: a fresh Pinia
    // instance re-runs the state factory (load()) against localStorage.
    setActivePinia(createPinia())
    const user2 = useBodyweightStore()
    expect(user2.entries).toEqual([])
  })
})

describe('progression store $reset (real Pinia, not mocked)', () => {
  beforeEach(() => {
    localStorageMock.clear()
    setActivePinia(createPinia())
  })

  it('restores defaults in memory and overwrites localStorage', async () => {
    const { useProgressionStore } = await import('../progression')
    const store = useProgressionStore()

    store.logSetXP('set-1', 5000)
    store.setStarterTheme('fire')
    expect(store.totalXP).toBeGreaterThan(0)
    expect(store.starterTheme).toBe('fire')

    store.$reset()

    expect(store.totalXP).toBe(0)
    expect(store.starterTheme).toBeNull()
    expect(store.xpPerSet).toEqual({})
    const persisted = JSON.parse(localStorage.getItem('user-progression') || '{}')
    expect(persisted.totalXP).toBe(0)
    expect(persisted.starterTheme).toBeNull()
    expect(persisted.xpPerSet).toEqual({})
  })

  it('does NOT re-read the previous user XP when a new store instance loads', async () => {
    const { useProgressionStore } = await import('../progression')
    const user1 = useProgressionStore()
    user1.logSetXP('set-1', 1234)
    user1.$reset()

    setActivePinia(createPinia())
    const user2 = useProgressionStore()
    expect(user2.totalXP).toBe(0)
    expect(user2.xpPerSet).toEqual({})
  })
})

describe('preferences store $reset (real Pinia, not mocked)', () => {
  beforeEach(() => {
    localStorageMock.clear()
    setActivePinia(createPinia())
  })

  it('restores defaults in memory and overwrites the persisted blob + legacy keys', async () => {
    const { usePreferencesStore } = await import('../preferences')
    const store = usePreferencesStore()

    store.setTheme('fire')
    store.setColorMode('light')
    store.setWeightUnit('kg')
    store.setRestTimer(false)
    expect(store.theme).toBe('fire')

    store.$reset()

    expect(store.theme).toBe('eternal')
    expect(store.colorMode).toBe('dark')
    expect(store.weightUnit).toBe('lbs')
    expect(store.restTimerEnabled).toBe(true)

    // Legacy individual keys (read pre-Pinia for FOUC prevention) reset too.
    expect(localStorage.getItem('app-theme')).toBe('eternal')
    expect(localStorage.getItem('app-mode')).toBe('dark')
    expect(localStorage.getItem('weight-unit')).toBe('lbs')
    expect(localStorage.getItem('rest-timer')).toBe('on')

    const blob = JSON.parse(localStorage.getItem('user-preferences') || '{}')
    expect(blob.theme).toBe('eternal')
  })

  it('does NOT re-read the previous user preferences when a new store instance loads', async () => {
    const { usePreferencesStore } = await import('../preferences')
    const user1 = usePreferencesStore()
    user1.setTheme('water')
    user1.$reset()

    setActivePinia(createPinia())
    const user2 = usePreferencesStore()
    // init() reads localStorage; the blob was reset to the default theme.
    await user2.init('user-2')
    expect(user2.theme).toBe('eternal')
  })
})
