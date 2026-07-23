/**
 * Sync Pipeline Integration Tests (LIFT-654)
 *
 * Verifies the connected pipeline: logSet → store mutation → localStorage
 * persist → syncQueue enqueue → Supabase upsert payload shape. Also covers
 * deleteSet → tombstone → enqueueDelete → soft-delete payload.
 *
 * Existing coverage gap: workout.test.ts mocks syncQueue entirely,
 * syncFuzz.test.ts focuses on the READ path. This test is the first to
 * verify that store WRITE actions produce correct Supabase payloads
 * through the real enqueue wiring.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from './helpers'

// ── Shared Supabase test double (LIFT-1009) ────────────────────
// One configurable fake, imported via async vi.hoisted so the vi.mock factory
// below can reference the same instance the tests seed/assert against.
const { fakeSupabase } = await vi.hoisted(async () => {
  const { createFakeSupabase } = await import('./fakeSupabase')
  return { fakeSupabase: createFakeSupabase({ mode: 'ok' }) }
})

// Wire the shared fake as the supabase module export
vi.mock('../lib/supabase', () => ({
  supabase: fakeSupabase,
  isPreviewMode: { value: false },
}))

// Synchronous syncQueue — invoke ops immediately so we can assert payloads
vi.mock('../lib/syncQueue', () => {
  const invoke = (_key: string, op: () => PromiseLike<unknown>) => {
    Promise.resolve(op()).catch(() => {})
  }
  return {
    syncQueue: {
      enqueue: vi.fn(invoke),
      enqueueDelete: vi.fn(invoke),
      clear: vi.fn(),
    },
    syncStatus: { value: 'synced' as const },
    _resetRateLimit: vi.fn(),
    _resetCircuitBreaker: vi.fn(),
  }
})

vi.mock('../lib/logger', () => ({
  logError: vi.fn(), logWarn: vi.fn(), logInfo: vi.fn(),
}))

// Imports after mocks
import { useWorkoutStore } from '../stores/workout'
import { syncQueue } from '../lib/syncQueue'
import { isTombstoned, _resetTombstones } from '../lib/tombstones'

const localStorageMock = getLocalStorageMock()
// Flush pending timers + the microtask chains kicked off by the synchronous
// syncQueue mock. Driven by fake timers (not a real setTimeout) so tests don't
// burn wall-clock time or flake under CI load (LIFT-895).
const tick = () => vi.runAllTimersAsync()

describe('Sync Pipeline Integration (LIFT-654)', () => {
  const TEST_USER = 'user-integration-test'

  beforeEach(() => {
    vi.useFakeTimers()
    localStorageMock.clear()
    fakeSupabase.reset()
    _resetTombstones()
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ── logSet → syncQueue.enqueue → Supabase upsert ──────────────
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

      // 3. syncQueue.enqueue was called
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
  })

  // ── deleteSet → tombstone → syncQueue.enqueueDelete → soft-delete ─
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

      // 4. syncQueue.enqueueDelete was called
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
