import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SyncQueue } from '../syncQueue'

// Mock supabase so the module loads (syncQueue checks supabase for the singleton)
vi.mock('../supabase', () => ({ supabase: {} }))

describe('SyncQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
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
})
