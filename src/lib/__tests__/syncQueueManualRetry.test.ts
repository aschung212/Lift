/**
 * Stranded writes, the reactive pending count, and manual retry (LIFT-1323).
 *
 * Two failures are pinned here, both about a write the app has stopped chasing:
 *
 *  1. `syncStatus` reflects only the LAST batch. A write that exhausted its
 *     retries — or was refused outright (LIFT-1321) — left the indicator on
 *     'error' only until some unrelated later write flushed cleanly, after
 *     which the app looked fully synced while holding local-only rows the
 *     server has never seen. That is the "persistent silent divergence" the
 *     sync sheet exists to expose, and nothing in the app could see it: the
 *     only record was a Sentry log.
 *
 *  2. Neither automatic path can reach those writes on demand. `flush()` runs
 *     `_queue` only, so a backoff-parked write waits out up to a minute, and a
 *     given-up write is replayed only by `rehydrate()` on the NEXT launch. A
 *     "Sync now" button that skipped both would be a placebo for exactly the
 *     failures that make a user press it.
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
    private parent: { calls: unknown[]; result: unknown }
    constructor(parent: { calls: unknown[]; result: unknown }, table: string) {
      this.parent = parent
      this.table = table
    }
    upsert(data: unknown) { this.op = 'upsert'; this.data = data; return this }
    update(data: unknown) { this.op = 'update'; this.data = data; return this }
    eq() { return this }
    then<T>(onfulfilled: (v: unknown) => T): PromiseLike<T> {
      this.parent.calls.push({ op: this.op, table: this.table, data: this.data })
      return Promise.resolve(this.parent.result).then(onfulfilled)
    }
  }
  const fake = {
    calls: [] as Array<{ op: string; table: string; data: unknown }>,
    /** What a rebuilt descriptor query resolves with. */
    result: { data: [], error: null } as unknown,
    from(table: string) { return new FakeBuilder(this, table) },
    reset() { this.calls = []; this.result = { data: [], error: null } },
  }
  return { fakeSupabase: fake }
})
vi.mock('../supabase', () => ({ supabase: fakeSupabase, isPreviewMode: { value: false } }))
vi.mock('../crossTabSync', () => ({ broadcastSyncStatus: vi.fn() }))
vi.mock('../logger', () => ({ logError: vi.fn(), logWarn: vi.fn(), logInfo: vi.fn() }))

import {
  SyncQueue,
  syncStatus,
  pendingSyncCount,
  strandedSyncCount,
  _resetRateLimit,
  _resetCircuitBreaker,
  _getCircuitBreakerState,
  type SyncDescriptor,
} from '../syncQueue'
import { combineSyncStatus, lastSyncedAt, clearLastSynced } from '../syncStatus'
import { FAKE_NETWORK_ERROR_RESULT } from '../../__tests__/fakeSupabase'

/** A write the server UNDERSTOOD and refused — terminal on the first attempt. */
const REFUSED = { error: { code: '23505', message: 'duplicate key value' }, status: 409 }

function descriptorFor(id: string): SyncDescriptor {
  return { op: 'upsert', table: 'sets', row: { id, user_id: 'u1', reps: 5 } }
}

async function settleFlush(queue: SyncQueue, delay = 500) {
  vi.advanceTimersByTime(delay)
  await vi.runAllTimersAsync()
}

describe('stranded writes (LIFT-1323)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    syncStatus.value = 'synced'
    pendingSyncCount.value = 0
    strandedSyncCount.value = 0
    clearLastSynced()
    idbStore.clear()
    fakeSupabase.reset()
    _resetRateLimit()
    _resetCircuitBreaker()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('counts an unflushed write as pending and clears it once the server confirms', () => {
    const queue = new SyncQueue(500)
    queue.enqueue('set:1', () => Promise.resolve({ error: null }), descriptorFor('1'))
    expect(pendingSyncCount.value).toBe(1)
    return settleFlush(queue).then(() => {
      expect(pendingSyncCount.value).toBe(0)
      expect(strandedSyncCount.value).toBe(0)
    })
  })

  it('counts a write in the queue AND the journal once, not twice', () => {
    // The number goes in front of the user as "N changes waiting to sync", so
    // it has to mean changes, not internal bookkeeping entries.
    const queue = new SyncQueue(500)
    queue.enqueue('set:1', () => Promise.resolve({ error: null }), descriptorFor('1'))
    queue.enqueue('set:2', () => Promise.resolve({ error: null }), descriptorFor('2'))
    expect(pendingSyncCount.value).toBe(2)
  })

  it('keeps a refused write visible after a LATER write flushes cleanly', async () => {
    const queue = new SyncQueue(500)
    queue.enqueue('set:1', () => Promise.resolve(REFUSED), descriptorFor('1'))
    await settleFlush(queue)

    expect(syncStatus.value).toBe('error')
    expect(strandedSyncCount.value).toBe(1)

    // An unrelated write now succeeds. This is the moment the old behaviour
    // went quiet: the batch had no failures, so `syncStatus` reset to 'synced'
    // and the indicator disappeared while set:1 was still local-only.
    queue.enqueue('set:2', () => Promise.resolve({ error: null }), descriptorFor('2'))
    await settleFlush(queue)

    expect(syncStatus.value).toBe('synced')
    expect(strandedSyncCount.value).toBe(1)
    expect(pendingSyncCount.value).toBe(1)
    // Which is what keeps the (now tappable) indicator on screen.
    expect(combineSyncStatus(syncStatus.value, null, strandedSyncCount.value)).toBe('error')
  })

  it('does not strand a descriptor-less write, which nothing could replay', async () => {
    const queue = new SyncQueue(500)
    queue.enqueue('telemetry', () => Promise.resolve(REFUSED))
    await settleFlush(queue)

    expect(syncStatus.value).toBe('error')
    expect(strandedSyncCount.value).toBe(0)
  })

  it('un-strands a key when a fresh write for it supersedes the failed one', async () => {
    const queue = new SyncQueue(500)
    queue.enqueue('set:1', () => Promise.resolve(REFUSED), descriptorFor('1'))
    await settleFlush(queue)
    expect(strandedSyncCount.value).toBe(1)

    queue.enqueue('set:1', () => Promise.resolve({ error: null }), descriptorFor('1'))
    expect(strandedSyncCount.value).toBe(0)
  })

  it('stamps lastSyncedAt on a clean batch and leaves it alone on a failed one', async () => {
    const queue = new SyncQueue(500)
    queue.enqueue('set:1', () => Promise.resolve(REFUSED), descriptorFor('1'))
    await settleFlush(queue)
    expect(lastSyncedAt.value).toBeNull()

    queue.enqueue('set:2', () => Promise.resolve({ error: null }), descriptorFor('2'))
    await settleFlush(queue)
    expect(lastSyncedAt.value).not.toBeNull()
  })
})

describe('retryNow (LIFT-1323)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    syncStatus.value = 'synced'
    pendingSyncCount.value = 0
    strandedSyncCount.value = 0
    clearLastSynced()
    idbStore.clear()
    fakeSupabase.reset()
    _resetRateLimit()
    _resetCircuitBreaker()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rebuilds a given-up write from its journal and lands it', async () => {
    const queue = new SyncQueue(500)
    queue.enqueue('set:1', () => Promise.resolve(REFUSED), descriptorFor('1'))
    await settleFlush(queue)
    expect(strandedSyncCount.value).toBe(1)
    expect(queue.pending).toBe(0) // nothing left in memory to flush

    // Without retryNow this write waits for the next app launch.
    queue.retryNow()
    expect(queue.pending).toBe(1)
    await queue.flush()

    expect(fakeSupabase.calls).toEqual([
      { op: 'upsert', table: 'sets', data: { id: '1', user_id: 'u1', reps: 5 } },
    ])
    expect(strandedSyncCount.value).toBe(0)
    expect(pendingSyncCount.value).toBe(0)
    expect(syncStatus.value).toBe('synced')
  })

  it('promotes a backoff-parked write instead of waiting out its delay', async () => {
    const queue = new SyncQueue(500)
    const op = vi.fn().mockResolvedValue(FAKE_NETWORK_ERROR_RESULT)
    queue.enqueue('set:1', op, descriptorFor('1'))
    // Advance only as far as the first flush — the retry backoff is a second
    // out, so the write is now parked where `flush()` alone can never see it.
    await vi.advanceTimersByTimeAsync(500)
    expect(op).toHaveBeenCalledTimes(1)

    op.mockResolvedValue({ error: null })
    await queue.flush()
    expect(op).toHaveBeenCalledTimes(1)

    queue.retryNow()
    await queue.flush()
    expect(op).toHaveBeenCalledTimes(2)
    expect(pendingSyncCount.value).toBe(0)
  })

  it('restores the retry budget so a promoted write is not terminal on its first attempt', async () => {
    const queue = new SyncQueue(500)
    const op = vi.fn().mockResolvedValue(FAKE_NETWORK_ERROR_RESULT)
    queue.enqueue('set:1', op, descriptorFor('1'))

    // Burn every retry. The key's attempt counter is left AT MAX — only a
    // *permanent* failure clears it — so a manual retry that inherited it would
    // go terminal on its very first new attempt, with no backoff and no second
    // chance, defeating the button for the writes that most need it.
    await settleFlush(queue)
    expect(strandedSyncCount.value).toBe(1)
    expect(queue.pending).toBe(0)

    // The rebuilt descriptor query fails the same (retryable) way.
    fakeSupabase.result = FAKE_NETWORK_ERROR_RESULT
    queue.retryNow()
    await queue.flush()

    // Back in the retry queue with a fresh budget rather than straight back to
    // stranded — `pending` would be 0 if the exhausted counter had carried over.
    expect(queue.pending).toBe(1)
    expect(fakeSupabase.calls).toHaveLength(1)
  })

  it('keeps a replayed delete visible to the SEV1 circuit breaker', async () => {
    // The 2026-04-12 SEV1 destroyed ~40-60% of a user's data via runaway
    // deletes, and the breaker is the third layer of defence against a repeat.
    // rehydrate() routes journaled deletes back through enqueueDelete for
    // exactly this reason; a manual replay that promoted them straight into
    // `_queue` would hand a delete storm a way around the guard.
    const queue = new SyncQueue(500)
    const descriptor: SyncDescriptor = {
      op: 'update', table: 'sets', values: { deleted_at: 'now' }, match: { id: '1' },
    }
    queue.enqueueDelete('set-del:1', () => Promise.resolve(REFUSED), descriptor)
    await settleFlush(queue)
    expect(strandedSyncCount.value).toBe(1)

    // Reset first: the breaker counts over a 10s rolling window, and settling
    // the flush above ran the timers well past it, so a raw before/after
    // comparison would measure the prune rather than the routing.
    _resetCircuitBreaker()
    queue.retryNow()

    expect(_getCircuitBreakerState().deleteCount).toBe(1)
  })

  it('is a no-op with nothing outstanding', () => {
    const queue = new SyncQueue(500)
    queue.retryNow()
    expect(queue.pending).toBe(0)
    expect(pendingSyncCount.value).toBe(0)
  })
})
