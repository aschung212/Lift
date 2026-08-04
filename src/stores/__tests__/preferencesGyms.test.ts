/**
 * #961 — the synced gym list in the preferences blob.
 *
 * Covers the list CRUD setters (sanitize/dedupe/cap), all three load sites
 * (init local, init remote, _reloadFromStorage), the persist payload, and —
 * the highest-risk line of the feature — the post-remote-fetch re-serialization
 * blob: if `gyms` is missing there, every remote fetch silently wipes
 * locally-added gyms from localStorage.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'
import { MAX_GYMS } from '../../lib/gyms'

const localStorageMock = getLocalStorageMock()

// Configurable remote user_preferences row for the remote-init tests.
let mockRemotePreferences: Record<string, unknown> | null = null

vi.mock('../../lib/supabase', () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    single: () =>
      Promise.resolve(
        mockRemotePreferences
          ? { data: { preferences: mockRemotePreferences }, error: null }
          : { data: null, error: { code: 'PGRST116' } },
      ),
    upsert: () => Promise.resolve({ error: null }),
  }
  return {
    supabase: { from: () => chain },
    isPreviewMode: { value: false },
  }
})

vi.mock('../../lib/syncQueue', () => ({
  syncQueue: { enqueue: vi.fn(), enqueueDelete: vi.fn(), clear: vi.fn(), rehydrate: vi.fn() },
}))

vi.mock('../../lib/durableStorage', () => ({
  backupToIDB: vi.fn(),
}))

import { usePreferencesStore } from '../preferences'

describe('#961 synced gym list', () => {
  let store: ReturnType<typeof usePreferencesStore>

  beforeEach(() => {
    localStorageMock.clear()
    mockRemotePreferences = null
    vi.clearAllMocks()
    setActivePinia(createPinia())
    store = usePreferencesStore()
  })

  describe('defaults and setters', () => {
    it('defaults to no gyms', () => {
      expect(store.gyms).toEqual([])
    })

    it('setGyms sanitizes (trim + dedupe + cap) and persists', () => {
      store.setGyms([' Gym A ', 'Gym A', '', 'Gym B'])
      expect(store.gyms).toEqual(['Gym A', 'Gym B'])
      const stored = JSON.parse(localStorageMock.getItem('user-preferences')!)
      expect(stored.gyms).toEqual(['Gym A', 'Gym B'])
    })

    it('addGym trims, rejects duplicates, and enforces the cap', () => {
      expect(store.addGym('  Gym A ')).toBe('Gym A')
      expect(store.addGym('Gym A')).toBeNull()
      expect(store.addGym('   ')).toBeNull()
      expect(store.gyms).toEqual(['Gym A'])

      for (let i = 1; i < MAX_GYMS; i++) store.addGym(`Gym ${i}`)
      expect(store.gyms).toHaveLength(MAX_GYMS)
      expect(store.addGym('One Too Many')).toBeNull()
      expect(store.gyms).toHaveLength(MAX_GYMS)
    })

    it('renameGym renames in place and preserves order', () => {
      store.setGyms(['Gym A', 'Gym B', 'Gym C'])
      expect(store.renameGym('Gym B', ' Iron Temple ')).toBe('Iron Temple')
      expect(store.gyms).toEqual(['Gym A', 'Iron Temple', 'Gym C'])
    })

    it('renameGym rejects a missing source, a taken target, and blank names', () => {
      store.setGyms(['Gym A', 'Gym B'])
      expect(store.renameGym('Nope', 'X')).toBeNull()
      expect(store.renameGym('Gym A', 'Gym B')).toBeNull()
      expect(store.renameGym('Gym A', '  ')).toBeNull()
      expect(store.renameGym('Gym A', 'Gym A')).toBe('Gym A')
      expect(store.gyms).toEqual(['Gym A', 'Gym B'])
    })

    it('removeGym removes only the named gym', () => {
      store.setGyms(['Gym A', 'Gym B'])
      store.removeGym('Gym A')
      expect(store.gyms).toEqual(['Gym B'])
      store.removeGym('Not There')
      expect(store.gyms).toEqual(['Gym B'])
    })
  })

  describe('load sites', () => {
    it('init loads + sanitizes gyms from the local blob', async () => {
      localStorageMock.setItem('user-preferences', JSON.stringify({
        features: { workouts: true, calendar: true, weight: true },
        gyms: [' Gym A ', 'Gym A', 'Gym B'],
      }))

      setActivePinia(createPinia())
      const freshStore = usePreferencesStore()
      await freshStore.init('test-user')

      expect(freshStore.gyms).toEqual(['Gym A', 'Gym B'])
    })

    it('_reloadFromStorage picks up gyms (cross-tab sync)', () => {
      localStorageMock.setItem('user-preferences', JSON.stringify({
        features: { workouts: true, calendar: true, weight: true },
        gyms: ['Gym A'],
      }))

      store._reloadFromStorage()

      expect(store.gyms).toEqual(['Gym A'])
    })

    it('init reads gyms from the remote blob', async () => {
      mockRemotePreferences = {
        features: { workouts: true, calendar: true, weight: true },
        gyms: ['Remote Gym'],
      }

      setActivePinia(createPinia())
      const freshStore = usePreferencesStore()
      await freshStore.init('test-user')

      expect(freshStore.gyms).toEqual(['Remote Gym'])
    })

    it('remote re-serialization keeps local gyms when the remote blob lacks them', async () => {
      // A pre-#961 remote blob (no gyms key) must not wipe locally-created
      // gyms: init writes a re-serialized "synced" blob to localStorage, and
      // gyms has to be part of that rewrite.
      localStorageMock.setItem('user-preferences', JSON.stringify({
        features: { workouts: true, calendar: true, weight: true },
        gyms: ['Local Gym'],
      }))
      mockRemotePreferences = {
        features: { workouts: true, calendar: true, weight: true },
      }

      setActivePinia(createPinia())
      const freshStore = usePreferencesStore()
      await freshStore.init('test-user')

      expect(freshStore.gyms).toEqual(['Local Gym'])
      const rewritten = JSON.parse(localStorageMock.getItem('user-preferences')!)
      expect(rewritten.gyms).toEqual(['Local Gym'])
    })
  })

  describe('persist payload', () => {
    it('includes gyms in the synced blob alongside existing fields', () => {
      store.setGyms(['Gym A'])
      store.setIntensityPresets([60, 80])

      const stored = JSON.parse(localStorageMock.getItem('user-preferences')!)
      expect(stored.gyms).toEqual(['Gym A'])
      expect(stored.intensityPresets).toEqual([60, 80])
      expect(stored.features).toBeDefined()
    })

    it('$reset clears the gym list (sign-out on a shared device)', () => {
      store.setGyms(['Gym A'])
      store.$reset()
      expect(store.gyms).toEqual([])
    })
  })
})
