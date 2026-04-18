import { ref } from 'vue'
import { supabase, isPreviewMode } from './supabase'
import { logError, logWarn } from './logger'

type SyncOperation = () => PromiseLike<unknown>

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

  constructor(flushDelay = 1000) {
    this._flushDelay = flushDelay
  }

  /**
   * Add an operation to the queue. If `key` matches an existing entry,
   * the previous operation is replaced (last-write-wins).
   */
  enqueue(key: string, op: SyncOperation): void {
    if (!supabase || isPreviewMode.value) return
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
  enqueueDelete(key: string, op: SyncOperation): void {
    if (!supabase || isPreviewMode.value) return

    if (CIRCUIT_BREAKER_ENABLED) {
      const now = Date.now()

      // Circuit is currently open (in cool-down): block the delete.
      if (now < _circuitOpenUntil) {
        logWarn('Sync delete circuit breaker open — blocking delete', {
          key,
          ms_until_reset: _circuitOpenUntil - now,
          trip_count: _circuitTripCount,
        })
        syncStatus.value = 'error'
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
        return
      }

      _deleteTimestamps.push(now)
    }

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
    const entries = [...this._queue.entries()]
    this._queue.clear()

    try {
      const results = await Promise.allSettled(
        entries.map(([, op]) => op()),
      )
      let hasFailure = false
      results.forEach((result, i) => {
        if (result.status === 'fulfilled') {
          // Clear retry counter on success so future failures get full retries
          this._attemptMap.delete(entries[i][0])
        } else if (result.status === 'rejected') {
          hasFailure = true
          const [key, op] = entries[i]
          const prevAttempt = this._attemptMap.get(key) ?? 0
          const attempt = prevAttempt + 1
          if (attempt <= this._maxRetries) {
            this._retryQueue.set(key, { op, attempt })
            this._attemptMap.set(key, attempt)
            logWarn(`Sync failed, will retry (attempt ${attempt}/${this._maxRetries})`, { key })
          } else {
            logError(result.reason, { source: 'SyncQueue', key, attempts: attempt })
          }
        }
      })
      if (this._retryQueue.size > 0) this._scheduleRetry()
      syncStatus.value = hasFailure ? 'error' : 'synced'
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
