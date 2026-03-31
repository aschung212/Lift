import { supabase } from './supabase'

type SyncOperation = () => PromiseLike<unknown>

/**
 * Batches and debounces Supabase sync operations.
 *
 * Enqueued operations are held for `flushDelay` ms. If more operations
 * arrive within that window the timer resets, coalescing rapid mutations
 * into a single flush. Operations sharing the same `key` are deduplicated
 * — only the latest version runs.
 */
export class SyncQueue {
  private _queue = new Map<string, SyncOperation>()
  private _timer: ReturnType<typeof setTimeout> | null = null
  private _flushDelay: number
  private _flushing = false

  constructor(flushDelay = 1000) {
    this._flushDelay = flushDelay
  }

  /**
   * Add an operation to the queue. If `key` matches an existing entry,
   * the previous operation is replaced (last-write-wins).
   */
  enqueue(key: string, op: SyncOperation): void {
    if (!supabase) return
    this._queue.set(key, op)
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
    const ops = [...this._queue.values()]
    this._queue.clear()

    try {
      await Promise.allSettled(ops.map(op => op()))
    } finally {
      this._flushing = false
      // If new ops were enqueued during flush, schedule another
      if (this._queue.size > 0) this._scheduleFlush()
    }
  }

  /** Number of pending (unflushed) operations. */
  get pending(): number {
    return this._queue.size
  }

  /** Cancel all pending operations without executing them. */
  clear(): void {
    if (this._timer) {
      clearTimeout(this._timer)
      this._timer = null
    }
    this._queue.clear()
  }

  private _scheduleFlush(): void {
    if (this._timer) clearTimeout(this._timer)
    this._timer = setTimeout(() => this.flush(), this._flushDelay)
  }
}

/** Shared sync queue instance used by all stores (1-second debounce). */
export const syncQueue = new SyncQueue(1000)
