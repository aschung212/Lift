/**
 * Regression: a store read that lands after its session ended changes nothing
 * (LIFT-1517).
 *
 * A read takes seconds on a phone, and nothing makes a sign-out wait for one:
 * `init()` starts one on every sign-in, and `useSyncRecovery` one on every
 * foreground resume, reconnect and session recovery, so opening the app and
 * signing out from Settings routinely signs out under a read still in flight.
 * `signOut()` wipes the four stores and persists the wiped payloads. The read
 * then landed, and the workout and bodyweight stores merged it into the wiped
 * state (an empty local copy merged with the server's is the server's) and
 * `_persist()` wrote the signed-out user's whole history back to localStorage,
 * the IndexedDB backup and every open tab. `migrateLocalStorageToSupabase`
 * reads exactly those two payloads when the next account signs in on the
 * device, and an empty account gets them inserted as its own history. If that
 * account had already signed in when the read landed, the history merged into
 * its store instead, and its next sync tried to push it under its own id.
 * Delete Account ends with the same sign-out, so the deleted history came back
 * too.
 *
 * Preferences and progression already dropped a late answer (LIFT-1515), but
 * only a resolved one: a rejected read still reported into the wiped store,
 * refreshing a session that no longer existed and lighting "Sync failed" for
 * whoever signed in next.
 *
 * Why nothing caught it: every query in the shared fake settled on the next
 * microtask, so a store's read always finished before a test could do anything
 * else, and no test ever signed out with one pending. These cases hold the
 * reads in flight (`holdReads`), sign out through the real `useAuth()`, and
 * assert on the stores, their persisted payloads and the server's rows.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'
import type { FakeSupabaseResult } from '../../__tests__/fakeSupabase'

const localStorageMock = getLocalStorageMock()

const { fakeSupabase } = await vi.hoisted(async () => {
  const { createFakeSupabase } = await import('../../__tests__/fakeSupabase')
  // `signOut()` and `deleteAccount()` reach the auth client and two RPCs;
  // nothing here depends on what those answer beyond "no error".
  const fake = Object.assign(createFakeSupabase({ mode: 'ok' }), {
    auth: { signOut: async () => ({ error: null }) },
    rpc: async () => ({ data: null, error: null }),
  })
  return { fakeSupabase: fake }
})

vi.mock('../../lib/supabase', () => ({
  supabase: fakeSupabase,
  isPreviewMode: { value: false },
}))

// Synchronous queue: an enqueued write lands on the fake at once, so "nothing
// was sent" is read off the server's tables rather than a list of intentions.
vi.mock('../../lib/syncQueue', async () => {
  const { ref } = await import('vue')
  const invoke = (_key: string, op: () => PromiseLike<unknown>) => {
    Promise.resolve(op()).catch(() => {})
  }
  return {
    syncQueue: { enqueue: vi.fn(invoke), enqueueDelete: vi.fn(invoke), clear: vi.fn() },
    // The indicator `reportFetchError` flips to 'error' — what the next account sees.
    syncStatus: ref('synced'),
  }
})

vi.mock('../../lib/durableStorage', () => ({
  backupToIDB: vi.fn(),
  restoreFromIDB: vi.fn(async () => null),
  clearIDB: vi.fn(async () => {}),
  closeDB: vi.fn(),
  deleteAllIDB: vi.fn(async () => {}),
}))

vi.mock('../../lib/crossTabSync', () => ({
  broadcastSyncStatus: vi.fn(),
  broadcastStoreUpdate: vi.fn(),
}))

vi.mock('../../lib/logger', () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}))

vi.mock('../../lib/sessionHealth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/sessionHealth')>()),
  ensureFreshSession: vi.fn(async () => true),
}))

import { useAuth } from '../useAuth'
import { useWorkoutStore } from '../../stores/workout'
import { useBodyweightStore } from '../../stores/bodyweight'
import { usePreferencesStore } from '../../stores/preferences'
import { useProgressionStore } from '../../stores/progression'
import { syncStatus } from '../../lib/syncQueue'
import { backupToIDB } from '../../lib/durableStorage'
import { broadcastStoreUpdate } from '../../lib/crossTabSync'
import { ensureFreshSession } from '../../lib/sessionHealth'
import { logError } from '../../lib/logger'
import { _resetTombstones } from '../../lib/tombstones'

/** Signed in when the reads went out. */
const A = 'user-a'
/** The next account to sign in on the same device. */
const B = 'user-b'

const STAMP = '2026-09-28T18:00:00.000Z'

/** Each account's history as the server holds it; `withB` gives the next account one of its own. */
function seedServer({ withB = false }: { withB?: boolean } = {}) {
  const row = { created_at: STAMP, updated_at: STAMP, deleted_at: null }
  fakeSupabase.seed('exercises', [
    { id: 'a-bench', user_id: A, name: 'Bench Press', tags: ['Push'], ...row },
    ...(withB ? [{ id: 'b-squat', user_id: B, name: 'Squat', tags: ['Legs'], ...row }] : []),
  ])
  fakeSupabase.seed('sets', [
    {
      id: 'a-bench-1', user_id: A, exercise_id: 'a-bench',
      date: '2026-09-28T23:59:30.000Z', weight: 225, reps: 5, estimated_1rm: 262.5, ...row,
    },
    ...(withB ? [{
      id: 'b-squat-1', user_id: B, exercise_id: 'b-squat',
      date: '2026-09-29T23:59:30.000Z', weight: 315, reps: 3, estimated_1rm: 346.5, ...row,
    }] : []),
  ])
  fakeSupabase.seed('bodyweight_entries', [
    { id: 'a-bw-1', user_id: A, date: '2026-09-28T23:59:30.000Z', weight: 190, ...row },
    ...(withB ? [{ id: 'b-bw-1', user_id: B, date: '2026-09-29T23:59:30.000Z', weight: 150, ...row }] : []),
  ])
}

/** Let every promise chain queued so far run, e.g. the reads `init()` starts. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

/**
 * A store's persisted payload. `workout-exercises` and `bodyweight-entries` are
 * the two keys `migrateLocalStorageToSupabase` uploads into an empty account.
 */
const persisted = (key: string): { id: string }[] => JSON.parse(localStorageMock.getItem(key) ?? '[]')

/** The server's rows, frozen for comparison. */
const serverRows = () => JSON.parse(JSON.stringify(fakeSupabase.tables)) as typeof fakeSupabase.tables

const isRead = (user: string) => (read: { filters: Record<string, unknown> }) => read.filters.user_id === user

beforeEach(() => {
  localStorageMock.clear()
  _resetTombstones()
  fakeSupabase.reset()
  vi.clearAllMocks()
  syncStatus.value = 'synced'
  setActivePinia(createPinia())
})

describe('a store read that outlives its session changes nothing (LIFT-1517)', () => {
  it('a read in flight at sign-out leaves the wiped stores and their payloads empty', async () => {
    seedServer()
    const workout = useWorkoutStore()
    const bodyweight = useBodyweightStore()

    fakeSupabase.holdReads()
    const reads = Promise.all([workout.init(A), bodyweight.init(A)])
    await settle()
    // Non-vacuity: A's reads really are in flight across the sign-out.
    expect(fakeSupabase.heldReads.map(r => r.table).sort()).toEqual(['bodyweight_entries', 'exercises', 'sets'])
    const server = serverRows()

    await useAuth().signOut()
    const backups = vi.mocked(backupToIDB).mock.calls.length
    const broadcasts = vi.mocked(broadcastStoreUpdate).mock.calls.length
    fakeSupabase.releaseReads()
    await reads

    expect(workout.exercises).toEqual([])
    expect(bodyweight.entries).toEqual([])
    expect(persisted('workout-exercises')).toEqual([])
    expect(persisted('bodyweight-entries')).toEqual([])
    // Nor the IndexedDB backup a relaunch restores an empty localStorage from,
    // nor the other open tabs.
    expect(vi.mocked(backupToIDB).mock.calls.length).toBe(backups)
    expect(vi.mocked(broadcastStoreUpdate).mock.calls.length).toBe(broadcasts)
    expect(workout.syncing).toBe(false)
    expect(bodyweight.syncing).toBe(false)
    expect(fakeSupabase.tables).toEqual(server)
  })

  it('the next account to sign in on the device inherits none of it', async () => {
    seedServer()
    const workout = useWorkoutStore()
    const bodyweight = useBodyweightStore()
    fakeSupabase.holdReads()
    const reads = Promise.all([workout.init(A), bodyweight.init(A)])
    await settle()
    await useAuth().signOut()
    fakeSupabase.releaseReads()
    await reads
    const server = serverRows()

    // An empty account: the one the launch migration would fill from this
    // device's payloads, and whose first sync pushes whatever the stores hold.
    await Promise.all([workout.init(B), bodyweight.init(B)])

    expect(workout.exercises).toEqual([])
    expect(bodyweight.entries).toEqual([])
    expect(fakeSupabase.tables).toEqual(server)
    const ownedByB = [...fakeSupabase.tables.exercises, ...fakeSupabase.tables.sets, ...fakeSupabase.tables.bodyweight_entries]
      .filter(r => r.user_id === B)
    expect(ownedByB).toEqual([])
  })

  it('a read that lands after the next account signed in does not merge into that account', async () => {
    seedServer({ withB: true })
    const workout = useWorkoutStore()
    const bodyweight = useBodyweightStore()

    fakeSupabase.holdReads()
    const readsA = Promise.all([workout.init(A), bodyweight.init(A)])
    await settle()
    await useAuth().signOut()
    const readsB = Promise.all([workout.init(B), bodyweight.init(B)])
    await settle()
    fakeSupabase.releaseReads({ match: isRead(B) })
    await readsB
    const server = serverRows()

    // A's answers arrive last, into B's session.
    fakeSupabase.releaseReads()
    await readsA

    expect(workout.exercises.map(e => e.id)).toEqual(['b-squat'])
    expect(workout.exercises[0].sets.map(s => s.id)).toEqual(['b-squat-1'])
    expect(bodyweight.entries.map(e => e.id)).toEqual(['b-bw-1'])
    expect(persisted('workout-exercises').map(e => e.id)).toEqual(['b-squat'])
    expect(persisted('bodyweight-entries').map(e => e.id)).toEqual(['b-bw-1'])
    expect(fakeSupabase.tables).toEqual(server)
  })

  it('a read that lands while the next account\'s read is in flight leaves that read alone', async () => {
    seedServer({ withB: true })
    const workout = useWorkoutStore()
    const bodyweight = useBodyweightStore()

    fakeSupabase.holdReads()
    const readsA = Promise.all([workout.init(A), bodyweight.init(A)])
    await settle()
    await useAuth().signOut()
    const readsB = Promise.all([workout.init(B), bodyweight.init(B)])
    await settle()

    fakeSupabase.releaseReads({ match: isRead(A) })
    await readsA
    // B's own read is still in flight: its flag stays up, and A's history is not in.
    expect(workout.syncing).toBe(true)
    expect(bodyweight.syncing).toBe(true)
    expect(workout.exercises).toEqual([])
    expect(bodyweight.entries).toEqual([])

    fakeSupabase.releaseReads()
    await readsB
    expect(workout.syncing).toBe(false)
    expect(bodyweight.syncing).toBe(false)
    expect(workout.exercises.map(e => e.id)).toEqual(['b-squat'])
    expect(bodyweight.entries.map(e => e.id)).toEqual(['b-bw-1'])
  })

  it('signing back in as the same user still loads their history', async () => {
    seedServer()
    const workout = useWorkoutStore()
    const bodyweight = useBodyweightStore()

    fakeSupabase.holdReads()
    const before = Promise.all([workout.init(A), bodyweight.init(A)])
    await settle()
    await useAuth().signOut()
    const after = Promise.all([workout.init(A), bodyweight.init(A)])
    await settle()
    fakeSupabase.releaseReads()
    await Promise.all([before, after])

    expect(workout.exercises.map(e => e.id)).toEqual(['a-bench'])
    expect(workout.exercises[0].sets.map(s => s.id)).toEqual(['a-bench-1'])
    expect(bodyweight.entries.map(e => e.id)).toEqual(['a-bw-1'])
    expect(workout.syncing).toBe(false)
    expect(bodyweight.syncing).toBe(false)
  })

  it('Delete Account leaves none of the deleted history behind when a read lands after it', async () => {
    seedServer()
    const auth = useAuth()
    const workout = useWorkoutStore()
    const bodyweight = useBodyweightStore()

    fakeSupabase.holdReads()
    const reads = Promise.all([workout.init(A), bodyweight.init(A)])
    await settle()
    auth.user.value = { id: A, email: 'a@example.com' }
    await auth.deleteAccount()
    // The account's rows are gone from the server, but the read made before
    // the deletion still carries them.
    expect(fakeSupabase.tables.exercises.filter(r => r.user_id === A)).toEqual([])
    fakeSupabase.releaseReads()
    await reads

    expect(workout.exercises).toEqual([])
    expect(bodyweight.entries).toEqual([])
    expect(persisted('workout-exercises')).toEqual([])
    expect(persisted('bodyweight-entries')).toEqual([])
  })

  const AUTH_EXPIRED: FakeSupabaseResult = {
    data: null,
    error: { message: 'JWT expired', code: 'PGRST301', details: '', hint: '' },
    status: 401,
  }

  it.each([
    ['resolves a 401', AUTH_EXPIRED],
    ['rejects', new Error('JWT expired')],
  ] as const)('a read that %s after sign-out reports nothing against the wiped stores', async (_shape, outcome) => {
    seedServer()
    const stores = [useWorkoutStore(), useBodyweightStore(), usePreferencesStore(), useProgressionStore()]

    fakeSupabase.holdReads()
    const reads = Promise.all(stores.map(store => store.init(A)))
    await settle()
    // Every store's read is in flight (the workout store makes two).
    expect(new Set(fakeSupabase.heldReads.map(r => r.table))).toEqual(
      new Set(['exercises', 'sets', 'bodyweight_entries', 'user_preferences', 'user_progression']),
    )

    await useAuth().signOut()
    fakeSupabase.releaseReads({ outcome })
    await reads

    for (const store of stores) {
      expect(store.lastSyncError).toBeNull()
      expect(store.syncing).toBe(false)
    }
    // No refresh of a session that no longer exists, which would raise
    // "Session expired — sign in again"…
    expect(ensureFreshSession).not.toHaveBeenCalled()
    // …and no "Sync failed" for whoever signs in next, nor a Sentry event.
    expect(syncStatus.value).toBe('synced')
    expect(logError).not.toHaveBeenCalled()
  })
})
