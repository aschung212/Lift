/**
 * Durable-journal coverage for the non-workout stores (LIFT-1239).
 *
 * The durable write journal (LIFT-706) only engages when a caller passes a
 * `SyncDescriptor`; descriptor-less callers silently keep the legacy
 * in-memory-only behavior. For a long time only `workout.ts` passed one, so a
 * bodyweight entry / XP credit / settings change made offline was lost outright
 * if the app closed before the 1s flush — and, after LIFT-1229, had no durable
 * record to retain when its retries were exhausted either. Unlike sets, none of
 * these three tables has a reconciliation pass to recover the write later.
 *
 * These are end-to-end recovery tests against the REAL SyncQueue: session 1
 * writes while the server is unreachable and burns every retry, then a fresh
 * queue (a new app launch reading the same journal) replays the write and it
 * finally reaches Supabase.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ── In-memory stand-in for IndexedDB (journal + store mirrors) ───────
const { idb } = vi.hoisted(() => ({ idb: new Map<string, string>() }))
vi.mock('../../lib/durableStorage', () => ({
  backupToIDB: vi.fn((key: string, value: string) => { idb.set(key, value) }),
  restoreFromIDB: vi.fn(async (key: string) => idb.get(key) ?? null),
  clearIDB: vi.fn(async () => { idb.clear() }),
  closeDB: vi.fn(),
  requestPersistentStorage: vi.fn(async () => true),
  ensureLocalStorage: vi.fn(async () => true),
}))

// ── Fake Supabase that can be taken "offline" ───────────────────────
// `offlineResult` is duplicated here rather than imported because a vi.hoisted
// factory runs before module imports resolve; the test at the bottom of this
// file asserts it still matches the shared fake's FAKE_NETWORK_ERROR_RESULT.
const { fakeSupabase, offlineResult } = vi.hoisted(() => {
  const offlineResult = {
    data: null,
    error: {
      message: 'TypeError: Failed to fetch',
      details: 'TypeError: Failed to fetch',
      hint: '',
      code: '',
    },
    count: null,
    status: 0,
    statusText: '',
  }
  type Call = { op: string; table: string; data: unknown; options: unknown; filters: Record<string, unknown> }
  class FakeBuilder {
    op = 'select'
    data: unknown = null
    options: unknown = undefined
    filters: Record<string, unknown> = {}
    constructor(private parent: { calls: Call[]; offline: boolean }, private table: string) {}
    upsert(data: unknown, options?: unknown) { this.op = 'upsert'; this.data = data; this.options = options; return this }
    update(data: unknown) { this.op = 'update'; this.data = data; return this }
    eq(col: string, val: unknown) { this.filters[col] = val; return this }
    is(col: string, val: unknown) { this.filters[col] = val; return this }
    then<T>(
      onfulfilled?: (v: { data: unknown; error: unknown }) => T,
      onrejected?: (e: unknown) => T,
    ): PromiseLike<T> {
      if (this.parent.offline) {
        // NOT a rejection (LIFT-1321). postgrest-js catches the fetch failure
        // and resolves this envelope, so a mutation made offline looks like a
        // fulfilled promise carrying an error — which is exactly how SyncQueue
        // came to count offline writes as successes and delete their journal
        // entries. Simulating offline as a throw tested a path production takes
        // only rarely, and certified the broken one as correct.
        //
        // The call is deliberately NOT recorded: `calls` means "reached
        // Supabase" throughout this file, and an unanswered request did not.
        return Promise.resolve({ ...offlineResult }).then(onfulfilled, onrejected)
      }
      this.parent.calls.push({
        op: this.op, table: this.table, data: this.data,
        options: this.options, filters: { ...this.filters },
      })
      return Promise.resolve({ data: [], error: null }).then(onfulfilled, onrejected)
    }
  }
  const fake = {
    calls: [] as Call[],
    offline: false,
    from(table: string) { return new FakeBuilder(this, table) },
    reset() { this.calls = []; this.offline = false },
  }
  return { fakeSupabase: fake, offlineResult }
})
vi.mock('../../lib/supabase', () => ({
  supabase: fakeSupabase,
  isPreviewMode: { value: false },
}))
vi.mock('../../lib/crossTabSync', () => ({
  broadcastSyncStatus: vi.fn(),
  broadcastStoreUpdate: vi.fn(),
}))
vi.mock('../../lib/logger', () => ({ logError: vi.fn(), logWarn: vi.fn(), logInfo: vi.fn() }))

import { SyncQueue, syncQueue, syncStatus, _resetRateLimit, _resetCircuitBreaker } from '../../lib/syncQueue'
import { FAKE_NETWORK_ERROR_RESULT } from '../../__tests__/fakeSupabase'
import { useBodyweightStore } from '../bodyweight'
import { usePreferencesStore } from '../preferences'
import { useProgressionStore } from '../progression'

const JOURNAL_KEY = 'lift-sync-journal'

/** Journal entries as they sit on disk between the two sessions. */
function journaledDescriptors(): { table: string; op: string }[] {
  const raw = idb.get(JOURNAL_KEY)
  if (!raw) return []
  const parsed = JSON.parse(raw)
  const entries = Array.isArray(parsed) ? parsed : parsed.entries
  return entries.map((e: { descriptor: { table: string; op: string } }) => ({
    table: e.descriptor.table,
    op: e.descriptor.op,
  }))
}

/**
 * Session 1: the queue drains against an unreachable server and burns every
 * retry. Anything still on disk afterwards is what a relaunch can recover.
 */
async function exhaustRetriesOffline(): Promise<void> {
  fakeSupabase.offline = true
  await vi.runAllTimersAsync()
  expect(syncQueue.pending).toBe(0)
}

/** Session 2: a fresh launch replays the journal against a reachable server. */
async function relaunchAndReplay(): Promise<void> {
  fakeSupabase.offline = false
  const nextLaunch = new SyncQueue(100)
  await nextLaunch.rehydrate()
  await vi.advanceTimersByTimeAsync(100)
}

/**
 * Reconnect WITHOUT relaunching (LIFT-1322): the same live queue re-arms its
 * stranded journal entries, exactly as `useSyncRecovery.run()` does on an
 * `online` / foreground / session-recovered signal.
 */
async function reconnectAndReplay(): Promise<void> {
  fakeSupabase.offline = false
  syncQueue.replayJournal()
  await vi.runAllTimersAsync()
}

describe('durable journal coverage for bodyweight / preferences / progression (LIFT-1239)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    localStorage.clear()
    idb.clear()
    fakeSupabase.reset()
    _resetRateLimit()
    _resetCircuitBreaker()
    syncQueue.clear()
  })

  afterEach(() => {
    syncQueue.clear()
    vi.useRealTimers()
  })

  it('recovers a bodyweight entry logged while offline on the next launch', async () => {
    const store = useBodyweightStore()
    store._userId = 'u1'
    store.addEntry(182.4, '2026-08-27')

    // Journaled the instant the user acted — before any flush attempt.
    expect(journaledDescriptors()).toEqual([{ table: 'bodyweight_entries', op: 'upsert' }])

    await exhaustRetriesOffline()
    expect(fakeSupabase.calls).toHaveLength(0)
    // The durable record survives retry exhaustion (LIFT-1229).
    expect(journaledDescriptors()).toHaveLength(1)

    await relaunchAndReplay()

    const upserts = fakeSupabase.calls.filter(c => c.table === 'bodyweight_entries')
    expect(upserts).toHaveLength(1)
    expect(upserts[0].op).toBe('upsert')
    expect(upserts[0].data).toMatchObject({ user_id: 'u1', weight: 182.4 })
  })

  it('recovers a bodyweight delete on the next launch, still routed through the circuit breaker', async () => {
    const store = useBodyweightStore()
    store._userId = 'u1'
    const id = store.addEntry(180, '2026-08-26')
    // Let the create land so the delete is the only pending write.
    await vi.runAllTimersAsync()
    fakeSupabase.reset()

    store.deleteEntry(id)
    expect(journaledDescriptors()).toEqual([{ table: 'bodyweight_entries', op: 'update' }])

    await exhaustRetriesOffline()
    await relaunchAndReplay()

    const updates = fakeSupabase.calls.filter(c => c.table === 'bodyweight_entries' && c.op === 'update')
    expect(updates).toHaveLength(1)
    expect(updates[0].filters).toMatchObject({ id, user_id: 'u1' })
    expect(updates[0].data).toMatchObject({ deleted_at: expect.any(String) })
  })

  it('recovers a settings change made while offline on the next launch', async () => {
    const store = usePreferencesStore()
    store._userId = 'u1'
    store.weightUnit = 'kg'
    store._persist()

    expect(journaledDescriptors()).toEqual([{ table: 'user_preferences', op: 'upsert' }])

    await exhaustRetriesOffline()
    await relaunchAndReplay()

    const upserts = fakeSupabase.calls.filter(c => c.table === 'user_preferences')
    expect(upserts).toHaveLength(1)
    expect(upserts[0].data).toMatchObject({ user_id: 'u1' })
    expect((upserts[0].data as { preferences: { weightUnit: string } }).preferences.weightUnit).toBe('kg')
    // The replay must carry the same conflict target as the live write, or it
    // would resolve against the surrogate `id` PK and violate unique(user_id).
    expect(upserts[0].options).toEqual({ onConflict: 'user_id' })
  })

  it('recovers an XP credit made while offline on the next launch', async () => {
    const store = useProgressionStore()
    store._userId = 'u1'
    store.creditSetXP('s1', 50)

    expect(journaledDescriptors()).toEqual([{ table: 'user_progression', op: 'upsert' }])

    await exhaustRetriesOffline()
    await relaunchAndReplay()

    const upserts = fakeSupabase.calls.filter(c => c.table === 'user_progression')
    expect(upserts).toHaveLength(1)
    expect(upserts[0].data).toMatchObject({ user_id: 'u1', total_xp: 50 })
  })

  // LIFT-1321: the three tests above only prove recovery because "offline" is
  // modelled the way production behaves. While it was modelled as a rejection,
  // this whole file passed against a SyncQueue that treated real offline writes
  // as successes — retries cleared, journal deleted, status 'synced'. Pin both
  // halves so the fidelity can't quietly regress.
  it('models offline the way postgrest-js does — a resolved error, not a rejection (LIFT-1321)', async () => {
    expect(offlineResult).toEqual(FAKE_NETWORK_ERROR_RESULT)

    fakeSupabase.offline = true
    // Awaiting the builder must RESOLVE (it would throw here if it rejected).
    const result = await fakeSupabase.from('sets').upsert({ id: 's1' })
    expect(result).toMatchObject({ status: 0, error: { message: 'TypeError: Failed to fetch' } })
  })

  it('never reports a settings change made offline as synced (LIFT-1321)', async () => {
    // Preferences is the store with the most to lose: a remote-wins JSONB blob
    // with no reconciliation pass, so a write counted as a success is gone.
    const store = usePreferencesStore()
    store._userId = 'u1'
    store.weightUnit = 'kg'
    store._persist()

    fakeSupabase.offline = true
    await vi.advanceTimersByTimeAsync(1000)

    expect(syncStatus.value).not.toBe('synced')
    expect(journaledDescriptors()).toEqual([{ table: 'user_preferences', op: 'upsert' }])
  })

  // ── Reconnect recovery, no relaunch required (LIFT-1322) ─────────
  //
  // Every test above proves recovery on the NEXT COLD START, which until now was
  // the app's only recovery: `rehydrate()` is called once, from
  // `useAuth.initStores`. Five exponential-backoff retries exhaust in ~31s, so
  // any offline stretch longer than half a minute — i.e. every real one — left
  // the write stranded for the remainder of the session, with `useSyncRecovery`
  // dutifully flushing an already-empty queue when the signal came back.

  it('recovers a settings change on RECONNECT, without waiting for a relaunch (LIFT-1322)', async () => {
    // Preferences is the store with the most to lose: a remote-wins JSONB blob
    // with no reconciliation pass. Until the replay lands, every re-fetch paints
    // the stale server settings back over the user's change.
    const store = usePreferencesStore()
    store._userId = 'u1'
    store.weightUnit = 'kg'
    store._persist()

    await exhaustRetriesOffline()
    expect(fakeSupabase.calls).toHaveLength(0)
    expect(journaledDescriptors()).toHaveLength(1)

    await reconnectAndReplay()

    const upserts = fakeSupabase.calls.filter(c => c.table === 'user_preferences')
    expect(upserts).toHaveLength(1)
    expect((upserts[0].data as { preferences: { weightUnit: string } }).preferences.weightUnit).toBe('kg')
    expect(upserts[0].options).toEqual({ onConflict: 'user_id' })
    // Landed, so nothing is left for the next launch to replay.
    expect(journaledDescriptors()).toEqual([])
    expect(syncStatus.value).toBe('synced')
  })

  it('recovers a bodyweight entry on reconnect', async () => {
    const store = useBodyweightStore()
    store._userId = 'u1'
    store.addEntry(182.4, '2026-08-27')

    await exhaustRetriesOffline()
    await reconnectAndReplay()

    const upserts = fakeSupabase.calls.filter(c => c.table === 'bodyweight_entries')
    expect(upserts).toHaveLength(1)
    expect(upserts[0].data).toMatchObject({ user_id: 'u1', weight: 182.4 })
  })

  it('recovers an XP credit on reconnect', async () => {
    const store = useProgressionStore()
    store._userId = 'u1'
    store.creditSetXP('s1', 50)

    await exhaustRetriesOffline()
    await reconnectAndReplay()

    const upserts = fakeSupabase.calls.filter(c => c.table === 'user_progression')
    expect(upserts).toHaveLength(1)
    expect(upserts[0].data).toMatchObject({ user_id: 'u1', total_xp: 50 })
  })

  it('does not journal the unbounded clear-all wipe', async () => {
    // Deliberate exemption: the descriptor format can only express `eq`
    // matches, so the `.is('deleted_at', null)` guard would be lost, and
    // replaying "delete everything" on the next launch would wipe entries
    // logged on another device in the meantime.
    const store = useBodyweightStore()
    store._userId = 'u1'
    store.addEntry(180, '2026-08-26')
    await vi.runAllTimersAsync()
    idb.delete(JOURNAL_KEY)

    store.clearAll()

    expect(journaledDescriptors()).toEqual([])
  })
})
