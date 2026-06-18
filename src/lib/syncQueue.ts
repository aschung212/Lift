import { ref } from 'vue'
import { supabase, isPreviewMode } from './supabase'
import { logError, logWarn } from './logger'
import { broadcastSyncStatus } from './crossTabSync'
import { backupToIDB, restoreFromIDB } from './durableStorage'

type SyncOperation = () => PromiseLike<unknown>

/**
 * Serializable description of a Supabase mutation (LIFT-706).
 *
 * The in-memory queue holds closures, which cannot survive a tab close or
 * app restart. To harden offline writes — where every logged set is hard-won
 * data — a closure may be accompanied by a `SyncDescriptor`: a plain,
 * JSON-serializable record of the same mutation. Descriptors are journaled to
 * IndexedDB so that pending writes can be rehydrated and replayed after the
 * app reopens, even if the original closure (and its captured scope) is gone.
 *
 * Only idempotent shapes are modeled (upsert / update), matching the
 * idempotency invariant enforced in architecturalInvariants.test.ts — replay
 * is safe because re-running an upsert or a targeted update is a no-op once the
 * server already holds the value.
 */
export type SyncDescriptor =
  | { op: 'upsert'; table: string; row: Record<string, unknown> }
  | { op: 'update'; table: string; values: Record<string, unknown>; match: Record<string, unknown> }

interface JournalEntry {
  descriptor: SyncDescriptor
  isDelete: boolean
}

/** IndexedDB key (in the shared durable-storage keyval store) for the queue journal. */
const JOURNAL_KEY = 'lift-sync-journal'

/**
 * Rebuild a runnable Supabase operation from its serializable descriptor.
 * Used to replay journaled writes after a reload. Returns a no-op promise when
 * Supabase is unavailable so replay degrades gracefully offline.
 */
export function executeDescriptor(descriptor: SyncDescriptor): PromiseLike<unknown> {
  if (!supabase) return Promise.resolve()
  // The table name is dynamic here (driven by the descriptor), so the strongly
  // typed supabase client surface doesn't apply — cast to a loose client.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = supabase as any
  if (descriptor.op === 'upsert') {
    return client.from(descriptor.table).upsert(descriptor.row)
  }
  let query = client.from(descriptor.table).update(descriptor.values)
  for (const [col, val] of Object.entries(descriptor.match)) {
    query = query.eq(col, val)
  }
  return query
}

/** Reactive sync status for UI indicators. */
export const syncStatus = ref<'synced' | 'syncing' | 'error' | 'offline'>('synced')

// Rate limiting: max operations per window
const RATE_LIMIT_MAX = 200
const RATE_LIMIT_WINDOW = 60_000 // 1 minute
let _rateCount = 0
let _rateResetTimer: ReturnType<typeof setTimeout> | null = null
// Deferred operations that exceeded the rate limit — processed in the next window
const _deferredOps = new Map<string, SyncOperation>()

// Circuit breaker: defense-in-depth against runaway delete storms.
//
// Motivation: the SEV1 on 2026-04-12 destroyed ~40-60% of one user's
// workout data because a client dedup heuristic broadcast DELETEs from
// _fetchFromSupabase every sync cycle. PR #338 removed that specific
// code path; PR #354 added behavioral regression coverage. This breaker
// is the third layer: even if a future bug reintroduces runaway deletes,
// the breaker trips after N deletes in a short window, blocks further
// deletes for a cool-down period, and raises a Sentry error so we find
// out before data is lost.
//
// Thresholds are deliberately loose — a user deleting one set at a time
// or one whole exercise (2 ops) never gets near 20/10s. Only bug-shaped
// delete patterns trip the breaker.
const CIRCUIT_BREAKER_ENABLED = true
const CIRCUIT_BREAKER_WINDOW_MS = 10_000
const CIRCUIT_BREAKER_THRESHOLD = 20
const CIRCUIT_BREAKER_COOLDOWN_MS = 60_000
let _deleteTimestamps: number[] = []
let _circuitOpenUntil = 0
let _circuitTripCount = 0

/**
 * Batches and debounces Supabase sync operations with retry.
 *
 * Enqueued operations are held for `flushDelay` ms. If more operations
 * arrive within that window the timer resets, coalescing rapid mutations
 * into a single flush. Operations sharing the same `key` are deduplicated
 * — only the latest version runs.
 *
 * Failed operations are retried with exponential backoff up to `maxRetries`.
 */
export class SyncQueue {
  private _queue = new Map<string, SyncOperation>()
  private _timer: ReturnType<typeof setTimeout> | null = null
  private _retryTimer: ReturnType<typeof setTimeout> | null = null
  private _flushDelay: number
  private _flushing = false
  private _retryQueue = new Map<string, { op: SyncOperation; attempt: number }>()
  private _maxRetries = 5
  private _attemptMap = new Map<string, number>()
  // Durable mirror of pending operations keyed identically to _queue. Only
  // operations enqueued WITH a descriptor are journaled; descriptor-less
  // callers (e.g. fire-and-forget telemetry) keep the legacy in-memory-only
  // behavior. The journal becomes "active" the first time a descriptor is
  // seen, so descriptor-less queues never touch IndexedDB.
  private _journal = new Map<string, JournalEntry>()
  private _journalActive = false
  // Promise of the currently-executing flush (null when idle). stop() awaits it
  // so callers can guarantee no write is still in flight (LIFT-782).
  private _currentFlush: Promise<void> | null = null
  // When true, the flush/retry schedulers are inhibited so NO new timer can be
  // armed — even by an in-flight flush settling after stop(). This guarantees
  // that once stop() returns there are zero live timers that could fire an
  // upsert mid-deletion and resurrect a row. Reset on the next enqueue so
  // normal sync resumes (e.g. after a failed deletion) (LIFT-782).
  private _stopped = false

  constructor(flushDelay = 1000) {
    this._flushDelay = flushDelay
  }

  /** Persist the journal to IndexedDB (fire-and-forget). No-op until active. */
  private _persistJournal(): void {
    if (!this._journalActive) return
    try {
      const serialized = JSON.stringify(
        [...this._journal.entries()].map(([key, entry]) => ({ key, ...entry })),
      )
      backupToIDB(JOURNAL_KEY, serialized)
    } catch {
      // Serialization/IDB failure must never break the in-memory queue.
    }
  }

  /** Record (or replace) a journal entry and persist. */
  private _journalSet(key: string, descriptor: SyncDescriptor, isDelete: boolean): void {
    this._journalActive = true
    this._journal.set(key, { descriptor, isDelete })
    this._persistJournal()
  }

  /**
   * Add an operation to the queue. If `key` matches an existing entry,
   * the previous operation is replaced (last-write-wins).
   *
   * Pass a `descriptor` to make the write durable across reloads: it is
   * journaled to IndexedDB immediately and removed once the op flushes
   * successfully (or is dropped after exhausting retries). Omit it for
   * in-memory-only writes (the legacy behavior).
   */
  enqueue(key: string, op: SyncOperation, descriptor?: SyncDescriptor): void {
    if (!supabase || isPreviewMode.value) return
    // A new write means normal operation has resumed after a stop() — lift the
    // inhibit so the flush scheduled below (and any retries stranded by the
    // stop) can run again (LIFT-782).
    const wasStopped = this._stopped
    this._stopped = false
    // Journal first — before rate-limit deferral — so the durable record
    // exists the instant the user acts, even if execution is deferred.
    if (descriptor) this._journalSet(key, descriptor, false)
    // Rate limiting
    _rateCount++
    if (!_rateResetTimer) {
      _rateResetTimer = setTimeout(() => {
        _rateCount = 0
        _rateResetTimer = null
        // Re-enqueue deferred operations through the rate-limited path.
        // Take a snapshot and clear first to avoid infinite deferral loops.
        if (_deferredOps.size > 0) {
          const batch = new Map(_deferredOps)
          _deferredOps.clear()
          for (const [k, v] of batch) {
            this.enqueue(k, v)
          }
        }
      }, RATE_LIMIT_WINDOW)
    }
    if (_rateCount > RATE_LIMIT_MAX) {
      logWarn('Sync rate limit exceeded, deferring operation', { key })
      _deferredOps.set(key, op)
      return
    }
    this._queue.set(key, op)
    this._retryQueue.delete(key)
    this._scheduleFlush()
    // If a prior stop() left failed ops stranded in the retry queue without a
    // timer (the scheduler was inhibited), re-arm their retry now that we've
    // resumed so they drain instead of waiting for an app restart (LIFT-782).
    if (wasStopped && this._retryQueue.size > 0) this._scheduleRetry()
  }

  /**
   * Enqueue a server-side DELETE operation. Identical to `enqueue` except
   * the call is counted against the delete circuit breaker — if more than
   * CIRCUIT_BREAKER_THRESHOLD deletes are enqueued within
   * CIRCUIT_BREAKER_WINDOW_MS, the breaker opens: subsequent deletes are
   * blocked for CIRCUIT_BREAKER_COOLDOWN_MS and a Sentry error is raised.
   *
   * All delete call sites in the app should go through this method, NOT
   * plain `enqueue`, so they are visible to the breaker. See the
   * structural test in syncQueue.test.ts that enforces this.
   */
  enqueueDelete(key: string, op: SyncOperation, descriptor?: SyncDescriptor): void {
    if (!supabase || isPreviewMode.value) return

    // Re-enqueuing a delete for a key that's already pending is the SAME logical
    // delete being refreshed (e.g. rehydrate() replays a journaled delete and
    // then _fetchFromSupabase's tombstone pass re-enqueues it before the queue
    // flushes). Those must NOT each push a fresh timestamp into the breaker, or
    // a handful of pending offline deletes would falsely trip the SEV1 guard.
    // The breaker only needs to see genuinely NEW (distinct-key) deletes — a
    // real delete storm still has distinct keys and still trips.
    const alreadyPending = this._queue.has(key) || this._retryQueue.has(key)

    if (CIRCUIT_BREAKER_ENABLED && !alreadyPending) {
      const now = Date.now()

      // Circuit is currently open (in cool-down): block the delete.
      if (now < _circuitOpenUntil) {
        logWarn('Sync delete circuit breaker open — blocking delete', {
          key,
          ms_until_reset: _circuitOpenUntil - now,
          trip_count: _circuitTripCount,
        })
        syncStatus.value = 'error'
        broadcastSyncStatus('error')
        return
      }

      // Prune timestamps outside the rolling window before counting.
      _deleteTimestamps = _deleteTimestamps.filter(
        t => now - t < CIRCUIT_BREAKER_WINDOW_MS,
      )

      // Trip the breaker if we're about to cross the threshold.
      if (_deleteTimestamps.length >= CIRCUIT_BREAKER_THRESHOLD) {
        _circuitOpenUntil = now + CIRCUIT_BREAKER_COOLDOWN_MS
        _circuitTripCount++
        logError(
          new Error(
            `Sync delete circuit breaker tripped: ${_deleteTimestamps.length} deletes in ${CIRCUIT_BREAKER_WINDOW_MS}ms (threshold ${CIRCUIT_BREAKER_THRESHOLD})`,
          ),
          {
            source: 'SyncQueue.enqueueDelete',
            count: _deleteTimestamps.length,
            window_ms: CIRCUIT_BREAKER_WINDOW_MS,
            threshold: CIRCUIT_BREAKER_THRESHOLD,
            cooldown_ms: CIRCUIT_BREAKER_COOLDOWN_MS,
            blocked_key: key,
            trip_count: _circuitTripCount,
          },
        )
        syncStatus.value = 'error'
        broadcastSyncStatus('error')
        return
      }

      _deleteTimestamps.push(now)
    }

    // Journal the delete (isDelete:true) only after the breaker has cleared it,
    // so a blocked delete is never replayed. enqueue() is then called WITHOUT a
    // descriptor so it won't overwrite this entry as a non-delete.
    if (descriptor) this._journalSet(key, descriptor, true)
    this.enqueue(key, op)
  }

  /** Immediately flush all pending operations. */
  async flush(): Promise<void> {
    if (this._timer) {
      clearTimeout(this._timer)
      this._timer = null
    }
    if (this._flushing || this._queue.size === 0) return

    this._flushing = true
    const work = this._runFlush()
    this._currentFlush = work
    try {
      await work
    } finally {
      this._currentFlush = null
      this._flushing = false
      if (this._queue.size > 0) this._scheduleFlush()
    }
  }

  /** Execute one batch of the current queue. Extracted so flush() can track
   *  the in-flight promise (this._currentFlush) for stop() to await. */
  private async _runFlush(): Promise<void> {
    syncStatus.value = 'syncing'
    broadcastSyncStatus('syncing')
    const entries = [...this._queue.entries()]
    this._queue.clear()

    const results = await Promise.allSettled(
      entries.map(([, op]) => op()),
    )

    let hasFailure = false
    let journalChanged = false
    results.forEach((result, i) => {
      const key = entries[i][0]
      if (result.status === 'fulfilled') {
        // Clear retry counter on success so future failures get full retries
        this._attemptMap.delete(key)
        // Write durably landed on the server — drop its journal entry.
        if (this._journal.delete(key)) journalChanged = true
      } else if (result.status === 'rejected') {
        hasFailure = true
        const op = entries[i][1]
        const prevAttempt = this._attemptMap.get(key) ?? 0
        const attempt = prevAttempt + 1
        if (attempt <= this._maxRetries) {
          this._retryQueue.set(key, { op, attempt })
          this._attemptMap.set(key, attempt)
          logWarn(`Sync failed, will retry (attempt ${attempt}/${this._maxRetries})`, { key })
        } else {
          logError(result.reason, { source: 'SyncQueue', key, attempts: attempt })
          // Retries exhausted — the op is dropped, so drop its journal entry
          // too. (Reconciliation in the store's _fetchFromSupabase is the
          // last line of defense for recovering such writes.)
          if (this._journal.delete(key)) journalChanged = true
        }
      }
    })
    if (journalChanged) this._persistJournal()
    if (this._retryQueue.size > 0) this._scheduleRetry()
    const newStatus = hasFailure ? 'error' : 'synced' as const
    syncStatus.value = newStatus
    broadcastSyncStatus(newStatus)
  }

  /** Number of pending (unflushed) operations. */
  get pending(): number {
    return this._queue.size + this._retryQueue.size + _deferredOps.size
  }

  /**
   * Quiesce the queue WITHOUT discarding queued work or the durable journal.
   *
   * Cancels the pending debounce/retry timers and AWAITS any flush already on
   * the network so the caller can guarantee no write is still in flight when it
   * returns. Every pending operation and its journal entry is preserved, so
   * flushing resumes on the next enqueue (or, on the failure path, on the retry
   * timer the awaited flush may have scheduled). Account deletion uses this to
   * stop an in-flight write from resurrecting a row mid-delete while still
   * preserving unsynced work if the deletion fails and the user retries.
   *
   * Note: the awaited flush settles fully BEFORE the caller proceeds, and the
   * _stopped flag inhibits the schedulers so that flush can't arm a new timer
   * as it settles. Once stop() returns there are zero live timers, so nothing
   * fires an upsert during the caller's subsequent deletes (LIFT-782).
   */
  async stop(): Promise<void> {
    // Set BEFORE awaiting the flush: the awaited flush's _scheduleRetry /
    // _scheduleFlush calls then become no-ops, leaving no live timer behind.
    this._stopped = true
    if (this._timer) {
      clearTimeout(this._timer)
      this._timer = null
    }
    if (this._retryTimer) {
      clearTimeout(this._retryTimer)
      this._retryTimer = null
    }
    await this._currentFlush
  }

  /** Cancel all pending operations without executing them. */
  clear(): void {
    if (this._timer) {
      clearTimeout(this._timer)
      this._timer = null
    }
    if (this._retryTimer) {
      clearTimeout(this._retryTimer)
      this._retryTimer = null
    }
    this._queue.clear()
    this._retryQueue.clear()
    this._attemptMap.clear()
    _deferredOps.clear()
    const hadJournal = this._journal.size > 0
    this._journal.clear()
    if (hadJournal) this._persistJournal()
  }

  /**
   * Replay journaled operations after an app reload (LIFT-706).
   *
   * Reads the durable journal from IndexedDB and re-enqueues each entry by
   * rebuilding its op from the serializable descriptor. Deletes are routed back
   * through enqueueDelete so the circuit breaker still sees them. Safe to call
   * once on startup; a no-op when Supabase is unavailable or the journal is
   * empty. Replay is idempotent (upsert/update only), so re-running a write the
   * server already has does no harm.
   */
  async rehydrate(): Promise<void> {
    if (!supabase || isPreviewMode.value) return
    let raw: string | null
    try {
      raw = await restoreFromIDB(JOURNAL_KEY)
    } catch {
      return
    }
    if (!raw) return
    let entries: Array<{ key: string; descriptor: SyncDescriptor; isDelete: boolean }>
    try {
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return
      entries = parsed
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry || typeof entry.key !== 'string' || !entry.descriptor) continue
      const { key, descriptor, isDelete } = entry
      // Don't clobber a newer in-session write: if the user acted on this key
      // while the (async) journal read was in flight, the live queue/retry entry
      // is fresher than the persisted snapshot and must win.
      if (this._queue.has(key) || this._retryQueue.has(key)) continue
      if (isDelete) {
        this.enqueueDelete(key, () => executeDescriptor(descriptor), descriptor)
      } else {
        this.enqueue(key, () => executeDescriptor(descriptor), descriptor)
      }
    }
  }

  /** Number of journaled (durable) pending operations. For tests/telemetry. */
  get journalSize(): number {
    return this._journal.size
  }

  private _scheduleFlush(): void {
    // Inhibited while stopped so a flush settling during teardown can't re-arm
    // a timer that would fire an upsert mid-deletion (LIFT-782).
    if (this._stopped) return
    if (this._timer) clearTimeout(this._timer)
    this._timer = setTimeout(() => this.flush(), this._flushDelay)
  }

  private _scheduleRetry(): void {
    if (this._stopped) return // inhibited while stopped (see _scheduleFlush)
    if (this._retryTimer) return // already scheduled
    // Exponential backoff based on highest attempt count
    const maxAttempt = Math.max(...[...this._retryQueue.values()].map(r => r.attempt))
    const delay = Math.min(1000 * Math.pow(2, maxAttempt - 1), 60000)
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null
      // Move retry items back to main queue with attempt metadata
      const retries = new Map(this._retryQueue)
      this._retryQueue.clear()
      for (const [key, { op }] of retries) {
        if (!this._queue.has(key)) {
          this._queue.set(key, op)
        }
      }
      this.flush()
    }, delay)
  }
}

/** Reset rate limit state (for testing only). */
export function _resetRateLimit(): void {
  _rateCount = 0
  if (_rateResetTimer) {
    clearTimeout(_rateResetTimer)
    _rateResetTimer = null
  }
  _deferredOps.clear()
}

/** Reset circuit breaker state (for testing only). */
export function _resetCircuitBreaker(): void {
  _deleteTimestamps = []
  _circuitOpenUntil = 0
  _circuitTripCount = 0
}

/** Inspect circuit breaker state (for testing / telemetry only). */
export function _getCircuitBreakerState(): {
  deleteCount: number
  openUntil: number
  tripCount: number
} {
  return {
    deleteCount: _deleteTimestamps.length,
    openUntil: _circuitOpenUntil,
    tripCount: _circuitTripCount,
  }
}

/** Shared sync queue instance used by all stores (1-second debounce). */
export const syncQueue = new SyncQueue(1000)
