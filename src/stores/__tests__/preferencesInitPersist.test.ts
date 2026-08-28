/**
 * LIFT-1243 — `init()` must re-persist an adopted remote row through the single
 * persist path instead of hand-building a second copy of the payload.
 *
 * The store used to serialize the payload in TWO places: `_persist()` (canonical)
 * and, inline in `init()`, a byte-identical literal written straight to
 * localStorage + the IDB mirror. Two consequences, both silent:
 *
 *  1. Drift. Adding a synced preference meant remembering both literals; forget
 *     the `init()` one and the field was dropped from localStorage on any launch
 *     where the remote row was adopted — invisible until the next cold start read
 *     it back as its default.
 *  2. Skipped side effects. The inline write bypassed the FOUC mirror keys
 *     (`app-theme` and friends), the cross-tab broadcast, and the guarded
 *     localStorage write. The FOUC one is user-visible: main.ts applies
 *     `app-theme` to the DOM before Pinia exists, so a remote theme adopted at
 *     sign-in flashed the PREVIOUS theme on every subsequent cold start until
 *     some unrelated setting change happened to call `_persist()`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

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

vi.mock('../../lib/crossTabSync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/crossTabSync')>()),
  broadcastStoreUpdate: vi.fn(),
}))

import { usePreferencesStore } from '../preferences'
import { backupToIDB } from '../../lib/durableStorage'
import { broadcastStoreUpdate } from '../../lib/crossTabSync'
import { syncQueue } from '../../lib/syncQueue'

/** A complete remote row — `features` is the gate init() checks before adopting. */
const REMOTE_ROW = {
  features: { workouts: true, calendar: false, weight: true },
  theme: 'water',
  colorMode: 'light',
  weightUnit: 'kg',
  restTimerEnabled: false,
  restTimerAutoStart: false,
  appIcon: 'mono',
  gyms: ['Remote Gym'],
  intensityPresets: [60, 80],
  prBaselineDate: '2026-01-15',
}

function storedBlob(): Record<string, unknown> {
  return JSON.parse(localStorageMock.getItem('user-preferences')!)
}

describe('LIFT-1243 preferences init() persists through the single write path', () => {
  beforeEach(() => {
    localStorageMock.clear()
    mockRemotePreferences = null
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('writes the SAME payload shape after a remote adopt as _persist() does', async () => {
    // The drift guard: whatever `_persist()` considers the payload, the
    // post-remote-adopt rewrite must carry field-for-field. A future synced
    // preference added to only one of the two write sites fails here.
    mockRemotePreferences = REMOTE_ROW
    const store = usePreferencesStore()
    await store.init('test-user')
    const afterRemoteAdopt = Object.keys(storedBlob()).sort()

    localStorageMock.clear()
    store._persist()
    const afterPersist = Object.keys(storedBlob()).sort()

    expect(afterRemoteAdopt).toEqual(afterPersist)
    // And the adopted values actually round-trip, not just the key names.
    expect(storedBlob()).toEqual({
      ...REMOTE_ROW,
      // Fields the remote row omits still come from state, at their defaults.
      weightGoal: expect.any(Object),
      experience: expect.any(Object),
      filters: expect.any(Object),
      coachProfile: expect.any(Object),
    })
  })

  it('updates the FOUC mirror keys so the next cold start boots the adopted theme', async () => {
    // Pre-existing local values from the previous session on this device.
    localStorageMock.setItem('app-theme', 'eternal')
    localStorageMock.setItem('app-mode', 'dark')
    localStorageMock.setItem('weight-unit', 'lbs')
    localStorageMock.setItem('rest-timer', 'on')
    localStorageMock.setItem('rest-timer-autostart', 'on')
    mockRemotePreferences = REMOTE_ROW

    const store = usePreferencesStore()
    await store.init('test-user')

    expect(store.theme).toBe('water')
    // main.ts's pre-Pinia bootstrap reads these — stale values mean a flash of
    // the previous theme on every launch.
    expect(localStorageMock.getItem('app-theme')).toBe('water')
    expect(localStorageMock.getItem('app-mode')).toBe('light')
    expect(localStorageMock.getItem('weight-unit')).toBe('kg')
    expect(localStorageMock.getItem('rest-timer')).toBe('off')
    expect(localStorageMock.getItem('rest-timer-autostart')).toBe('off')
  })

  it('mirrors the adopted payload to IndexedDB and notifies other tabs', async () => {
    mockRemotePreferences = REMOTE_ROW

    const store = usePreferencesStore()
    await store.init('test-user')

    expect(backupToIDB).toHaveBeenCalledWith(
      'user-preferences',
      expect.stringContaining('"theme":"water"'),
    )
    expect(broadcastStoreUpdate).toHaveBeenCalledWith('preferences')
  })

  it('does not write the just-fetched row back to the server', async () => {
    // The local re-persist is deliberately upsert-free: echoing the fetched row
    // back at launch would burn a write and open a window to clobber a change
    // another device made between our fetch and our flush.
    mockRemotePreferences = REMOTE_ROW

    const store = usePreferencesStore()
    await store.init('test-user')

    expect(syncQueue.enqueue).not.toHaveBeenCalled()

    // A genuine user change still syncs.
    store.setTheme('fire')
    expect(syncQueue.enqueue).toHaveBeenCalledWith('preferences:test-user', expect.any(Function))
  })

  it('leaves local state and storage untouched when there is no remote row', async () => {
    localStorageMock.setItem('user-preferences', JSON.stringify({
      features: { workouts: true, calendar: true, weight: true },
      theme: 'fire',
    }))
    mockRemotePreferences = null

    setActivePinia(createPinia())
    const store = usePreferencesStore()
    await store.init('test-user')

    expect(store.theme).toBe('fire')
    expect(storedBlob().theme).toBe('fire')
  })
})
