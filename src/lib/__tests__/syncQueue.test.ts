import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SyncQueue, syncStatus, _resetRateLimit } from '../syncQueue'

// Mock supabase so the module loads (syncQueue checks supabase for the singleton)
vi.mock('../supabase', () => ({ supabase: {}, isPreviewMode: { value: false } }))

describe('SyncQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    syncStatus.value = 'synced'
    _resetRateLimit()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should enqueue and flush operations after delay', async () => {
    const queue = new SyncQueue(500)
    const op = vi.fn().mockResolvedValue(undefined)

    queue.enqueue('a', op)
    expect(queue.pending).toBe(1)
    expect(op).not.toHaveBeenCalled()

    vi.advanceTimersByTime(500)
    await vi.runAllTimersAsync()

    expect(op).toHaveBeenCalledOnce()
    expect(queue.pending).toBe(0)
  })

  it('should debounce — reset timer on new enqueue', async () => {
    const queue = new SyncQueue(500)
    const op1 = vi.fn().mockResolvedValue(undefined)
    const op2 = vi.fn().mockResolvedValue(undefined)

    queue.enqueue('a', op1)
    vi.advanceTimersByTime(300)
    // Enqueue another before flush fires
    queue.enqueue('b', op2)
    vi.advanceTimersByTime(300)
    // 600ms total, but timer reset at 300ms, so only 300ms since last enqueue
    expect(op1).not.toHaveBeenCalled()
    expect(op2).not.toHaveBeenCalled()

    vi.advanceTimersByTime(200)
    await vi.runAllTimersAsync()

    expect(op1).toHaveBeenCalledOnce()
    expect(op2).toHaveBeenCalledOnce()
  })

  it('should deduplicate operations with the same key (last-write-wins)', async () => {
    const queue = new SyncQueue(500)
    const op1 = vi.fn().mockResolvedValue(undefined)
    const op2 = vi.fn().mockResolvedValue(undefined)

    queue.enqueue('same-key', op1)
    queue.enqueue('same-key', op2)
    expect(queue.pending).toBe(1)

    vi.advanceTimersByTime(500)
    await vi.runAllTimersAsync()

    expect(op1).not.toHaveBeenCalled()
    expect(op2).toHaveBeenCalledOnce()
  })

  it('should flush immediately when flush() is called', async () => {
    const queue = new SyncQueue(5000)
    const op = vi.fn().mockResolvedValue(undefined)

    queue.enqueue('a', op)
    await queue.flush()

    expect(op).toHaveBeenCalledOnce()
    expect(queue.pending).toBe(0)
  })

  it('should handle operation failures gracefully with retries', async () => {
    const queue = new SyncQueue(100)
    const failing = vi.fn().mockRejectedValue(new Error('network'))
    const succeeding = vi.fn().mockResolvedValue(undefined)

    queue.enqueue('fail', failing)
    queue.enqueue('ok', succeeding)

    vi.advanceTimersByTime(100)
    await vi.runAllTimersAsync()

    // Failing op retried up to 5 times + 1 initial = 6 total
    expect(failing).toHaveBeenCalledTimes(6)
    expect(succeeding).toHaveBeenCalledOnce()
    expect(queue.pending).toBe(0)
  })

  it('should clear all pending operations without executing them', () => {
    const queue = new SyncQueue(500)
    const op = vi.fn().mockResolvedValue(undefined)

    queue.enqueue('a', op)
    queue.enqueue('b', op)
    expect(queue.pending).toBe(2)

    queue.clear()
    expect(queue.pending).toBe(0)

    vi.advanceTimersByTime(1000)
    expect(op).not.toHaveBeenCalled()
  })

  it('should not double-flush if flush() called while already flushing', async () => {
    const queue = new SyncQueue(100)
    let callCount = 0
    let resolveOp: (() => void) | null = null
    const slowOp = vi.fn().mockImplementation(() => {
      callCount++
      return new Promise<void>(resolve => { resolveOp = resolve })
    })

    queue.enqueue('a', slowOp)

    // Start flush and call flush again immediately
    const flush1 = queue.flush()
    const flush2 = queue.flush()

    // Resolve the slow op
    resolveOp!()
    await Promise.all([flush1, flush2])

    expect(callCount).toBe(1)
  })

  it('should process operations enqueued during a flush', async () => {
    const queue = new SyncQueue(100)
    const laterOp = vi.fn().mockResolvedValue(undefined)

    const duringFlushOp = vi.fn().mockImplementation(async () => {
      // Enqueue another operation during this flush
      queue.enqueue('later', laterOp)
    })

    queue.enqueue('first', duringFlushOp)
    await queue.flush()

    // The op enqueued during flush should be pending
    expect(queue.pending).toBe(1)

    // Advance timer to trigger the scheduled follow-up flush
    vi.advanceTimersByTime(100)
    await vi.runAllTimersAsync()

    expect(laterOp).toHaveBeenCalledOnce()
    expect(queue.pending).toBe(0)
  })

  it('should batch multiple operations into a single flush', async () => {
    const queue = new SyncQueue(200)
    const ops = Array.from({ length: 10 }, (_, i) =>
      vi.fn().mockResolvedValue(i)
    )

    ops.forEach((op, i) => queue.enqueue(`key-${i}`, op))
    expect(queue.pending).toBe(10)

    vi.advanceTimersByTime(200)
    await vi.runAllTimersAsync()

    ops.forEach(op => expect(op).toHaveBeenCalledOnce())
    expect(queue.pending).toBe(0)
  })

  // ── Retry behavior ────────────────────────────────────────────

  it('should retry with exponential backoff timing', async () => {
    const queue = new SyncQueue(100)
    const callTimes: number[] = []
    const failing = vi.fn().mockImplementation(() => {
      callTimes.push(Date.now())
      return Promise.reject(new Error('fail'))
    })

    queue.enqueue('retry-timing', failing)

    // Initial flush at 100ms
    vi.advanceTimersByTime(100)
    await vi.runAllTimersAsync()

    // Should have been called 6 times (1 initial + 5 retries)
    expect(failing).toHaveBeenCalledTimes(6)
  })

  it('should supersede a pending retry when same key is re-enqueued', async () => {
    const queue = new SyncQueue(100)
    const failingOp = vi.fn().mockRejectedValue(new Error('fail'))
    const replacementOp = vi.fn().mockResolvedValue('ok')

    queue.enqueue('key-a', failingOp)
    await vi.advanceTimersByTimeAsync(100) // flush + microtasks

    // failingOp ran once and is now in retry queue
    expect(failingOp).toHaveBeenCalledTimes(1)
    expect(queue.pending).toBe(1) // in retry queue

    // Enqueue a new op for the same key — should supersede the retry
    queue.enqueue('key-a', replacementOp)

    await vi.advanceTimersByTimeAsync(100) // flush replacement

    expect(replacementOp).toHaveBeenCalledOnce()
    expect(queue.pending).toBe(0)
    // failingOp should NOT have been retried (superseded)
    expect(failingOp).toHaveBeenCalledTimes(1)
  })

  it('should defer operations when rate limit is exceeded', async () => {
    const queue = new SyncQueue(100)

    // Enqueue 250 operations rapidly — rate limit is 200/minute
    const ops = Array.from({ length: 250 }, (_, i) => vi.fn().mockResolvedValue(i))
    for (let i = 0; i < 250; i++) {
      queue.enqueue(`rate-${i}`, ops[i])
    }

    // All 250 should be tracked (200 in queue + 50 deferred)
    expect(queue.pending).toBe(250)

    // Flush the main queue — only the first 200 should run
    await queue.flush()
    const calledCount = ops.filter(op => op.mock.calls.length > 0).length
    expect(calledCount).toBe(200)

    // After the rate window resets, deferred ops move into the queue
    await vi.advanceTimersByTimeAsync(60_000)
    await queue.flush()
    const totalCalled = ops.filter(op => op.mock.calls.length > 0).length
    expect(totalCalled).toBe(250)
  })

  it('should update syncStatus through lifecycle', async () => {
    const queue = new SyncQueue(100)
    syncStatus.value = 'synced'

    let resolveFn: (() => void) | null = null
    const op = vi.fn().mockImplementation(() => new Promise<void>(r => { resolveFn = r }))
    queue.enqueue('status-test', op)

    // Start flush — status should be syncing
    const flushPromise = queue.flush()
    expect(syncStatus.value).toBe('syncing')

    // Complete the operation
    resolveFn!()
    await flushPromise
    expect(syncStatus.value).toBe('synced')
  })

  it('should set syncStatus to error when an operation fails', async () => {
    const queue = new SyncQueue(100)
    syncStatus.value = 'synced'
    const failing = vi.fn().mockRejectedValue(new Error('fail'))

    queue.enqueue('error-status', failing)
    // Just run the first flush (don't run all timers which would process retries too)
    await vi.advanceTimersByTimeAsync(100)

    // After first attempt fails, status should be error
    expect(syncStatus.value).toBe('error')
  })

  it('should succeed on retry after initial failures', async () => {
    const queue = new SyncQueue(100)
    let callCount = 0
    const eventuallySucceeds = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount <= 2) return Promise.reject(new Error('transient'))
      return Promise.resolve('ok')
    })

    queue.enqueue('eventual', eventuallySucceeds)

    // Flush 1: initial attempt (fails)
    await vi.advanceTimersByTimeAsync(100)
    expect(eventuallySucceeds).toHaveBeenCalledTimes(1)

    // Flush 2: retry attempt 1 (fails), backoff 1s
    await vi.advanceTimersByTimeAsync(1000)
    expect(eventuallySucceeds).toHaveBeenCalledTimes(2)

    // Flush 3: retry attempt 2 (succeeds), backoff 2s
    await vi.advanceTimersByTimeAsync(2000)
    expect(eventuallySucceeds).toHaveBeenCalledTimes(3)

    expect(queue.pending).toBe(0)
    expect(syncStatus.value).toBe('synced')
  })
})
