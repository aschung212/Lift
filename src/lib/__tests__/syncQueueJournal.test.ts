/**
 * Durable sync-queue journal tests (LIFT-706).
 *
 * The in-memory SyncQueue loses pending operations when the tab closes. To
 * harden offline writes, operations enqueued WITH a serializable descriptor
 * are journaled to IndexedDB and can be rehydrated + replayed on the next app
 * load. These tests cover:
 *   - journaling on enqueue / removal on flush success / removal on drop
 *   - legacy (descriptor-less) enqueues stay in-memory only
 *   - rehydrate() replaying persisted writes through executeDescriptor
 *   - delete routing preserved across rehydrate (circuit breaker still sees it)
 *   - clear() wiping the durable journal
 *   - executeDescriptor building correct upsert / update queries
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

// ── In-memory durable storage (stand-in for IndexedDB) ──────────────
const { idbStore } = vi.hoisted(() => ({ idbStore: new Map<string, string>() }))
vi.mock('../durableStorage', () => ({
  backupToIDB: vi.fn((key: string, value: string) => { idbStore.set(key, value) }),
  restoreFromIDB: vi.fn(async (key: string) => idbStore.get(key) ?? null),
}))

// ── Fake Supabase that records mutations ────────────────────────────
const { fakeSupabase } = vi.hoisted(() => {
  class FakeBuilder {
    op = 'select'
    table: string
    data: unknown = null
    filters: Record<string, unknown> = {}
    private parent: { calls: unknown[] }
    constructor(parent: { calls: unknown[] }, table: string) {
      this.parent = parent
      this.table = table
    }
    options: unknown = undefined
    upsert(data: unknown, options?: unknown) { this.op = 'upsert'; this.data = data; this.options = options; return this }
    update(data: unknown) { this.op = 'update'; this.data = data; return this }
    eq(col: string, val: unknown) { this.filters[col] = val; return this }
    then<T>(onfulfilled: (v: { data: unknown[]; error: null }) => T): PromiseLike<T> {
      this.parent.calls.push({ op: this.op, table: this.table, data: this.data, filters: { ...this.filters }, options: this.options })
      return Promise.resolve({ data: [], error: null }).then(onfulfilled)
    }
  }
  const fake = {
    calls: [] as Array<{ op: string; table: string; data: unknown; filters: Record<string, unknown>; options?: unknown }>,
    from(table: string) { return new FakeBuilder(this, table) },
    reset() { this.calls = [] },
  }
  return { fakeSupabase: fake }
})
vi.mock('../supabase', () => ({ supabase: fakeSupabase, isPreviewMode: { value: false } }))
vi.mock('../crossTabSync', () => ({ broadcastSyncStatus: vi.fn() }))
vi.mock('../logger', () => ({ logError: vi.fn(), logWarn: vi.fn(), logInfo: vi.fn() }))

import {
  SyncQueue,
  executeDescriptor,
  isReplayableDescriptor,
  syncStatus,
  _resetRateLimit,
  _resetCircuitBreaker,
  _getCircuitBreakerState,
  JOURNAL_SCHEMA_VERSION,
  type SyncDescriptor,
} from '../syncQueue'
import { FAKE_NETWORK_ERROR_RESULT } from '../../__tests__/fakeSupabase'

const UPSERT: SyncDescriptor = { op: 'upsert', table: 'sets', row: { id: 's1', weight: 100 } }

/**
 * What a Supabase mutation ACTUALLY resolves with when the device is offline
 * (LIFT-1321) — postgrest-js catches the fetch rejection rather than letting it
 * propagate. Imported from the shared fake so every "offline" simulation in the
 * suite agrees on the shape.
 */
const FETCH_FAILURE_RESULT = FAKE_NETWORK_ERROR_RESULT

describe('SyncQueue durable journal (LIFT-706)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    syncStatus.value = 'synced'
    idbStore.clear()
    fakeSupabase.reset()
    _resetRateLimit()
    _resetCircuitBreaker()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('journals an operation enqueued with a descriptor and persists it to IDB', () => {
    const queue = new SyncQueue(500)
    queue.enqueue('set:s1', () => Promise.resolve(), UPSERT)

    expect(queue.journalSize).toBe(1)
    const persisted = JSON.parse(idbStore.get('lift-sync-journal')!)
    expect(persisted.version).toBe(JOURNAL_SCHEMA_VERSION)
    expect(persisted.entries).toHaveLength(1)
    expect(persisted.entries[0]).toMatchObject({ key: 'set:s1', isDelete: false, descriptor: UPSERT })
  })

  it('does NOT journal descriptor-less (legacy) operations', () => {
    const queue = new SyncQueue(500)
    queue.enqueue('set:s1', () => Promise.resolve())

    expect(queue.journalSize).toBe(0)
    expect(idbStore.has('lift-sync-journal')).toBe(false)
  })

  it('removes the journal entry once the operation flushes successfully', async () => {
    const queue = new SyncQueue(100)
    queue.enqueue('set:s1', () => Promise.resolve(), UPSERT)
    expect(queue.journalSize).toBe(1)

    await vi.advanceTimersByTimeAsync(100)

    expect(queue.journalSize).toBe(0)
    expect(JSON.parse(idbStore.get('lift-sync-journal')!).entries).toHaveLength(0)
  })

  // LIFT-1229: retry-exhausted durable writes must NOT be dropped from the
  // journal. Reconciliation only re-pushes missing *sets*, so an exhausted
  // exercise-metadata write would otherwise be stranded silently. Retaining the
  // entry lets rehydrate() replay it on the next launch, covering every
  // journaled table uniformly.
  it('keeps the entry journaled across retries AND after exhausting them (LIFT-1229)', async () => {
    const queue = new SyncQueue(100)
    queue.enqueue('set:s1', () => Promise.reject(new Error('offline')), UPSERT)

    // First failed attempt — still journaled (will retry)
    await vi.advanceTimersByTimeAsync(100)
    expect(queue.journalSize).toBe(1)

    // Run all retries to exhaustion — op leaves the in-memory queue but its
    // durable record is RETAINED (survives to the next launch).
    await vi.runAllTimersAsync()
    expect(queue.journalSize).toBe(1)
    expect(queue.pending).toBe(0)
    // The retained entry is still on disk for the next launch to rehydrate.
    const persisted = JSON.parse(idbStore.get('lift-sync-journal')!)
    expect(persisted.entries).toHaveLength(1)
    expect(persisted.entries[0]).toMatchObject({ key: 'set:s1', descriptor: UPSERT })
  })

  // LIFT-1229: a metadata write that exhausts its retries in one session (e.g. a
  // rename made while offline/backgrounded) is recovered on the next launch —
  // the retained journal entry replays through rehydrate() and reaches Supabase.
  it('replays a retry-exhausted metadata write on the next launch (LIFT-1229)', async () => {
    const RENAME: SyncDescriptor = {
      op: 'upsert', table: 'exercises',
      row: { id: 'e1', user_id: 'u1', name: 'Incline Bench' },
    }

    // Session 1: the metadata write fails on every attempt and exhausts retries.
    const session1 = new SyncQueue(100)
    session1.enqueue('exercise:e1', () => Promise.reject(new Error('offline')), RENAME)
    await vi.runAllTimersAsync()
    expect(session1.journalSize).toBe(1)
    // Nothing reached the server yet.
    expect(fakeSupabase.calls.filter(c => c.op === 'upsert')).toHaveLength(0)

    // Session 2 (fresh launch, same durable journal on disk): rehydrate replays it.
    const session2 = new SyncQueue(100)
    await session2.rehydrate()
    expect(session2.pending).toBe(1)
    await vi.advanceTimersByTimeAsync(100)

    const upserts = fakeSupabase.calls.filter(c => c.op === 'upsert' && c.table === 'exercises')
    expect(upserts).toHaveLength(1)
    expect(upserts[0].data).toEqual({ id: 'e1', user_id: 'u1', name: 'Incline Bench' })
    // Now that it landed, the journal is finally drained.
    expect(session2.journalSize).toBe(0)
  })

  // Regression LIFT-1321: THE root-cause test. postgrest-js catches the fetch
  // rejection and RESOLVES `{ error: 'TypeError: Failed to fetch', status: 0 }`,
  // so an offline mutation does not reject. `_settleFailure` used to count that
  // as a SUCCESS — which cleared the retry counter, DELETED the durable journal
  // entry, and reported 'synced'. The entire LIFT-706/1229 durability story was
  // therefore unreachable for the most common failure the app has.
  //
  // Every sync test modelled offline as `Promise.reject`, which is why this
  // shipped and stayed green: the suite exercised a path production rarely takes.
  it('keeps the journal entry when an offline write RESOLVES a fetch-failure error (LIFT-1321)', async () => {
    const queue = new SyncQueue(100)
    queue.enqueue('set:s1', () => Promise.resolve({ ...FETCH_FAILURE_RESULT }), UPSERT)

    await vi.advanceTimersByTimeAsync(100)

    // The durable record survives the "successful-looking" flush…
    expect(queue.journalSize).toBe(1)
    expect(JSON.parse(idbStore.get('lift-sync-journal')!).entries).toHaveLength(1)
    // …the write is queued for retry rather than dropped…
    expect(queue.pending).toBe(1)
    // …and the UI is never told the write landed.
    expect(syncStatus.value).not.toBe('synced')

    // Retries exhaust; the durable record is still retained for the next launch.
    await vi.runAllTimersAsync()
    expect(queue.journalSize).toBe(1)
    expect(queue.pending).toBe(0)
  })

  // A set logged in a dead-spot gym is recovered on the next launch — the same
  // end-to-end path LIFT-1229 proves for rejections, now for the resolved shape
  // production actually produces.
  it('replays an offline-resolved write on the next launch (LIFT-1321)', async () => {
    const session1 = new SyncQueue(100)
    session1.enqueue('set:s1', () => Promise.resolve({ ...FETCH_FAILURE_RESULT }), UPSERT)
    await vi.runAllTimersAsync()
    expect(session1.journalSize).toBe(1)
    expect(fakeSupabase.calls).toHaveLength(0)

    // Fresh launch, back in signal: the retained entry replays and lands.
    const session2 = new SyncQueue(100)
    await session2.rehydrate()
    await vi.advanceTimersByTimeAsync(100)

    const upserts = fakeSupabase.calls.filter(c => c.op === 'upsert' && c.table === 'sets')
    expect(upserts).toHaveLength(1)
    expect(upserts[0].data).toEqual({ id: 's1', weight: 100 })
    expect(session2.journalSize).toBe(0)
  })

  // A permanently-refused write skips the pointless retries but must NOT skip
  // durability: the LIFT-1169 migrate-db race makes "the client shipped a column
  // before the migration landed" a real 400, and the journal is what turns that
  // into a clean upsert on the launch after the schema catches up.
  it('retains the journal for a permanent (non-retryable) failure (LIFT-1321)', async () => {
    const queue = new SyncQueue(100)
    const op = vi.fn(() => Promise.resolve({
      data: null, status: 400, error: { code: 'PGRST204', message: "column 'gyms' not found" },
    }))
    queue.enqueue('exercise:e1', op, UPSERT)

    await vi.runAllTimersAsync()

    expect(op).toHaveBeenCalledTimes(1) // no retry storm
    expect(queue.journalSize).toBe(1)   // but still durable
    expect(JSON.parse(idbStore.get('lift-sync-journal')!).entries).toHaveLength(1)
    expect(syncStatus.value).toBe('error')
  })

  // Regression LIFT-1213: a same-key correction enqueued while the previous
  // write's flush was still in flight had its journal entry deleted by the
  // OLD write's completion — the correction survived in memory but its
  // durable record was gone, so a reload before the next flush lost it.
  it('does not drop a newer same-key journal entry when an older in-flight op completes (LIFT-1213)', async () => {
    const UPSERT_V2: SyncDescriptor = { op: 'upsert', table: 'sets', row: { id: 's1', weight: 105 } }
    const queue = new SyncQueue(100)

    let resolveOld!: (v: unknown) => void
    queue.enqueue('set:s1', () => new Promise((r) => { resolveOld = r }), UPSERT)

    // Flush starts; the old write is now in flight (queue snapshotted+cleared).
    await vi.advanceTimersByTimeAsync(100)

    // Mid-flight correction to the same record replaces the journal entry.
    queue.enqueue('set:s1', () => Promise.resolve({ data: [], error: null }), UPSERT_V2)
    expect(queue.journalSize).toBe(1)

    // The OLD write completes — it must NOT delete the correction's record.
    resolveOld({ data: [], error: null })
    await vi.advanceTimersByTimeAsync(0)

    expect(queue.journalSize).toBe(1)
    const persisted = JSON.parse(idbStore.get('lift-sync-journal')!)
    expect(persisted.entries).toHaveLength(1)
    expect(persisted.entries[0].descriptor.row).toEqual({ id: 's1', weight: 105 })

    // The correction's own flush still drains the journal normally.
    await vi.advanceTimersByTimeAsync(100)
    expect(queue.journalSize).toBe(0)
  })

  it('clear() wipes the in-memory journal and persists the empty journal', () => {
    const queue = new SyncQueue(500)
    queue.enqueue('set:s1', () => Promise.resolve(), UPSERT)
    expect(queue.journalSize).toBe(1)

    queue.clear()

    expect(queue.journalSize).toBe(0)
    expect(JSON.parse(idbStore.get('lift-sync-journal')!).entries).toHaveLength(0)
  })

  // ── Rehydration ──────────────────────────────────────────────────

  it('rehydrate() replays a journaled upsert through executeDescriptor', async () => {
    // Seed the journal as if a previous session left an unsent write
    idbStore.set('lift-sync-journal', JSON.stringify([
      { key: 'set:s1', isDelete: false, descriptor: UPSERT },
    ]))

    const queue = new SyncQueue(100)
    await queue.rehydrate()
    expect(queue.pending).toBe(1)
    expect(queue.journalSize).toBe(1)

    await vi.advanceTimersByTimeAsync(100)

    // The replayed write reached Supabase, then the journal was cleared
    const upserts = fakeSupabase.calls.filter(c => c.op === 'upsert' && c.table === 'sets')
    expect(upserts).toHaveLength(1)
    expect(upserts[0].data).toEqual({ id: 's1', weight: 100 })
    expect(queue.journalSize).toBe(0)
  })

  it('rehydrate() routes a journaled delete back through the circuit breaker', async () => {
    const deleteDescriptor: SyncDescriptor = {
      op: 'update', table: 'sets', values: { deleted_at: '2026-06-03T00:00:00Z' },
      match: { id: 's1', user_id: 'u1' },
    }
    idbStore.set('lift-sync-journal', JSON.stringify([
      { key: 'set:s1', isDelete: true, descriptor: deleteDescriptor },
    ]))

    const queue = new SyncQueue(100)
    await queue.rehydrate()

    // The delete was counted by the circuit breaker (proves enqueueDelete routing)
    expect(_getCircuitBreakerState().deleteCount).toBe(1)

    await vi.advanceTimersByTimeAsync(100)
    const updates = fakeSupabase.calls.filter(c => c.op === 'update')
    expect(updates).toHaveLength(1)
    expect(updates[0].filters).toMatchObject({ id: 's1', user_id: 'u1' })
  })

  it('rehydrate() is a no-op when the journal is empty', async () => {
    const queue = new SyncQueue(100)
    await queue.rehydrate()
    expect(queue.pending).toBe(0)
  })

  it('rehydrate() does not clobber a newer in-session write for the same key', async () => {
    idbStore.set('lift-sync-journal', JSON.stringify([
      { key: 'set:s1', isDelete: false, descriptor: UPSERT },
    ]))

    const queue = new SyncQueue(100)
    // User logs a fresher version of the same set before rehydrate resolves
    const fresher: SyncDescriptor = { op: 'upsert', table: 'sets', row: { id: 's1', weight: 999 } }
    queue.enqueue('set:s1', () => executeDescriptor(fresher), fresher)

    await queue.rehydrate()
    await vi.advanceTimersByTimeAsync(100)

    // The fresher write won — only weight:999 reached the server
    const upserts = fakeSupabase.calls.filter(c => c.op === 'upsert')
    expect(upserts).toHaveLength(1)
    expect(upserts[0].data).toEqual({ id: 's1', weight: 999 })
  })

  // Regression for the rehydrate + tombstone-resync double-count that would
  // otherwise falsely trip the SEV1 delete circuit breaker (LIFT-706 review).
  it('re-enqueuing a delete for an already-pending key does not double-count the breaker', () => {
    const queue = new SyncQueue(500)
    const deleteDescriptor: SyncDescriptor = {
      op: 'update', table: 'sets', values: { deleted_at: 'x' }, match: { id: 's1' },
    }
    queue.enqueueDelete('set:s1', () => Promise.resolve(), deleteDescriptor)
    queue.enqueueDelete('set:s1', () => Promise.resolve(), deleteDescriptor)
    queue.enqueueDelete('set:s1', () => Promise.resolve(), deleteDescriptor)

    // Same key three times — counts once toward the breaker, not three times.
    expect(_getCircuitBreakerState().deleteCount).toBe(1)
  })
})

describe('executeDescriptor (LIFT-706)', () => {
  beforeEach(() => fakeSupabase.reset())

  it('builds an upsert query from an upsert descriptor', async () => {
    await executeDescriptor({ op: 'upsert', table: 'exercises', row: { id: 'e1', name: 'Bench' } })
    expect(fakeSupabase.calls).toEqual([
      { op: 'upsert', table: 'exercises', data: { id: 'e1', name: 'Bench' }, filters: {}, options: undefined },
    ])
  })

  it('builds an update query with eq filters from an update descriptor', async () => {
    await executeDescriptor({
      op: 'update', table: 'sets',
      values: { deleted_at: null },
      match: { id: 's1', user_id: 'u1' },
    })
    expect(fakeSupabase.calls).toEqual([
      { op: 'update', table: 'sets', data: { deleted_at: null }, filters: { id: 's1', user_id: 'u1' }, options: undefined },
    ])
  })

  // LIFT-1239: user_preferences has a surrogate `id` primary key plus a separate
  // unique(user_id) constraint, and the app upserts a row with no id. Replaying
  // without an explicit conflict target resolves against the PK, generates a new
  // id, and then violates unique(user_id) — so the replay would fail forever.
  it('replays a user_preferences upsert with the user_id conflict target', async () => {
    await executeDescriptor({
      op: 'upsert', table: 'user_preferences',
      row: { user_id: 'u1', preferences: { theme: 'fire' }, updated_at: '2026-08-27T00:00:00Z' },
    })
    expect(fakeSupabase.calls).toHaveLength(1)
    expect(fakeSupabase.calls[0].options).toEqual({ onConflict: 'user_id' })
  })

  it('the preferences store writes the same conflict target it will be replayed with', () => {
    // The conflict target lives in syncQueue (not on the descriptor — a
    // user-writable journal must not choose the conflict column). That makes it
    // a second copy of the value in preferences.ts; if they diverge, the live
    // write and its replay resolve against different constraints.
    const store = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../stores/preferences.ts'),
      'utf-8',
    )
    expect(store).toMatch(/onConflict:\s*'user_id'/)
  })
})

// Replay allowlist: a journaled descriptor lives in user-writable IndexedDB, so
// rehydrate()/executeDescriptor must validate it against an allowlist of tables
// and writable columns before ever building a query (LIFT-785).
describe('replay allowlist (LIFT-785)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    syncStatus.value = 'synced'
    idbStore.clear()
    fakeSupabase.reset()
    _resetRateLimit()
    _resetCircuitBreaker()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('isReplayableDescriptor', () => {
    it('accepts the real descriptors the app produces', () => {
      expect(isReplayableDescriptor({ op: 'upsert', table: 'sets', row: { id: 's1', weight: 100 } })).toBe(true)
      expect(isReplayableDescriptor({ op: 'upsert', table: 'exercises', row: { id: 'e1', name: 'Bench' } })).toBe(true)
      expect(isReplayableDescriptor({
        op: 'update', table: 'sets', values: { deleted_at: null }, match: { id: 's1', user_id: 'u1' },
      })).toBe(true)
      expect(isReplayableDescriptor({
        op: 'update', table: 'exercises', values: { deleted_at: 'x' }, match: { id: 'e1' },
      })).toBe(true)
    })

    it('accepts a set upsert carrying created_at (#846) so offline log-time survives replay', () => {
      // _enqueueSetUpsert now sends the real log-time `created_at` so an offline
      // set keeps its training time. The descriptor it journals must be
      // replayable — otherwise rehydrate() drops the entry and the offline set
      // is never synced (the exact failure #846 exists to prevent).
      expect(isReplayableDescriptor({
        op: 'upsert', table: 'sets',
        row: {
          id: 's1', user_id: 'u1', exercise_id: 'e1', date: '2026-06-20T23:59:30.000Z',
          weight: 185, reps: 5, estimated_1rm: 216, created_at: '2026-06-20T18:45:00.000Z',
        },
      })).toBe(true)
    })

    it('accepts a full-fidelity exercise upsert (every column _buildExerciseUpsert sends)', () => {
      // Regression for LIFT-1039: the allowlist had drifted behind the producer.
      // `_buildExerciseUpsert` always sends `equipment` (#931), `gyms` (#961),
      // `plate_count_mode` (LIFT-783), `notes` (#619) and `bodyweight_loaded`
      // (LIFT-834) — none of which were allowlisted — so isReplayableDescriptor
      // rejected EVERY journaled exercise upsert, silently dropping offline
      // exercise writes on rehydrate(). Assert the exact shape.
      //
      // This literal pins the shape as of today; it CANNOT catch the next
      // column added to the producer. The structural guard that does is
      // `REPLAYABLE_COLUMNS stays in lockstep with its producers` in
      // architecturalInvariants.test.ts — keep both.
      expect(isReplayableDescriptor({
        op: 'upsert', table: 'exercises',
        row: {
          id: 'e1', user_id: 'u1', name: 'Bench', tags: ['Push'], archived_at: null,
          input_mode: 'plates', bar_weight: 45, plate_count_mode: 'total',
          intensity_max_reps: null, equipment: 'free_weight', gyms: ['Home'],
          notes: 'paused reps', bodyweight_loaded: false,
        },
      })).toBe(true)
    })

    it('tolerates retired-but-dormant DB columns so legacy offline writes still replay', () => {
      // warmup_scheme was retired in #770 but the column still exists in the DB.
      // An offline write journaled by a pre-#770 client must not be dropped.
      expect(isReplayableDescriptor({
        op: 'upsert', table: 'exercises',
        row: { id: 'e1', user_id: 'u1', name: 'Bench', warmup_scheme: [] },
      })).toBe(true)
    })

    it('accepts the descriptors the bodyweight / preferences / progression stores produce (LIFT-1239)', () => {
      // These three stores previously enqueued WITHOUT a descriptor, so an
      // offline write was lost on a close before the flush. Their real payload
      // shapes must clear the allowlist or rehydrate() would silently drop them.
      expect(isReplayableDescriptor({
        op: 'upsert', table: 'bodyweight_entries',
        row: { id: 'b1', user_id: 'u1', date: '2026-08-27T23:59:00.000Z', weight: 182.4 },
      })).toBe(true)
      expect(isReplayableDescriptor({
        op: 'update', table: 'bodyweight_entries',
        values: { deleted_at: null }, match: { id: 'b1', user_id: 'u1' },
      })).toBe(true)
      expect(isReplayableDescriptor({
        op: 'upsert', table: 'user_preferences',
        row: { user_id: 'u1', preferences: { theme: 'eternal' }, updated_at: '2026-08-27T00:00:00Z' },
      })).toBe(true)
      expect(isReplayableDescriptor({
        op: 'upsert', table: 'user_progression',
        row: {
          user_id: 'u1', total_xp: 4200, streak_weeks: 3, weekly_target: 4,
          pending_target_change: null, show_progression: true, progression_enabled: true,
          unlocked_themes: [], starter_theme: 'pearl', starter_confirmed: true, epoch: 1,
          streak_history: [], xp_per_set: {}, bodyweight_xp_dates: [],
        },
      })).toBe(true)
    })

    it('rejects unknown tables, columns, and ops', () => {
      // Table not in the allowlist (e.g. a tampered entry targeting auth state)
      expect(isReplayableDescriptor({ op: 'upsert', table: 'coach_usage', row: { request_count: 0 } })).toBe(false)
      expect(isReplayableDescriptor({ op: 'upsert', table: 'profiles', row: { is_admin: true } })).toBe(false)
      // A journaled table still rejects a column it doesn't own
      expect(isReplayableDescriptor({ op: 'upsert', table: 'user_progression', row: { is_admin: true } })).toBe(false)
      // Column not writable on an allowlisted table
      expect(isReplayableDescriptor({ op: 'upsert', table: 'sets', row: { id: 's1', injected: 1 } })).toBe(false)
      // Op outside the idempotent upsert/update set
      expect(isReplayableDescriptor({ op: 'delete', table: 'sets', row: { id: 's1' } })).toBe(false)
    })

    it('rejects malformed shapes without throwing', () => {
      const malformed: unknown[] = [
        null, undefined, 42, 'sets', [], {},
        { op: 'upsert', table: 'sets' },               // missing row
        { op: 'upsert', table: 'sets', row: null },    // null row
        { op: 'upsert', table: 'sets', row: [] },      // array row
        { op: 'upsert', table: 'sets', row: {} },      // empty row
        { op: 'update', table: 'sets', values: { deleted_at: 'x' }, match: {} }, // empty match → would hit every row
        { op: 'update', table: 'sets', values: {}, match: { id: 's1' } },        // empty values
      ]
      for (const d of malformed) {
        expect(isReplayableDescriptor(d)).toBe(false)
      }
    })
  })

  it('executeDescriptor refuses to issue a write for a non-allowlisted table', async () => {
    await executeDescriptor({ op: 'upsert', table: 'profiles', row: { id: 'x' } } as unknown as SyncDescriptor)
    expect(fakeSupabase.calls).toHaveLength(0)
  })

  it('executeDescriptor refuses an update whose match would target the whole table', async () => {
    await executeDescriptor({
      op: 'update', table: 'sets', values: { deleted_at: 'x' }, match: {},
    } as unknown as SyncDescriptor)
    expect(fakeSupabase.calls).toHaveLength(0)
  })

  it('rehydrate() drops a tampered journal entry and replays only the valid ones', async () => {
    idbStore.set('lift-sync-journal', JSON.stringify([
      // Tampered: targets a table outside the allowlist
      { key: 'evil:1', isDelete: false, descriptor: { op: 'upsert', table: 'profiles', row: { is_admin: true } } },
      // Tampered: an unbounded delete on the whole sets table
      { key: 'evil:2', isDelete: true, descriptor: { op: 'update', table: 'sets', values: { deleted_at: 'x' }, match: {} } },
      // Legitimate write that must still replay
      { key: 'set:s1', isDelete: false, descriptor: UPSERT },
    ]))

    const queue = new SyncQueue(100)
    await queue.rehydrate()

    // Only the legitimate entry was enqueued/journaled
    expect(queue.pending).toBe(1)
    expect(queue.journalSize).toBe(1)

    await vi.advanceTimersByTimeAsync(100)

    // Exactly one write reached Supabase — the valid set upsert
    expect(fakeSupabase.calls).toHaveLength(1)
    expect(fakeSupabase.calls[0]).toMatchObject({ op: 'upsert', table: 'sets', data: { id: 's1', weight: 100 } })
  })
})

// Schema-version envelope: a journal written under an older schema generation
// may reference columns a migration has since renamed/removed, so it is dropped
// wholesale on rehydrate rather than replayed into silent PostgREST failures
// (LIFT-1132).
describe('journal schema versioning (LIFT-1132)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    syncStatus.value = 'synced'
    idbStore.clear()
    fakeSupabase.reset()
    _resetRateLimit()
    _resetCircuitBreaker()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('persists journals inside a versioned envelope stamped with the current generation', () => {
    const queue = new SyncQueue(500)
    queue.enqueue('set:s1', () => Promise.resolve(), UPSERT)

    const persisted = JSON.parse(idbStore.get('lift-sync-journal')!)
    expect(persisted.version).toBe(JOURNAL_SCHEMA_VERSION)
    expect(persisted.entries).toHaveLength(1)
  })

  it('rehydrate() replays a journal stamped with the current schema version', async () => {
    idbStore.set('lift-sync-journal', JSON.stringify({
      version: JOURNAL_SCHEMA_VERSION,
      entries: [{ key: 'set:s1', isDelete: false, descriptor: UPSERT }],
    }))

    const queue = new SyncQueue(100)
    await queue.rehydrate()
    expect(queue.pending).toBe(1)

    await vi.advanceTimersByTimeAsync(100)
    expect(fakeSupabase.calls.filter(c => c.op === 'upsert')).toHaveLength(1)
  })

  it('rehydrate() discards a journal written under an older schema version', async () => {
    idbStore.set('lift-sync-journal', JSON.stringify({
      version: JOURNAL_SCHEMA_VERSION - 1,
      entries: [{ key: 'set:s1', isDelete: false, descriptor: UPSERT }],
    }))

    const queue = new SyncQueue(100)
    await queue.rehydrate()

    // Nothing was enqueued or journaled from the stale generation…
    expect(queue.pending).toBe(0)
    await vi.advanceTimersByTimeAsync(100)
    expect(fakeSupabase.calls).toHaveLength(0)
    // …and the stale record on disk was wiped so it isn't re-read next launch.
    expect(JSON.parse(idbStore.get('lift-sync-journal')!)).toEqual({
      version: JOURNAL_SCHEMA_VERSION,
      entries: [],
    })
  })

  it('rehydrate() discards a journal from a newer (unknown) schema version', async () => {
    idbStore.set('lift-sync-journal', JSON.stringify({
      version: JOURNAL_SCHEMA_VERSION + 1,
      entries: [{ key: 'set:s1', isDelete: false, descriptor: UPSERT }],
    }))

    const queue = new SyncQueue(100)
    await queue.rehydrate()

    expect(queue.pending).toBe(0)
    await vi.advanceTimersByTimeAsync(100)
    expect(fakeSupabase.calls).toHaveLength(0)
  })

  it('rehydrate() treats a legacy bare-array journal as the current generation and replays it', async () => {
    // Pre-LIFT-1132 journals were a bare PersistedEntry[] with no version. They
    // must still replay — dropping valid pending writes merely because they
    // predate the envelope would defeat the durable queue on the very upgrade
    // that introduces versioning.
    idbStore.set('lift-sync-journal', JSON.stringify([
      { key: 'set:s1', isDelete: false, descriptor: UPSERT },
    ]))

    const queue = new SyncQueue(100)
    await queue.rehydrate()
    expect(queue.pending).toBe(1)

    await vi.advanceTimersByTimeAsync(100)
    expect(fakeSupabase.calls.filter(c => c.op === 'upsert')).toHaveLength(1)
  })
})
