/**
 * Reactive sync-queue facts (LIFT-1323).
 *
 * The counts the sync-status sheet reads, and the one that matters: `stranded`
 * — journaled writes with nothing left retrying them. Before this existed, a
 * write that exhausted its retries (or that the server refused outright) kept
 * its durable journal entry, left the in-memory queue, and became invisible the
 * moment any OTHER key flushed cleanly and set `syncStatus` back to 'synced'.
 * That is the app's worst failure class — permanent silent divergence — and it
 * had no representation anywhere in the UI.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../durableStorage', () => ({
  backupToIDB: vi.fn(),
  restoreFromIDB: vi.fn(async () => null),
}))
vi.mock('../supabase', () => ({ supabase: {}, isPreviewMode: { value: false } }))
vi.mock('../crossTabSync', () => ({ broadcastSyncStatus: vi.fn() }))
vi.mock('../logger', () => ({ logError: vi.fn(), logWarn: vi.fn(), logInfo: vi.fn() }))

import { SyncQueue, syncStatus, _resetRateLimit, type SyncDescriptor } from '../syncQueue'
import { syncQueueStats, publishSyncQueueStats, resetSyncQueueStats, formatSyncAge } from '../syncActivity'
import { FAKE_NETWORK_ERROR_RESULT } from '../../__tests__/fakeSupabase'

/** A journalable upsert, so the write leaves a durable entry to strand. */
function descriptor(id: string): SyncDescriptor {
  return { op: 'upsert', table: 'sets', row: { id, user_id: 'u1', exercise_id: 'e1', weight: 100, reps: 5 } }
}

/** The envelope PostgREST resolves for a refusal it will repeat (LIFT-1321). */
const REFUSED = { data: null, error: { code: '23505', message: 'duplicate key' }, status: 409 }

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true })
}

describe('formatSyncAge', () => {
  it('reads anything under a minute as "just now"', () => {
    expect(formatSyncAge(0)).toBe('just now')
    expect(formatSyncAge(59_999)).toBe('just now')
  })

  it('singularises the first of each unit', () => {
    expect(formatSyncAge(60_000)).toBe('1 minute ago')
    expect(formatSyncAge(3_600_000)).toBe('1 hour ago')
    expect(formatSyncAge(86_400_000)).toBe('1 day ago')
  })

  it('pluralises beyond the first', () => {
    expect(formatSyncAge(5 * 60_000)).toBe('5 minutes ago')
    expect(formatSyncAge(3 * 3_600_000)).toBe('3 hours ago')
    expect(formatSyncAge(2 * 86_400_000)).toBe('2 days ago')
  })

  // A clock adjustment between the stamp and the read produces a negative age.
  // "-3 minutes ago" is worse than a harmless rounding to the nearest truth.
  it('degrades a future stamp to "just now" instead of a negative age', () => {
    expect(formatSyncAge(-60_000)).toBe('just now')
  })
})

describe('publishSyncQueueStats', () => {
  beforeEach(() => resetSyncQueueStats())

  it('keeps the same object identity when nothing changed', () => {
    const before = syncQueueStats.value
    publishSyncQueueStats({ pending: 0, journaled: 0, stranded: 0 })
    expect(syncQueueStats.value).toBe(before)
  })

  it('replaces the snapshot when any count moves', () => {
    publishSyncQueueStats({ pending: 1, journaled: 1, stranded: 0 })
    expect(syncQueueStats.value).toEqual({ pending: 1, journaled: 1, stranded: 0 })
  })
})

describe('SyncQueue publishes its state (LIFT-1323)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    syncStatus.value = 'synced'
    setOnline(true)
    _resetRateLimit()
    resetSyncQueueStats()
  })

  afterEach(() => {
    vi.useRealTimers()
    setOnline(true)
  })

  it('counts a queued write as pending, not stranded', () => {
    const queue = new SyncQueue(500)
    queue.enqueue('set:1', vi.fn().mockResolvedValue({ error: null }), descriptor('1'))

    expect(syncQueueStats.value).toEqual({ pending: 1, journaled: 1, stranded: 0 })
  })

  it('clears both counts once the write lands', async () => {
    const queue = new SyncQueue(500)
    queue.enqueue('set:1', vi.fn().mockResolvedValue({ error: null }), descriptor('1'))

    await vi.runAllTimersAsync()

    expect(syncQueueStats.value).toEqual({ pending: 0, journaled: 0, stranded: 0 })
  })

  // The whole point. A refusal the server will repeat leaves the queue after
  // ONE attempt (LIFT-1321) but keeps its journal entry (LIFT-1229) — so it is
  // unsent, unattended, and was previously invisible.
  it('counts a refused write as stranded once it leaves the queue', async () => {
    const queue = new SyncQueue(500)
    queue.enqueue('set:1', vi.fn().mockResolvedValue(REFUSED), descriptor('1'))

    await vi.runAllTimersAsync()

    expect(syncQueueStats.value).toEqual({ pending: 0, journaled: 1, stranded: 1 })
  })

  // The regression this whole feature exists for: a LATER clean flush of an
  // unrelated key used to reset the indicator to 'synced' while the stranded
  // write sat in the journal. The count must survive that.
  it('keeps the stranded write counted after an unrelated key flushes cleanly', async () => {
    const queue = new SyncQueue(500)
    queue.enqueue('set:1', vi.fn().mockResolvedValue(REFUSED), descriptor('1'))
    await vi.runAllTimersAsync()

    queue.enqueue('set:2', vi.fn().mockResolvedValue({ error: null }), descriptor('2'))
    await vi.runAllTimersAsync()

    expect(syncStatus.value).toBe('synced')
    expect(syncQueueStats.value.stranded).toBe(1)
  })

  // A write still climbing the backoff ladder is being attended to; calling it
  // stranded would light the indicator on every transient blip.
  it('counts a retrying write as pending, not stranded', async () => {
    const queue = new SyncQueue(500)
    queue.enqueue('set:1', vi.fn().mockResolvedValue(FAKE_NETWORK_ERROR_RESULT), descriptor('1'))

    await vi.advanceTimersByTimeAsync(500)

    expect(syncQueueStats.value).toEqual({ pending: 1, journaled: 1, stranded: 0 })
  })

  // Offline PARKS the queue (LIFT-1322) — the ops are intact and will be sent.
  it('counts a parked offline write as pending, not stranded', async () => {
    const queue = new SyncQueue(500)
    queue.enqueue('set:1', vi.fn().mockResolvedValue({ error: null }), descriptor('1'))
    setOnline(false)

    await vi.advanceTimersByTimeAsync(500)

    expect(syncStatus.value).toBe('offline')
    expect(syncQueueStats.value).toEqual({ pending: 1, journaled: 1, stranded: 0 })
  })

  // `flush()` empties `_queue` before awaiting, so a write enqueued mid-flush
  // would publish its in-flight siblings as stranded — flashing "Sync failed"
  // on an ordinary logged set. `_inFlightKeys` is what prevents that.
  it('does not report an in-flight write as stranded when another write arrives mid-flush', async () => {
    const queue = new SyncQueue(500)
    let release: (v: { error: null }) => void = () => {}
    const slow = vi.fn(() => new Promise<{ error: null }>((res) => { release = res }))
    queue.enqueue('set:1', slow, descriptor('1'))

    await vi.advanceTimersByTimeAsync(500)
    expect(slow).toHaveBeenCalledOnce()

    // Second write lands while the first is still in flight.
    queue.enqueue('set:2', vi.fn().mockResolvedValue({ error: null }), descriptor('2'))
    expect(syncQueueStats.value.stranded).toBe(0)

    release({ error: null })
    await vi.runAllTimersAsync()
    expect(syncQueueStats.value).toEqual({ pending: 0, journaled: 0, stranded: 0 })
  })

  it('replayJournal re-arms a stranded write, clearing the stranded count', async () => {
    const queue = new SyncQueue(500)
    const op = vi.fn().mockResolvedValue(FAKE_NETWORK_ERROR_RESULT)
    queue.enqueue('set:1', op, descriptor('1'))
    // Burn the whole retry budget so the op leaves the queue but is retained.
    await vi.runAllTimersAsync()
    expect(syncQueueStats.value.stranded).toBe(1)

    expect(queue.replayJournal()).toBe(1)
    expect(syncQueueStats.value).toEqual({ pending: 1, journaled: 1, stranded: 0 })
  })

  // A key the server REFUSED is barred from ambient replay (re-issuing it on
  // every reconnect can only reproduce the refusal), but a user tapping "Try
  // again" is not ambient — that is the one caller allowed past the bar.
  it('replayJournal skips a refused key by default and re-arms it on request', async () => {
    const queue = new SyncQueue(500)
    queue.enqueue('set:1', vi.fn().mockResolvedValue(REFUSED), descriptor('1'))
    await vi.runAllTimersAsync()

    expect(queue.replayJournal()).toBe(0)
    expect(queue.replayJournal({ includeRefused: true })).toBe(1)
    expect(syncQueueStats.value.stranded).toBe(0)
  })

  it('clear() wipes the published snapshot', async () => {
    const queue = new SyncQueue(500)
    queue.enqueue('set:1', vi.fn().mockResolvedValue({ error: null }), descriptor('1'))
    expect(syncQueueStats.value.pending).toBe(1)

    queue.clear()

    expect(syncQueueStats.value).toEqual({ pending: 0, journaled: 0, stranded: 0 })
  })
})
