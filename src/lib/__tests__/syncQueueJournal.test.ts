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
    upsert(data: unknown) { this.op = 'upsert'; this.data = data; return this }
    update(data: unknown) { this.op = 'update'; this.data = data; return this }
    eq(col: string, val: unknown) { this.filters[col] = val; return this }
    then<T>(onfulfilled: (v: { data: unknown[]; error: null }) => T): PromiseLike<T> {
      this.parent.calls.push({ op: this.op, table: this.table, data: this.data, filters: { ...this.filters } })
      return Promise.resolve({ data: [], error: null }).then(onfulfilled)
    }
  }
  const fake = {
    calls: [] as Array<{ op: string; table: string; data: unknown; filters: Record<string, unknown> }>,
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
  type SyncDescriptor,
} from '../syncQueue'

const UPSERT: SyncDescriptor = { op: 'upsert', table: 'sets', row: { id: 's1', weight: 100 } }

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
    expect(persisted).toHaveLength(1)
    expect(persisted[0]).toMatchObject({ key: 'set:s1', isDelete: false, descriptor: UPSERT })
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
    expect(JSON.parse(idbStore.get('lift-sync-journal')!)).toHaveLength(0)
  })

  it('keeps the entry journaled across retries, then drops it after exhausting them', async () => {
    const queue = new SyncQueue(100)
    queue.enqueue('set:s1', () => Promise.reject(new Error('offline')), UPSERT)

    // First failed attempt — still journaled (will retry)
    await vi.advanceTimersByTimeAsync(100)
    expect(queue.journalSize).toBe(1)

    // Run all retries to exhaustion — op is dropped, journal cleared
    await vi.runAllTimersAsync()
    expect(queue.journalSize).toBe(0)
  })

  it('clear() wipes the in-memory journal and persists the empty journal', () => {
    const queue = new SyncQueue(500)
    queue.enqueue('set:s1', () => Promise.resolve(), UPSERT)
    expect(queue.journalSize).toBe(1)

    queue.clear()

    expect(queue.journalSize).toBe(0)
    expect(JSON.parse(idbStore.get('lift-sync-journal')!)).toHaveLength(0)
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
      { op: 'upsert', table: 'exercises', data: { id: 'e1', name: 'Bench' }, filters: {} },
    ])
  })

  it('builds an update query with eq filters from an update descriptor', async () => {
    await executeDescriptor({
      op: 'update', table: 'sets',
      values: { deleted_at: null },
      match: { id: 's1', user_id: 'u1' },
    })
    expect(fakeSupabase.calls).toEqual([
      { op: 'update', table: 'sets', data: { deleted_at: null }, filters: { id: 's1', user_id: 'u1' } },
    ])
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

    it('rejects unknown tables, columns, and ops', () => {
      // Table not in the allowlist (e.g. a tampered entry targeting auth state)
      expect(isReplayableDescriptor({ op: 'upsert', table: 'user_progression', row: { id: 'x' } })).toBe(false)
      expect(isReplayableDescriptor({ op: 'upsert', table: 'profiles', row: { is_admin: true } })).toBe(false)
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
