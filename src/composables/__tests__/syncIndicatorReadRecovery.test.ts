/**
 * Regression: a read that recovers clears the "Sync failed" its failure raised
 * (LIFT-1543).
 *
 * `reportFetchError` (LIFT-786) set the WRITE queue's shared `syncStatus` to
 * 'error' for an auth or server read failure, beside the `lastSyncError` the
 * store records for the same failure (LIFT-1179). The store's next successful
 * read cleared `lastSyncError`, but nothing on the read path can set
 * `syncStatus` back: only a successful flush does. So the indicator kept
 * saying "Sync failed — changes saved locally" after every read had
 * recovered, until some unrelated write happened to flush. On a signed-in
 * device that was progression's upsert at the end of its own successful read,
 * about a second later. Where writes are blocked (a preview deploy) no write
 * ever came, and the label stayed for the session. The 'error' also went to
 * every other open tab, whose own reads were fine.
 *
 * Why nothing caught it: `fetchErrorClassifier.test.ts` and
 * `supabaseApiError.test.ts` asserted the `syncStatus` write as the expected
 * behaviour, and `useSyncStatus.test.ts` set the stale 'error' by hand. No
 * test ran a failed read and then a successful one through the real indicator.
 *
 * These cases do: the real four stores, sync queue, recovery pass and
 * `useSyncStatus` fold, against a server that answers one resume's reads with
 * an outage and the next resume's normally. The trigger is immaterial: every
 * recovery pass (and the boot's own read) runs the same four reads.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

const { USER, server, outages, network, previewMode, refreshSession } = await vi.hoisted(async () => {
  const { createFakeSupabase } = await import('../../__tests__/fakeSupabase')
  const outages = {
    // PostgREST answers 503 with this while it cannot reach the database (a
    // Supabase restart or maintenance window).
    server: createFakeSupabase({
      mode: 'apiError',
      error: { message: 'Could not query the database for the schema cache. Retrying.', code: 'PGRST002' },
    }),
    // PostgREST's JWT-expiry envelope: an access token that expired in the background.
    auth: createFakeSupabase({ mode: 'apiError', error: { message: 'JWT expired', code: 'PGRST301' } }),
  }
  return {
    USER: 'user-1543',
    server: createFakeSupabase(),
    outages,
    /** While set, this outage answers every request; the server answers otherwise. */
    network: { outage: null as (typeof outages)[keyof typeof outages] | null },
    previewMode: { value: false },
    // The refresh a 401'd read asks for goes through.
    refreshSession: vi.fn(async () => ({ data: { session: { access_token: 'fresh' } }, error: null })),
  }
})

vi.mock('../../lib/supabase', () => ({
  supabase: {
    // The shared fake's builder answers every query, so the chain surface stays
    // its single source of truth (LIFT-1009). Only WHICH fake answers changes.
    from: (table: string) => (network.outage ?? server).from(table),
    auth: { refreshSession },
  },
  isPreviewMode: previewMode,
}))
// The queue journals to IndexedDB, which happy-dom lacks and which is not the
// subject here; its timing and status logic run unchanged.
vi.mock('../../lib/durableStorage', () => ({
  backupToIDB: vi.fn(),
  restoreFromIDB: vi.fn(() => Promise.resolve(null)),
}))
vi.mock('../../lib/crossTabSync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/crossTabSync')>()),
  broadcastStoreUpdate: vi.fn(),
  broadcastSyncStatus: vi.fn(),
}))
vi.mock('../../lib/logger', () => ({ logError: vi.fn(), logWarn: vi.fn(), logInfo: vi.fn() }))

import { useWorkoutStore } from '../../stores/workout'
import { useBodyweightStore } from '../../stores/bodyweight'
import { usePreferencesStore } from '../../stores/preferences'
import { useProgressionStore } from '../../stores/progression'
import { syncQueue, syncStatus, _resetRateLimit, _resetCircuitBreaker } from '../../lib/syncQueue'
import { resetSyncQueueStats } from '../../lib/syncActivity'
import { _resetSessionHealth } from '../../lib/sessionHealth'
import { _resetTombstones } from '../../lib/tombstones'
import { broadcastSyncStatus } from '../../lib/crossTabSync'
import { logError } from '../../lib/logger'
import { refetchAllStores, _resetSyncRecovery, REFETCH_COOLDOWN_MS } from '../useSyncRecovery'
import { useSyncStatus, _resetSyncStatus } from '../useSyncStatus'

/** An account another device trains on: a lift with a set, its settings row and its XP row. */
function seedAccount(): void {
  server.seed('exercises', [{
    id: 'bench-row', user_id: USER, name: 'Bench Press', tags: [],
    created_at: '2026-10-01T18:00:00.000Z', updated_at: '2026-10-01T18:00:00.000Z', deleted_at: null,
  }])
  server.seed('sets', [{
    id: 'bench-set', user_id: USER, exercise_id: 'bench-row',
    date: '2026-10-01T23:59:30.000Z', weight: 185, reps: 5, estimated_1rm: 216,
    created_at: '2026-10-01T18:05:00.000Z', updated_at: '2026-10-01T18:05:00.000Z', deleted_at: null,
  }])
  server.seed('user_preferences', [{
    id: 'prefs-row', user_id: USER,
    preferences: { features: { workouts: true, calendar: true, weight: true }, weightUnit: 'lbs' },
  }])
  server.seed('user_progression', [{
    id: 'progression-row', user_id: USER, total_xp: 0, streak_weeks: 0, weekly_target: 3,
    pending_target_change: null, show_progression: true, progression_enabled: false,
    unlocked_themes: [], starter_theme: null, starter_confirmed: false, epoch: 0,
    streak_history: [], xp_per_set: {}, bodyweight_xp_dates: [],
    updated_at: '2026-10-01T18:00:00.000Z',
  }])
}

/** Signed in on this device: every store bound to the account, as sign-in leaves them. */
function signIn(): void {
  for (const store of [useWorkoutStore(), useBodyweightStore(), usePreferencesStore(), useProgressionStore()]) {
    store.bindUser(USER)
  }
}

/** A foreground resume past the recovery cooldown: replay, flush, then read all four stores. */
async function resume(): Promise<void> {
  await vi.advanceTimersByTimeAsync(REFETCH_COOLDOWN_MS)
  expect(await refetchAllStores('resume')).toBe(true)
}

// `kind` names both the outage and the category `reportFetchError` gives it.
const OUTAGES = [
  { kind: 'server', what: 'a 503 from PostgREST' },
  { kind: 'auth', what: 'an expired token' },
] as const

describe.each(OUTAGES)('a read that failed with $what (LIFT-1543)', ({ kind }) => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    localStorageMock.clear()
    server.reset()
    seedAccount()
    network.outage = null
    previewMode.value = false
    syncQueue.clear()
    _resetRateLimit()
    _resetCircuitBreaker()
    syncStatus.value = 'synced'
    resetSyncQueueStats()
    _resetTombstones()
    _resetSessionHealth()
    _resetSyncRecovery()
    _resetSyncStatus()
    vi.clearAllMocks()
    setActivePinia(createPinia())
    signIn()
  })

  afterEach(() => {
    _resetSyncStatus()
    _resetSyncRecovery()
    syncQueue.clear()
    vi.useRealTimers()
  })

  it('shows "Sync failed" while it fails and clears it the moment a read succeeds', async () => {
    const sync = useSyncStatus()

    network.outage = outages[kind]
    await resume()

    expect(sync.status.value).toBe('error')
    expect(sync.label.value).toBe('Sync failed — changes saved locally')
    expect(sync.unsentChanges.value).toBe(0)
    // Still observable (LIFT-786)…
    expect(logError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ category: kind }))
    // …but kept off the write queue's status, and out of every other tab's.
    expect(syncStatus.value).toBe('synced')
    expect(broadcastSyncStatus).not.toHaveBeenCalledWith('error')

    network.outage = null
    await resume()

    // The indicator tells the truth as soon as the reads do. Before LIFT-1543 it
    // still read "Sync failed" here: only a flush could undo what the failed
    // reads wrote into the write queue's status, and this pass's one write
    // (progression's upsert at the end of its read) is still a second away.
    expect(sync.status.value).toBe('synced')
    expect(sync.label.value).toBe('')

    await vi.advanceTimersByTimeAsync(1_000)
    expect(sync.status.value).toBe('synced')

    // A later failure lights it again: clearing it is not ignoring it.
    network.outage = outages[kind]
    await resume()
    expect(sync.status.value).toBe('error')
  })

  it('clears it where no write ever lands (a preview deploy reads the account but blocks writes)', async () => {
    previewMode.value = true
    const sync = useSyncStatus()

    network.outage = outages[kind]
    await resume()
    expect(sync.status.value).toBe('error')

    network.outage = null
    await resume()
    await vi.runAllTimersAsync()

    // No write reached the server, so none could have retired the label. Before
    // LIFT-1543 it therefore stayed up for the rest of the session.
    expect(server.calls.filter(c => c.op !== 'select')).toEqual([])
    expect(sync.status.value).toBe('synced')
  })
})
