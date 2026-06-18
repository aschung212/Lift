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
 * Allowlist of tables (and their writable columns) that a journaled descriptor
 * is permitted to target on replay (LIFT-785).
 *
 * The journal lives in IndexedDB, which is user-writable. `rehydrate()` replays
 * whatever was persisted, and `executeDescriptor` casts the typed client to a
 * loose surface to target a dynamic table name — so without validation a
 * tampered (or corrupted) journal entry could issue an upsert/update against an
 * arbitrary table or column, with RLS as the only backstop. This allowlist is a
 * client-side defense-in-depth layer: only the tables the app actually journals
 * (`exercises`, `sets`) and only their real columns are replayable; anything
 * else is dropped before a query is ever built.
 *
 * Keep this in sync with the descriptors built in `src/stores/workout.ts`
 * (`_buildExerciseUpsert`, `_enqueueSetUpsert`, `_enqueueSoftDelete`,
 * `_enqueueRestore`) — those are the only descriptor producers in the app.
 */
const REPLAYABLE_COLUMNS: Record<string, ReadonlySet<string>> = {
  exercises: new Set([
    'id', 'user_id', 'name', 'tags', 'archived_at',
    'input_mode', 'bar_weight', 'intensity_max_reps', 'deleted_at',
  ]),
  sets: new Set([
    'id', 'user_id', 'exercise_id', 'date', 'weight', 'reps',
    'estimated_1rm', 'deleted_at',
  ]),
}

/** True when `obj` is a non-empty plain map whose keys are all in `allowed`. */
function isAllowedColumnMap(obj: unknown, allowed: ReadonlySet<string>): boolean {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false
  const keys = Object.keys(obj)
  // Empty maps are rejected: an empty upsert row is meaningless, and an empty
  // update `match` would target EVERY row in the table — exactly the kind of
  // unbounded write this allowlist exists to prevent.
  if (keys.length === 0) return false
  return keys.every(col => allowed.has(col))
}

/**
 * Validate that a descriptor is safe to replay (LIFT-785): a known op, an
 * allowlisted table, and only writable columns of that table in its row /
 * values / match. Used both as the gate in `rehydrate()` (drop + warn) and as
 * the final guard inside `executeDescriptor` (no-op) so a bad descriptor can
 * never reach Supabase regardless of how it was enqueued.
 */
export function isReplayableDescriptor(descriptor: unknown): descriptor is SyncDescriptor {
  if (!descriptor || typeof descriptor !== 'object') return false
  const d = descriptor as Record<string, unknown>
  if (typeof d.table !== 'string') return false
  const allowed = REPLAYABLE_COLUMNS[d.table]
  if (!allowed) return false
  if (d.op === 'upsert') return isAllowedColumnMap(d.row, allowed)
  if (d.op === 'update') {
    return isAllowedColumnMap(d.values, allowed) && isAllowedColumnMap(d.match, allowed)
  }
  return false
}

/**
 * Rebuild a runnable Supabase operation from its serializable descriptor.
 * Used to replay journaled writes after a reload. Returns a no-op promise when
 * Supabase is unavailable so replay degrades gracefully offline, or when the
 * descriptor falls outside the replay allowlist (LIFT-785).
 */
export function executeDescriptor(descriptor: SyncDescriptor): PromiseLike<unknown> {
  if (!supabase) return Promise.resolve()
  if (!isReplayableDescriptor(descriptor)) {
    logWarn('Refusing to execute sync descriptor outside the replay allowlist', {
      op: (descriptor as { op?: unknown } | null)?.op,
      table: (descriptor as { table?: unknown } | null)?.table,
    })
    return Promise.resolve()
  }
  // The table name is dynamic here (driven by the descriptor), so the strongly
  // typed supabase client surface doesn't apply — cast to a loose client. The
  // allowlist check above bounds `table` to the known set before we cast.
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
    syncStatus.value = 'syncing'
    broadcastSyncStatus('syncing')
    const entries = [...this._queue.entries()]
    this._queue.clear()

    try {
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
    } finally {
      this._flushing = false
      if (this._queue.size > 0) this._scheduleFlush()
    }
  }

  /** Number of pending (unflushed) operations. */
  get pending(): number {
    return this._queue.size + this._retryQueue.size + _deferredOps.size
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
      // Drop any journaled entry whose descriptor falls outside the replay
      // allowlist (LIFT-785) — the journal is user-writable IndexedDB, so a
      // tampered or corrupted entry must never be rebuilt into a query.
      if (!isReplayableDescriptor(entry.descriptor)) {
        logWarn('Dropping journaled descriptor outside the replay allowlist', {
          key: entry.key,
          op: (entry.descriptor as { op?: unknown }).op,
          table: (entry.descriptor as { table?: unknown }).table,
        })
        continue
      }
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
    if (this._timer) clearTimeout(this._timer)
    this._timer = setTimeout(() => this.flush(), this._flushDelay)
  }

  private _scheduleRetry(): void {
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
