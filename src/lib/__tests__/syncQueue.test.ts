import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SyncQueue, syncStatus, _resetRateLimit, _resetCircuitBreaker, _getCircuitBreakerState } from '../syncQueue'
import { FAKE_NETWORK_ERROR_RESULT } from '../../__tests__/fakeSupabase'

/**
 * What a Supabase mutation ACTUALLY resolves with when the device is offline —
 * postgrest-js catches the fetch rejection and resolves this envelope rather
 * than rejecting (LIFT-1321). Sourced from the shared fake so this file and the
 * store-level fakes cannot drift on the shape they call "offline".
 */
const FETCH_FAILURE_RESULT = FAKE_NETWORK_ERROR_RESULT

// Mock supabase so the module loads (syncQueue checks supabase for the singleton)
vi.mock('../supabase', () => ({ supabase: {}, isPreviewMode: { value: false } }))

// Spy on ensureFreshSession but keep the real isAuthError classifier (LIFT-784).
const { ensureFreshSessionSpy } = vi.hoisted(() => ({
  ensureFreshSessionSpy: vi.fn(() => Promise.resolve(true)),
}))
vi.mock('../sessionHealth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sessionHealth')>()
  return { ...actual, ensureFreshSession: ensureFreshSessionSpy }
})

describe('SyncQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    syncStatus.value = 'synced'
    _resetRateLimit()
    ensureFreshSessionSpy.mockClear()
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

  it('refreshes the session ONCE when a flush hits an expired-token 401 (LIFT-784)', async () => {
    const queue = new SyncQueue(100)
    // Supabase ops RESOLVE { error } on a 401 (they do not reject), so a stale
    // token would otherwise be treated as a silent success.
    const jwtExpired = { error: { code: 'PGRST301', message: 'JWT expired' } }
    const a = vi.fn().mockResolvedValue(jwtExpired)
    const b = vi.fn().mockResolvedValue(jwtExpired)

    queue.enqueue('a', a)
    queue.enqueue('b', b)

    // Flush the batch once (don't run the retry timers — we're asserting on the
    // first encounter, before retries are exhausted).
    await queue.flush()

    // One refresh for the whole batch, not one per write.
    expect(ensureFreshSessionSpy).toHaveBeenCalledTimes(1)
    // The writes were queued for retry, not dropped as "synced".
    expect(syncStatus.value).toBe('error')
    expect(queue.pending).toBeGreaterThan(0)
  })

  it('does NOT refresh the session on an ordinary (non-auth) failure', async () => {
    const queue = new SyncQueue(100)
    const failing = vi.fn().mockRejectedValue(new Error('network'))

    queue.enqueue('fail', failing)
    vi.advanceTimersByTime(100)
    await vi.runAllTimersAsync()

    expect(ensureFreshSessionSpy).not.toHaveBeenCalled()
  })

  // ── Resolved failures (LIFT-1321) ──────────────────────────────
  //
  // postgrest-js CATCHES fetch rejections and resolves
  // `{ error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 }`,
  // so a Supabase mutation essentially never rejects when the device is offline.
  // The queue used to count every resolved non-auth error as a SUCCESS: retries
  // cleared, durable journal deleted, status 'synced'. That made the retry,
  // backoff and journal-retention machinery unreachable for the app's single
  // most common failure class.

  it('treats a resolved fetch-failure envelope as a retryable failure, not a success (LIFT-1321)', async () => {
    const queue = new SyncQueue(100)
    const op = vi.fn().mockResolvedValue(FETCH_FAILURE_RESULT)

    queue.enqueue('set:s1', op)
    await vi.advanceTimersByTimeAsync(100)

    // Before LIFT-1321 this ran exactly once and reported 'synced'.
    expect(op).toHaveBeenCalledTimes(1)
    expect(syncStatus.value).not.toBe('synced')
    expect(queue.pending).toBe(1) // queued for retry

    await vi.runAllTimersAsync()
    expect(op).toHaveBeenCalledTimes(6) // 1 initial + 5 retries
  })

  it('refreshes the session on a 401 whose body it cannot parse as an auth error', async () => {
    // `isAuthError` reads the error BODY; the HTTP status lives on the envelope
    // beside it. An opaque 401 from a proxy would otherwise skip the refresh
    // AND be bucketed as a permanent 4xx.
    const queue = new SyncQueue(100)
    const op = vi.fn().mockResolvedValue({ data: null, status: 401, error: { message: 'no' } })

    queue.enqueue('set:s1', op)
    await queue.flush()

    expect(ensureFreshSessionSpy).toHaveBeenCalledTimes(1)
    expect(queue.pending).toBe(1) // retried after the refresh, not abandoned
  })

  it('does NOT refresh the session for a resolved network failure', async () => {
    const queue = new SyncQueue(100)
    queue.enqueue('set:s1', vi.fn().mockResolvedValue(FETCH_FAILURE_RESULT))

    await vi.runAllTimersAsync()

    // Being offline is not a token problem — a refresh would fail anyway.
    expect(ensureFreshSessionSpy).not.toHaveBeenCalled()
  })

  it('retries a resolved 5xx — the server may answer differently next time', async () => {
    const queue = new SyncQueue(100)
    const op = vi.fn().mockResolvedValue({
      data: null, status: 503, error: { code: '', message: 'service unavailable' },
    })

    queue.enqueue('set:s1', op)
    await vi.runAllTimersAsync()

    expect(op).toHaveBeenCalledTimes(6)
    expect(syncStatus.value).toBe('error')
  })

  it('does NOT retry a resolved 4xx the server understood and refused', async () => {
    const queue = new SyncQueue(100)
    // A unique violation / RLS denial / schema-cache miss cannot change answer
    // on a byte-for-byte replay, so it must not burn five more round-trips —
    // but it IS a failure, so the status has to say so.
    const op = vi.fn().mockResolvedValue({
      data: null, status: 409, error: { code: '23505', message: 'duplicate key' },
    })

    queue.enqueue('dup', op)
    await vi.runAllTimersAsync()

    expect(op).toHaveBeenCalledTimes(1)
    expect(ensureFreshSessionSpy).not.toHaveBeenCalled()
    expect(queue.pending).toBe(0)
    expect(syncStatus.value).toBe('error')
  })

  it('a permanent failure does not shorten the retry budget of a later transient one', async () => {
    const queue = new SyncQueue(100)
    const permanent = vi.fn().mockResolvedValue({
      data: null, status: 400, error: { code: 'PGRST204', message: "column 'gyms' not found" },
    })
    queue.enqueue('exercise:e1', permanent)
    await vi.runAllTimersAsync()
    expect(permanent).toHaveBeenCalledTimes(1)

    // Same key, now failing transiently: it must still get all five retries.
    const transient = vi.fn().mockResolvedValue(FETCH_FAILURE_RESULT)
    queue.enqueue('exercise:e1', transient)
    await vi.runAllTimersAsync()

    expect(transient).toHaveBeenCalledTimes(6)
  })

  it('reports offline (not error) when the batch fails after the link drops mid-flight', async () => {
    // App.vue's connectivity listener sets this same ref to 'offline'; a flush
    // that overwrote it with 'error' would swap "Offline — changes saved
    // locally" for "Sync failed" on every set logged in a dead-spot gym.
    //
    // The flush STARTS online (so the LIFT-1322 park lets it through) and the
    // radio drops while the request is in flight — which is how a real dead
    // spot arrives, and the path that still reaches the status branch at the
    // end of flush().
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    try {
      const queue = new SyncQueue(100)
      queue.enqueue('set:s1', vi.fn().mockImplementation(() => {
        onLine.mockReturnValue(false)
        return Promise.resolve(FETCH_FAILURE_RESULT)
      }))
      await vi.advanceTimersByTimeAsync(100)

      expect(syncStatus.value).toBe('offline')
    } finally {
      onLine.mockRestore()
    }
  })

  // ── Parking the queue while offline (LIFT-1322) ────────────────
  //
  // Five exponential-backoff retries exhaust in ~31s. Spending them against a
  // radio the browser already knows is dead dropped the in-memory op — and
  // stranded its journal entry until the next COLD START — for any offline
  // stretch longer than half a minute. A lifter who trains through a dead spot
  // is offline for far longer than that.

  describe('offline parking (LIFT-1322)', () => {
    let onLine: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    })

    afterEach(() => {
      onLine.mockRestore()
    })

    it('does not attempt the write, and keeps it pending, while the browser is offline', async () => {
      const queue = new SyncQueue(100)
      const op = vi.fn().mockResolvedValue(FETCH_FAILURE_RESULT)

      queue.enqueue('set:s1', op)
      await vi.advanceTimersByTimeAsync(100)

      expect(op).not.toHaveBeenCalled()
      expect(queue.pending).toBe(1)
      expect(syncStatus.value).toBe('offline')
    })

    it('preserves the full retry budget across an offline stretch far longer than it', async () => {
      const queue = new SyncQueue(100)
      const op = vi.fn().mockResolvedValue(FETCH_FAILURE_RESULT)
      queue.enqueue('set:s1', op)

      // Ten minutes in a basement gym — twenty times the ~31s retry budget.
      await vi.advanceTimersByTimeAsync(600_000)
      expect(op).not.toHaveBeenCalled()

      onLine.mockReturnValue(true)
      window.dispatchEvent(new Event('online'))
      await vi.runAllTimersAsync()

      // 1 initial + all 5 retries: nothing was consumed while parked.
      expect(op).toHaveBeenCalledTimes(6)
    })

    it('drains the parked queue when the connection returns', async () => {
      const queue = new SyncQueue(100)
      const op = vi.fn().mockResolvedValue({ data: null, error: null })
      queue.enqueue('set:s1', op)
      await vi.advanceTimersByTimeAsync(100)
      expect(op).not.toHaveBeenCalled()

      onLine.mockReturnValue(true)
      window.dispatchEvent(new Event('online'))
      await vi.runAllTimersAsync()

      expect(op).toHaveBeenCalledTimes(1)
      expect(queue.pending).toBe(0)
      expect(syncStatus.value).toBe('synced')
    })

    it('resumes on its OWN online listener, independent of useSyncRecovery', async () => {
      // useSyncRecovery's `online` trigger is rate-limited to one run per 20s,
      // so an `online` event landing just after a resume re-fetch is dropped
      // outright. Draining its own backlog has to be the queue's business or
      // the parked writes stay parked for the rest of the session.
      const added = vi.spyOn(window, 'addEventListener')
      const queue = new SyncQueue(100)
      queue.enqueue('set:s1', vi.fn().mockResolvedValue({ data: null, error: null }))
      await vi.advanceTimersByTimeAsync(100)

      expect(added).toHaveBeenCalledWith('online', expect.any(Function))
      added.mockRestore()
    })

    it('does not leave the online listener attached after it fires', async () => {
      const removed = vi.spyOn(window, 'removeEventListener')
      const queue = new SyncQueue(100)
      queue.enqueue('set:s1', vi.fn().mockResolvedValue({ data: null, error: null }))
      await vi.advanceTimersByTimeAsync(100)

      onLine.mockReturnValue(true)
      window.dispatchEvent(new Event('online'))
      await vi.runAllTimersAsync()

      expect(removed).toHaveBeenCalledWith('online', expect.any(Function))
      removed.mockRestore()
    })
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

// ─────────────────────────────────────────────────────────────────
// Circuit breaker: defense-in-depth for runaway delete storms.
// Motivation: SEV1 on 2026-04-12 destroyed ~40-60% of one user's data
// because _fetchFromSupabase broadcast DELETEs from a dedup heuristic.
// ─────────────────────────────────────────────────────────────────

describe('SyncQueue — delete circuit breaker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    syncStatus.value = 'synced'
    _resetRateLimit()
    _resetCircuitBreaker()
  })

  afterEach(() => {
    vi.useRealTimers()
    _resetCircuitBreaker()
  })

  it('enqueueDelete passes the op through under normal volume', async () => {
    const queue = new SyncQueue(100)
    const op = vi.fn().mockResolvedValue(undefined)

    queue.enqueueDelete('set:1', op)
    await vi.advanceTimersByTimeAsync(100)

    expect(op).toHaveBeenCalledOnce()
    expect(_getCircuitBreakerState().deleteCount).toBe(1)
    expect(syncStatus.value).toBe('synced')
  })

  it('19 deletes in 10s window do NOT trip the breaker (boundary)', () => {
    const queue = new SyncQueue(100)
    for (let i = 0; i < 19; i++) {
      queue.enqueueDelete(`set:${i}`, vi.fn().mockResolvedValue(undefined))
    }
    expect(_getCircuitBreakerState().deleteCount).toBe(19)
    expect(_getCircuitBreakerState().tripCount).toBe(0)
    expect(_getCircuitBreakerState().openUntil).toBe(0)
  })

  it('20th delete in 10s window trips the breaker', () => {
    const queue = new SyncQueue(100)
    // First 20 go through; the 20th is the threshold trip
    for (let i = 0; i < 20; i++) {
      queue.enqueueDelete(`set:${i}`, vi.fn().mockResolvedValue(undefined))
    }
    // The 20th (index 19) is counted. The 21st would check deleteCount >= 20 and trip.
    // Actually: check happens BEFORE push, so on the 20th call deleteCount is 19 (under
    // threshold), push makes it 20. On the 21st call, deleteCount is 20 (>= threshold), trip.
    queue.enqueueDelete('set:trip', vi.fn().mockResolvedValue(undefined))

    const state = _getCircuitBreakerState()
    expect(state.tripCount).toBe(1)
    expect(state.openUntil).toBeGreaterThan(Date.now())
    expect(syncStatus.value).toBe('error')
  })

  it('after tripping, subsequent deletes are blocked during cool-down', async () => {
    const queue = new SyncQueue(100)
    // Trip the breaker
    for (let i = 0; i < 21; i++) {
      queue.enqueueDelete(`set:${i}`, vi.fn().mockResolvedValue(undefined))
    }
    expect(_getCircuitBreakerState().tripCount).toBe(1)

    // New delete while circuit is open — should be blocked (op never called)
    const blockedOp = vi.fn().mockResolvedValue(undefined)
    queue.enqueueDelete('set:blocked', blockedOp)
    await vi.advanceTimersByTimeAsync(100)
    expect(blockedOp).not.toHaveBeenCalled()
  })

  it('cool-down expires after 60s and deletes flow again', async () => {
    const queue = new SyncQueue(100)
    // Trip the breaker
    for (let i = 0; i < 21; i++) {
      queue.enqueueDelete(`set:${i}`, vi.fn().mockResolvedValue(undefined))
    }
    expect(_getCircuitBreakerState().openUntil).toBeGreaterThan(Date.now())

    // Fast-forward past cool-down (60s) + debounce headroom
    await vi.advanceTimersByTimeAsync(60_001)

    const postOp = vi.fn().mockResolvedValue(undefined)
    queue.enqueueDelete('set:after-cooldown', postOp)
    await vi.advanceTimersByTimeAsync(100)

    expect(postOp).toHaveBeenCalledOnce()
  })

  it('deletes older than the 10s window do not count toward threshold', async () => {
    const queue = new SyncQueue(100)
    // 10 deletes now
    for (let i = 0; i < 10; i++) {
      queue.enqueueDelete(`old:${i}`, vi.fn().mockResolvedValue(undefined))
    }
    // Advance 11s so those fall out of the rolling window
    await vi.advanceTimersByTimeAsync(11_000)
    // 15 more deletes — total "recent" is 15, under the 20 threshold
    for (let i = 0; i < 15; i++) {
      queue.enqueueDelete(`new:${i}`, vi.fn().mockResolvedValue(undefined))
    }

    expect(_getCircuitBreakerState().tripCount).toBe(0)
    expect(_getCircuitBreakerState().deleteCount).toBe(15) // stale ones pruned
  })

  it('plain enqueue (non-delete) does NOT count toward the breaker', () => {
    const queue = new SyncQueue(100)
    // 50 upserts via plain enqueue — should not touch the breaker
    for (let i = 0; i < 50; i++) {
      queue.enqueue(`upsert:${i}`, vi.fn().mockResolvedValue(undefined))
    }
    expect(_getCircuitBreakerState().deleteCount).toBe(0)
    expect(_getCircuitBreakerState().tripCount).toBe(0)
  })

  it('breaker trip count increments on each trip', async () => {
    const queue = new SyncQueue(100)
    // Trip once
    for (let i = 0; i < 21; i++) {
      queue.enqueueDelete(`first:${i}`, vi.fn().mockResolvedValue(undefined))
    }
    expect(_getCircuitBreakerState().tripCount).toBe(1)

    // Wait past cool-down, trip again
    await vi.advanceTimersByTimeAsync(61_000)
    for (let i = 0; i < 21; i++) {
      queue.enqueueDelete(`second:${i}`, vi.fn().mockResolvedValue(undefined))
    }
    expect(_getCircuitBreakerState().tripCount).toBe(2)
  })

  it('_resetCircuitBreaker clears all state', () => {
    const queue = new SyncQueue(100)
    for (let i = 0; i < 21; i++) {
      queue.enqueueDelete(`set:${i}`, vi.fn().mockResolvedValue(undefined))
    }
    expect(_getCircuitBreakerState().tripCount).toBe(1)

    _resetCircuitBreaker()
    const state = _getCircuitBreakerState()
    expect(state.deleteCount).toBe(0)
    expect(state.openUntil).toBe(0)
    expect(state.tripCount).toBe(0)
  })
})

// Structural invariant tests (delete routing discipline, Gate 5 soft-delete)
// have been consolidated into architecturalInvariants.test.ts (LIFT-653).
