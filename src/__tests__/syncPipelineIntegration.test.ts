/**
 * Sync Pipeline Integration Tests (LIFT-654 / LIFT-1010)
 *
 * Verifies the connected pipeline: logSet → store mutation → localStorage
 * persist → syncQueue enqueue → Supabase upsert payload shape. Also covers
 * deleteSet → tombstone → enqueueDelete → soft-delete payload.
 *
 * LIFT-1010: earlier this file replaced `lib/syncQueue` with a synchronous
 * invoke stub, so it verified the store→payload shape but bypassed the actual
 * debounce, rate limiter, and circuit breaker the architecture calls out as
 * core behavior — the exact places batching bugs and duplicate-write
 * regressions hide. Those mechanisms lived only in isolated unit tests
 * (syncQueue.test.ts), so nothing exercised store mutations flowing through the
 * REAL queue's timing and backpressure.
 *
 * This suite now drives the store through the real singleton `syncQueue`
 * (1s debounce) against an in-memory Supabase fake, advancing the debounce
 * window with fake timers (LIFT-895). The payload-shape assertions are kept;
 * the enqueue stub is gone. New blocks assert that rapid mutations are
 * debounced/batched into a single flush, same-key writes dedupe last-write-wins,
 * the rate limiter defers overflow into the next window, and the delete circuit
 * breaker trips against a delete storm.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from './helpers'

// ── Fake Supabase (chainable, thenable, in-memory) ─────────────
const { fakeSupabase } = vi.hoisted(() => {
  interface Row { id: string; [k: string]: unknown }

  class FakeSupabase {
    calls: Array<{
      op: 'upsert' | 'update' | 'select'
      table: string
      filters: Record<string, unknown>
      data?: unknown
    }> = []

    reset() { this.calls = [] }

    from(table: string) { return new FakeBuilder(this, table) }

    upsertsFor(table: string) {
      return this.calls.filter(c => c.op === 'upsert' && c.table === table)
    }

    updatesFor(table: string) {
      return this.calls.filter(c => c.op === 'update' && c.table === table)
    }
  }

  class FakeBuilder implements PromiseLike<{ data: Row[]; error: null }> {
    private _op: 'upsert' | 'update' | 'select' = 'select'
    private _filters: Record<string, unknown> = {}
    private _data: unknown = null

    constructor(private _parent: FakeSupabase, private _table: string) {}

    select(_cols: string) { this._op = 'select'; return this }
    upsert(data: unknown) { this._op = 'upsert'; this._data = data; return this }
    update(data: unknown) { this._op = 'update'; this._data = data; return this }
    eq(col: string, val: unknown) { this._filters[col] = val; return this }
    is(col: string, val: null | boolean) { this._filters[col] = val; return this }
    order(_col: string) { return this }

    then<T1 = { data: Row[]; error: null }, T2 = never>(
      onfulfilled?: (v: { data: Row[]; error: null }) => T1 | PromiseLike<T1>,
      _onrejected?: (r: unknown) => T2 | PromiseLike<T2>,
    ): PromiseLike<T1 | T2> {
      this._parent.calls.push({
        op: this._op, table: this._table,
        filters: { ...this._filters }, data: this._data,
      })
      return Promise.resolve({ data: [] as Row[], error: null as const }).then(onfulfilled)
    }
  }

  return { fakeSupabase: new FakeSupabase() }
})

// Wire FakeSupabase as the supabase module export
vi.mock('../lib/supabase', () => ({
  supabase: fakeSupabase,
  isPreviewMode: { value: false },
}))

// The real syncQueue journals descriptors to IndexedDB, which isn't available
// in happy-dom and isn't the subject under test here — stub it so the queue's
// timing/backpressure logic runs unchanged while its durable side effects are
// inert. (crossTabSync is left real: BroadcastChannel is safe under happy-dom
// and both the queue and the store depend on several of its exports.) (LIFT-1010)
vi.mock('../lib/durableStorage', () => ({
  backupToIDB: vi.fn(),
  restoreFromIDB: vi.fn(() => Promise.resolve(null)),
}))

vi.mock('../lib/logger', () => ({
  logError: vi.fn(), logWarn: vi.fn(), logInfo: vi.fn(),
}))

// Imports after mocks — NOTE: syncQueue is the REAL module now (LIFT-1010).
import { useWorkoutStore } from '../stores/workout'
import {
  syncQueue,
  syncStatus,
  _resetRateLimit,
  _resetCircuitBreaker,
  _getCircuitBreakerState,
} from '../lib/syncQueue'
import { isTombstoned, _resetTombstones } from '../lib/tombstones'

const localStorageMock = getLocalStorageMock()
// Flush pending timers + the microtask chains the real queue kicks off. Driven
// by fake timers (not a real setTimeout) so tests don't burn wall-clock time or
// flake under CI load (LIFT-895).
const tick = () => vi.runAllTimersAsync()

describe('Sync Pipeline Integration (LIFT-654 / LIFT-1010)', () => {
  const TEST_USER = 'user-integration-test'

  beforeEach(() => {
    vi.useFakeTimers()
    localStorageMock.clear()
    fakeSupabase.reset()
    _resetTombstones()
    // Reset the shared singleton queue + its module-scope backpressure state so
    // no timing/rate/breaker state leaks between tests (LIFT-1010).
    syncQueue.clear()
    _resetRateLimit()
    _resetCircuitBreaker()
    syncStatus.value = 'synced'
    vi.clearAllMocks()
    // Spy on the real enqueue methods, calling through — preserves the
    // "was called with this key" assertions without stubbing out the queue.
    vi.spyOn(syncQueue, 'enqueue')
    vi.spyOn(syncQueue, 'enqueueDelete')
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  // ── logSet → real syncQueue debounce → Supabase upsert ─────────
  describe('logSet pipeline', () => {
    it('persists to localStorage and enqueues an upsert with correct payload', async () => {
      const store = useWorkoutStore()
      await store.init(TEST_USER)
      const exerciseId = store.addExercise('Bench Press', ['Push'])!
      fakeSupabase.reset() // clear any init-phase calls
      vi.clearAllMocks()

      store.logSet(exerciseId, 225, 5)
      await tick()

      // 1. Store mutation: set exists in memory
      const exercise = store.exercises.find(e => e.id === exerciseId)!
      expect(exercise.sets).toHaveLength(1)
      const set = exercise.sets[0]
      expect(set.weight).toBe(225)
      expect(set.reps).toBe(5)
      expect(set.estimated1RM).toBeGreaterThan(0)

      // 2. localStorage persisted
      const stored = JSON.parse(localStorageMock.getItem('workout-exercises') as string)
      const storedExercise = stored.find((e: { id: string }) => e.id === exerciseId)
      expect(storedExercise.sets).toHaveLength(1)
      expect(storedExercise.sets[0].weight).toBe(225)

      // 3. syncQueue.enqueue was called (real method, spied)
      expect(syncQueue.enqueue).toHaveBeenCalledOnce()
      const enqueueKey = (syncQueue.enqueue as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(enqueueKey).toBe(`set:${set.id}`)

      // 4. FakeSupabase received the upsert with correct payload shape
      const upserts = fakeSupabase.upsertsFor('sets')
      expect(upserts).toHaveLength(1)
      const payload = upserts[0].data as Record<string, unknown>
      expect(payload).toMatchObject({
        id: set.id,
        user_id: TEST_USER,
        exercise_id: exerciseId,
        weight: 225,
        reps: 5,
        estimated_1rm: set.estimated1RM,
      })
      // Verify snake_case column name (not camelCase)
      expect(payload).toHaveProperty('estimated_1rm')
      expect(payload).not.toHaveProperty('estimated1RM')
    })

    it('holds the upsert until the debounce window elapses (real queue timing)', async () => {
      const store = useWorkoutStore()
      await store.init(TEST_USER)
      const exerciseId = store.addExercise('Bench Press', ['Push'])!
      await tick() // drain the exercise-creation upsert
      fakeSupabase.reset()
      vi.clearAllMocks()

      store.logSet(exerciseId, 135, 8)

      // Enqueued, but the 1s debounce means nothing has hit Supabase yet.
      expect(syncQueue.pending).toBe(1)
      expect(fakeSupabase.upsertsFor('sets')).toHaveLength(0)

      // Just short of the window — still pending.
      await vi.advanceTimersByTimeAsync(999)
      expect(fakeSupabase.upsertsFor('sets')).toHaveLength(0)

      // Crossing the window flushes it.
      await vi.advanceTimersByTimeAsync(1)
      expect(fakeSupabase.upsertsFor('sets')).toHaveLength(1)
      expect(syncQueue.pending).toBe(0)
    })
  })

  // ── deleteSet → tombstone → real enqueueDelete → soft-delete ─────
  describe('deleteSet pipeline', () => {
    it('creates tombstone and enqueues a soft-delete update', async () => {
      const store = useWorkoutStore()
      await store.init(TEST_USER)
      const exerciseId = store.addExercise('Squat', ['Legs'])!
      store.logSet(exerciseId, 315, 3)
      await tick()
      const setId = store.exercises.find(e => e.id === exerciseId)!.sets[0].id
      fakeSupabase.reset()
      vi.clearAllMocks()

      store.deleteSet(exerciseId, setId)
      await tick()

      // 1. Set removed from store
      const exercise = store.exercises.find(e => e.id === exerciseId)!
      expect(exercise.sets).toHaveLength(0)

      // 2. Tombstone recorded
      expect(isTombstoned('sets', setId)).toBe(true)

      // 3. localStorage persisted (set gone)
      const stored = JSON.parse(localStorageMock.getItem('workout-exercises') as string)
      const storedExercise = stored.find((e: { id: string }) => e.id === exerciseId)
      expect(storedExercise.sets).toHaveLength(0)

      // 4. syncQueue.enqueueDelete was called (real method, spied)
      expect(syncQueue.enqueueDelete).toHaveBeenCalledOnce()
      const deleteKey = (syncQueue.enqueueDelete as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(deleteKey).toBe(`set:${setId}`)

      // 5. FakeSupabase received a soft-delete update (not a hard DELETE)
      const updates = fakeSupabase.updatesFor('sets')
      expect(updates).toHaveLength(1)
      const updatePayload = updates[0].data as Record<string, unknown>
      expect(updatePayload).toHaveProperty('deleted_at')
      expect(typeof updatePayload.deleted_at).toBe('string')
      // Verify correct filters
      expect(updates[0].filters).toMatchObject({
        id: setId,
        user_id: TEST_USER,
      })
    })
  })

  // ── debounce/batching: rapid mutations coalesce into one flush ───
  describe('debounce & batching', () => {
    it('coalesces rapid successive logSets into a single flush batch', async () => {
      const store = useWorkoutStore()
      await store.init(TEST_USER)
      const exerciseId = store.addExercise('Bench Press', ['Push'])!
      await tick() // drain the exercise-creation upsert
      fakeSupabase.reset()
      vi.clearAllMocks()
      const flushSpy = vi.spyOn(syncQueue, 'flush')

      // Three sets logged within the debounce window, each resetting the timer.
      store.logSet(exerciseId, 100, 5)
      await vi.advanceTimersByTimeAsync(400)
      store.logSet(exerciseId, 105, 5)
      await vi.advanceTimersByTimeAsync(400)
      store.logSet(exerciseId, 110, 5)

      // Debounced: three distinct set:* keys queued, nothing flushed yet.
      expect(syncQueue.pending).toBe(3)
      expect(flushSpy).not.toHaveBeenCalled()
      expect(fakeSupabase.upsertsFor('sets')).toHaveLength(0)

      await tick()

      // A single flush drained all three into one Supabase batch.
      expect(flushSpy).toHaveBeenCalledTimes(1)
      expect(fakeSupabase.upsertsFor('sets')).toHaveLength(3)
      expect(syncQueue.pending).toBe(0)
    })

    it('dedupes same-key writes to a single last-write-wins upsert', async () => {
      const store = useWorkoutStore()
      await store.init(TEST_USER)
      const exerciseId = store.addExercise('Bench Press', ['Push'])!
      store.logSet(exerciseId, 135, 5)
      await tick()
      const setId = store.exercises.find(e => e.id === exerciseId)!.sets[0].id
      fakeSupabase.reset()
      vi.clearAllMocks()

      // Two edits to the SAME set before the window elapses share key set:<id>.
      store.updateSet(exerciseId, setId, 150, 6)
      store.updateSet(exerciseId, setId, 200, 8)

      // Deduped in the queue — one pending op, not two.
      expect(syncQueue.pending).toBe(1)

      await tick()

      const upserts = fakeSupabase.upsertsFor('sets')
      expect(upserts).toHaveLength(1)
      const payload = upserts[0].data as Record<string, unknown>
      // Last write wins: the final edit's values, not the first.
      expect(payload).toMatchObject({ id: setId, weight: 200, reps: 8 })
    })
  })

  // ── rate limiter: overflow defers into the next window ───────────
  describe('rate limiting', () => {
    it('defers operations past the per-window cap, then releases them', async () => {
      const OVER_LIMIT = 201 // RATE_LIMIT_MAX is 200
      const makeUpsert = (i: number) => () =>
        fakeSupabase.from('sets').upsert({
          id: `rl-${i}`, user_id: TEST_USER, exercise_id: 'x',
          date: '2026-07-22T23:59:00Z', weight: 100, reps: 5, estimated_1rm: 100,
        })

      for (let i = 0; i < OVER_LIMIT; i++) {
        syncQueue.enqueue(`set:rl-${i}`, makeUpsert(i))
      }

      // 200 admitted to the live queue, the 201st held in the deferred bucket.
      expect(syncQueue.pending).toBe(OVER_LIMIT)

      // Flush the admitted batch — the deferred op is still held back.
      await vi.advanceTimersByTimeAsync(1000)
      expect(fakeSupabase.upsertsFor('sets')).toHaveLength(200)
      expect(syncQueue.pending).toBe(1)

      // The rate window resets after 60s, releasing the deferred op.
      await vi.advanceTimersByTimeAsync(60_000)
      await tick()
      expect(fakeSupabase.upsertsFor('sets')).toHaveLength(OVER_LIMIT)
      expect(syncQueue.pending).toBe(0)
    })
  })

  // ── circuit breaker: a delete storm trips the SEV1 guard ─────────
  describe('delete circuit breaker', () => {
    it('trips after a burst of distinct-key deletes and blocks the overflow', async () => {
      const store = useWorkoutStore()
      await store.init(TEST_USER)
      const exerciseId = store.addExercise('Squat', ['Legs'])!
      // Log 21 sets so we can drive 21 distinct-key soft-deletes.
      for (let i = 0; i < 21; i++) store.logSet(exerciseId, 100 + i, 5)
      await tick()
      const setIds = store.exercises.find(e => e.id === exerciseId)!.sets.map(s => s.id)
      fakeSupabase.reset()
      vi.clearAllMocks()
      syncStatus.value = 'synced'

      // CIRCUIT_BREAKER_THRESHOLD is 20 within a 10s window: the first 20
      // deletes are admitted, the 21st trips the breaker and is blocked.
      for (const setId of setIds) store.deleteSet(exerciseId, setId)

      // Assert the trip BEFORE the debounce flush fires — the breaker flips the
      // status to 'error' synchronously on the 21st delete, but the subsequent
      // successful flush of the 20 admitted deletes resets it back to 'synced'.
      const state = _getCircuitBreakerState()
      expect(state.tripCount).toBe(1)
      expect(state.openUntil).toBeGreaterThan(0)
      expect(syncStatus.value).toBe('error')

      await tick()

      // 20 soft-deletes reached Supabase; the blocked one never enqueued.
      expect(fakeSupabase.updatesFor('sets')).toHaveLength(20)

      // Local-first: every set is still removed from the store regardless of the
      // breaker — only the server sync of the overflow delete is suppressed.
      expect(store.exercises.find(e => e.id === exerciseId)!.sets).toHaveLength(0)
    })
  })

  // ── sync gating: no sync when userId is not set ────────────────
  describe('sync gating', () => {
    it('does not enqueue when store is not initialized with a userId', async () => {
      const store = useWorkoutStore()
      // Deliberately skip store.init() — no userId set
      const exerciseId = store.addExercise('Deadlift')!

      store.logSet(exerciseId, 405, 1)
      await tick()

      // Set exists locally but nothing was enqueued
      expect(store.exercises.find(e => e.id === exerciseId)!.sets).toHaveLength(1)
      expect(syncQueue.enqueue).not.toHaveBeenCalled()
      expect(fakeSupabase.upsertsFor('sets')).toHaveLength(0)
    })
  })
})
