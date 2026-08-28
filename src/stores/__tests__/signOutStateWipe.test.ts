/**
 * Regression: sign-out must WIPE the options stores — memory AND persisted
 * payload — not "reset" them back to the signed-out user's data.
 *
 * Pinia's built-in options-store $reset re-runs the state() factory. The
 * bodyweight and progression factories hydrate via load() from localStorage,
 * so on a shared device the built-in $reset "reset" the store straight back
 * to the previous user's data — and because sign-out never cleared the
 * persisted payloads, two paths then pushed that data into the NEXT account
 * to sign in:
 *   - bodyweight: migrateLocalStorageToSupabase reads `bodyweight-entries`
 *     and inserts it into any empty account (the new-account-on-a-shared-
 *     device case);
 *   - progression: a fresh account's first fetch hits PGRST116 (no row) and
 *     _syncToSupabase pushes the in-memory state — the previous user's
 *     XP/streaks/unlocks — into the new user's row.
 * Preferences' factory is pure defaults, but its persisted payload survived
 * and init() "loads from localStorage first", so the next account inherited
 * the previous user's coach profile (sex/age/injuries), gyms, and settings.
 *
 * The workout store was never affected: its hand-written $reset zeroes state
 * and persists the cleared payload. These tests pin the same contract onto
 * the three options stores' $reset overrides.
 *
 * Why existing tests missed it: useAuth.test.ts mocks every store ($reset is
 * a vi.fn()), and the per-store suites never populated localStorage before
 * calling $reset — with an empty storage mock, the built-in factory re-run
 * looks identical to a real wipe. These tests seed state through real
 * actions (so localStorage matches production) and run under production
 * NODE_ENV semantics, since Pinia branches on it at store creation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

// A truthy supabase client (not null) so the enqueue guards are decided by
// `_userId` — the thing $reset must null BEFORE persisting — rather than
// short-circuiting on a missing client and passing vacuously. The only query
// that actually runs in these tests is preferences init()'s single(), which
// answers like a fresh account (PGRST116 = no row).
const { mockEnqueue, mockEnqueueDelete } = vi.hoisted(() => ({
  mockEnqueue: vi.fn(),
  mockEnqueueDelete: vi.fn(),
}))
vi.mock('../../lib/supabase', () => {
  const query: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'is', 'order', 'range', 'update', 'upsert', 'insert', 'delete']) {
    query[m] = vi.fn(() => query)
  }
  query.single = vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } })
  return {
    supabase: { from: vi.fn(() => query) },
    isPreviewMode: { value: false },
  }
})
vi.mock('../../lib/syncQueue', () => ({
  syncQueue: {
    enqueue: (...args: unknown[]) => mockEnqueue(...args),
    enqueueDelete: (...args: unknown[]) => mockEnqueueDelete(...args),
    clear: vi.fn(),
  },
}))
vi.mock('../../lib/durableStorage', () => ({
  backupToIDB: vi.fn(),
}))

beforeEach(() => {
  localStorageMock.clear()
  mockEnqueue.mockClear()
  mockEnqueueDelete.mockClear()
  // Pinia reads NODE_ENV at store creation; production is where the failure
  // mode is silent, so that's the semantics these tests run under.
  vi.stubEnv('NODE_ENV', 'production')
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('bodyweight $reset (sign-out wipe)', () => {
  it('wipes entries from memory instead of re-hydrating the signed-out user from localStorage', async () => {
    const { useBodyweightStore } = await import('../bodyweight')
    const store = useBodyweightStore()
    store._userId = 'user-a'

    store.addEntry(185.5, '2026-08-15')
    store.addEntry(184.8, '2026-08-16')
    expect(store.entries.length).toBe(2)
    // The persisted payload exists — exactly what the built-in $reset would
    // re-read via the state() factory's load().
    expect(JSON.parse(localStorage.getItem('bodyweight-entries')!).length).toBe(2)

    store.$reset()

    expect(store.entries).toEqual([])
    expect(store._userId).toBeNull()
    expect(store.syncing).toBe(false)
    expect(store.lastSyncError).toBeNull()
  })

  it('clears the persisted payload that migrateLocalStorageToSupabase would push into the next empty account', async () => {
    const { useBodyweightStore } = await import('../bodyweight')
    const store = useBodyweightStore()

    store.addEntry(185.5, '2026-08-15')
    store.$reset()

    expect(JSON.parse(localStorage.getItem('bodyweight-entries') || 'null')).toEqual([])
  })

  it('enqueues nothing during the wipe (sign-out must never touch the account\'s cloud rows)', async () => {
    const { useBodyweightStore } = await import('../bodyweight')
    const store = useBodyweightStore()
    store._userId = 'user-a'
    store.addEntry(185.5, '2026-08-15')
    // Baseline: with a user and a client, mutations do enqueue — so the
    // assertion below can't pass vacuously.
    expect(mockEnqueue).toHaveBeenCalled()

    mockEnqueue.mockClear()
    mockEnqueueDelete.mockClear()
    store.$reset()

    expect(mockEnqueue).not.toHaveBeenCalled()
    expect(mockEnqueueDelete).not.toHaveBeenCalled()
  })
})

describe('progression $reset (sign-out wipe)', () => {
  it('wipes XP/streak/unlock state to defaults — what a fresh account\'s PGRST116 push would sync', async () => {
    const { useProgressionStore } = await import('../progression')
    const store = useProgressionStore()

    store.logSetXP('set-1', 50)
    store.logSetXP('set-2', 25)
    expect(store.totalXP).toBe(75)
    expect(Object.keys(store.xpPerSet).length).toBe(2)

    store.$reset()

    expect(store.totalXP).toBe(0)
    expect(store.streakWeeks).toBe(0)
    // Object-form $patch would deep-merge this map and keep the old user's
    // keys; the wipe must replace it wholesale.
    expect(store.xpPerSet).toEqual({})
    expect(store.streakHistory).toEqual([])
    expect(store.starterTheme).toBeNull()
    expect(store.unlockedThemes.map(t => t.id)).toEqual(['pearl'])
    expect(store._userId).toBeNull()
  })

  it('clears the persisted payload so the state() factory cannot re-hydrate the previous user', async () => {
    const { useProgressionStore } = await import('../progression')
    const store = useProgressionStore()

    store.logSetXP('set-1', 50)
    expect(JSON.parse(localStorage.getItem('user-progression')!).totalXP).toBe(50)

    store.$reset()

    expect(JSON.parse(localStorage.getItem('user-progression')!).totalXP).toBe(0)
    expect(JSON.parse(localStorage.getItem('user-progression')!).xpPerSet).toEqual({})
  })
})

describe('preferences $reset (sign-out wipe)', () => {
  it('resets personal settings and clears the persisted payload', async () => {
    const { usePreferencesStore } = await import('../preferences')
    const store = usePreferencesStore()

    store.setTheme('fire')
    store.setCoachProfile({ age: 31, injuries: 'shoulder impingement' })
    store.setGyms(['Garage Gym'])

    store.$reset()

    expect(store.theme).toBe('eternal')
    expect(store.coachProfile.age).toBeNull()
    expect(store.coachProfile.injuries).toBe('')
    expect(store.gyms).toEqual([])
    expect(store._userId).toBeNull()

    const persisted = JSON.parse(localStorage.getItem('user-preferences')!)
    expect(persisted.theme).toBe('eternal')
    expect(persisted.coachProfile.age).toBeNull()
    expect(persisted.gyms).toEqual([])
    // FOUC mirror keys are rewritten to defaults by the same _persist.
    expect(localStorage.getItem('app-theme')).toBe('eternal')
  })

  it('a later init() cannot resurrect the previous user\'s profile from storage', async () => {
    const { usePreferencesStore } = await import('../preferences')
    const store = usePreferencesStore()

    // User A's session.
    store.setCoachProfile({ age: 31, injuries: 'shoulder impingement' })
    store.setTheme('fire')

    // Sign-out, then user B signs in on the same device. init() "loads from
    // localStorage first" — before the fix, that re-hydrated A's profile.
    store.$reset()
    await store.init('user-b')

    expect(store.coachProfile.age).toBeNull()
    expect(store.coachProfile.injuries).toBe('')
    expect(store.theme).toBe('eternal')
  })

  it('enqueues no upsert during the wipe (the _userId null lands before _persist reads it)', async () => {
    const { usePreferencesStore } = await import('../preferences')
    const store = usePreferencesStore()
    await store.init('user-a')

    store.setTheme('fire')
    // Baseline: a signed-in mutation enqueues the payload upsert — so the
    // assertion below can't pass vacuously.
    expect(mockEnqueue).toHaveBeenCalled()

    mockEnqueue.mockClear()
    store.$reset()

    expect(mockEnqueue).not.toHaveBeenCalled()
  })
})
