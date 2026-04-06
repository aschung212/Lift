import { ref } from 'vue'
import { supabase, isPreviewMode } from './supabase'
import { logError, logWarn } from './logger'

type SyncOperation = () => PromiseLike<unknown>

/** Reactive sync status for UI indicators. */
export const syncStatus = ref<'synced' | 'syncing' | 'error' | 'offline'>('synced')

// Rate limiting: max operations per window
const RATE_LIMIT_MAX = 50
const RATE_LIMIT_WINDOW = 60_000 // 1 minute
let _rateCount = 0
let _rateResetTimer: ReturnType<typeof setTimeout> | null = null

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
      _rateResetTimer = setTimeout(() => { _rateCount = 0; _rateResetTimer = null }, RATE_LIMIT_WINDOW)
    }
    if (_rateCount > RATE_LIMIT_MAX) {
      logWarn('Sync rate limit exceeded, dropping operation', { key })
      return
    }
    this._queue.set(key, op)
    this._retryQueue.delete(key)
    this._scheduleFlush()
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
        if (result.status === 'rejected') {
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
    return this._queue.size + this._retryQueue.size
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
}

/** Shared sync queue instance used by all stores (1-second debounce). */
export const syncQueue = new SyncQueue(1000)
