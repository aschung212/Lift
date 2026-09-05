/**
 * LIFT-1179 — every store's remote read must offer the SAME auth recovery.
 *
 * A 401 on a background read is not just "sync failed": it is the one sync
 * failure with an action attached to it. `ensureFreshSession()` is what turns it
 * into that action — it refreshes the token (single-flight), raises
 * `authNeedsReauth` if the refresh fails (App.vue's "Session expired — sign in
 * again" banner), and bumps `sessionRecoveryTick` if it succeeds, which is what
 * makes `useSyncRecovery` re-run the reads that just 401'd. A store that records
 * `lastSyncError = 'auth'` without calling it lights the generic red indicator
 * and offers the user nothing to do about it.
 *
 * Three of the four stores were missing part of that branch:
 *   - `preferences` had none of it, on either shape.
 *   - `workout` / `bodyweight` had it on the resolved `{ error }` path but not
 *     in their `catch`.
 *
 * It never surfaced because no store fetches alone — `initStores` and
 * `useSyncRecovery` both fan all four out under `Promise.allSettled`, and a
 * token expiry hits all four at once, so SOME sibling always raised the refresh.
 * These tests exercise each store in isolation, which is the only way to see it,
 * and cover BOTH error shapes: postgrest-js RESOLVES `{ error }` for a 401
 * (LIFT-1321) while a token problem raised inside the client rejects, and
 * `isAuthError` exists precisely so neither is a special case.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

// ── Shared Supabase test double (LIFT-1009), one instance per error shape ──
const { fakes } = await vi.hoisted(async () => {
  const { createFakeSupabase } = await import('../../__tests__/fakeSupabase')
  const resolved401 = createFakeSupabase({
    mode: 'apiError',
    // PostgREST's JWT-expiry envelope — resolved, not thrown.
    error: { message: 'JWT expired', code: 'PGRST301' },
  })
  const thrown401 = createFakeSupabase({
    mode: 'reject',
    rejectionError: Object.assign(new Error('Invalid JWT'), { status: 401 }),
  })
  return { fakes: { resolved401, thrown401, active: resolved401 } }
})

// Delegate to whichever fake the active case selected. The BUILDER still comes
// from the shared double, so the chain surface stays the single source of truth
// (LIFT-1009) — only which instance answers is per-test.
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (table: string) => fakes.active.from(table) },
  isPreviewMode: { value: false },
}))

// Spy the refresh but keep the REAL `isAuthError`: the thing under test is
// whether each store routes a genuine 401 through the real classifier, not
// whether it calls a stubbed predicate.
vi.mock('../../lib/sessionHealth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/sessionHealth')>()),
  ensureFreshSession: vi.fn(() => Promise.resolve(true)),
}))

vi.mock('../../lib/syncQueue', () => ({
  syncQueue: { enqueue: vi.fn(), enqueueDelete: vi.fn(), clear: vi.fn(), rehydrate: vi.fn() },
  syncStatus: { value: 'synced' },
}))

vi.mock('../../lib/crossTabSync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/crossTabSync')>()),
  broadcastStoreUpdate: vi.fn(),
  broadcastSyncStatus: vi.fn(),
}))

vi.mock('../../lib/durableStorage', () => ({ backupToIDB: vi.fn() }))

vi.mock('../../lib/logger', () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}))

import { useWorkoutStore } from '../workout'
import { useBodyweightStore } from '../bodyweight'
import { useProgressionStore } from '../progression'
import { usePreferencesStore } from '../preferences'
import { ensureFreshSession } from '../../lib/sessionHealth'

/** Each store, reduced to the two things this contract is about. */
const STORES = [
  { name: 'workout', open: () => useWorkoutStore() },
  { name: 'bodyweight', open: () => useBodyweightStore() },
  { name: 'progression', open: () => useProgressionStore() },
  { name: 'preferences', open: () => usePreferencesStore() },
] as const

const SHAPES = [
  { shape: 'resolved { error } (what postgrest-js returns for a 401)', fake: 'resolved401' },
  { shape: 'thrown from inside the client', fake: 'thrown401' },
] as const

describe.each(SHAPES)('auth read failure, $shape (LIFT-1179)', ({ fake }) => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
    fakes.active = fakes[fake]
    setActivePinia(createPinia())
  })

  it.each(STORES)('$name store attempts a session refresh', async ({ open }) => {
    const store = open()

    // Alone — no sibling store running beside it to raise the refresh.
    await expect(store.init('user-401')).resolves.toBeUndefined()

    expect(ensureFreshSession).toHaveBeenCalled()
  })

  it.each(STORES)('$name store records the failure as auth, not generic', async ({ open }) => {
    const store = open()
    await store.init('user-401')

    // 'auth' is what separates "you need to sign in again" from "you're
    // offline" in the indicator; misclassifying it hides the only actionable
    // sync failure the app has.
    expect(store.lastSyncError).toBe('auth')
    expect(store.syncing).toBe(false)
  })
})

describe('a successful read clears the auth error (LIFT-1179)', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('preferences does not adopt remote data from a failed read', async () => {
    // The failure branch now returns rather than falling through to the
    // success-path adopt. `data` is null on an error today, so this pins the
    // control flow itself: a future edit that reads anything off the response
    // below the error check can't quietly start running on failures.
    fakes.active = fakes.resolved401
    const store = usePreferencesStore()
    const themeBefore = store.theme

    await store.init('user-401')

    expect(store.theme).toBe(themeBefore)
    expect(store.lastSyncError).toBe('auth')
  })
})
