/**
 * Regression test for #503: Supabase fetch failures in workout and bodyweight
 * stores must not wipe local data.
 *
 * Before this fix, a network failure during _fetchFromSupabase would propagate
 * an unhandled rejection through init() → useAuth.initStores(), leaving the
 * user staring at an empty exercise list even though localStorage had their data.
 *
 * These tests mount the real stores against a fake Supabase that throws on
 * select, seeded with local data in localStorage, and verify that:
 * 1. init() does not throw
 * 2. Local data remains intact after the failed fetch
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ── Fake Supabase that rejects every query ──────────────────────
const { failingSupabase } = vi.hoisted(() => {
  class FailingBuilder implements PromiseLike<never> {
    select() { return this }
    delete() { return this }
    upsert() { return this }
    update() { return this }
    eq() { return this }
    is() { return this }
    order() { return this }
    single() { return this }

    then<TResult1 = never, TResult2 = never>(
      _onfulfilled?: (v: never) => TResult1 | PromiseLike<TResult1>,
      onrejected?: (r: unknown) => TResult2 | PromiseLike<TResult2>,
    ): PromiseLike<TResult1 | TResult2> {
      return Promise.reject(new Error('Network unreachable')).then(_onfulfilled, onrejected)
    }
  }

  const client = {
    from(_table: string) {
      return new FailingBuilder()
    },
  }

  return { failingSupabase: client }
})

vi.mock('../../lib/supabase', () => ({
  supabase: failingSupabase,
  isPreviewMode: { value: false },
}))

vi.mock('../../lib/syncQueue', () => ({
  syncQueue: { enqueue: vi.fn(), enqueueDelete: vi.fn(), clear: vi.fn() },
  syncStatus: { value: 'synced' as const },
  _resetRateLimit: vi.fn(),
  _resetCircuitBreaker: vi.fn(),
}))

vi.mock('../../lib/logger', () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}))

import { useWorkoutStore } from '../workout'
import { useBodyweightStore } from '../bodyweight'
import { logWarn } from '../../lib/logger'

const LOCAL_EXERCISES = [
  {
    id: 'ex-1',
    name: 'Bench Press',
    tags: ['Push'],
    sets: [{ id: 's-1', date: '2026-05-01T23:59:59.000Z', weight: 225, reps: 5, estimated1RM: 253 }],
    updated_at: '2026-05-01T00:00:00.000Z',
  },
]

const LOCAL_BW_ENTRIES = [
  {
    id: 'bw-1',
    date: '2026-05-01T23:59:59.000Z',
    weight: 185,
    updated_at: '2026-05-01T00:00:00.000Z',
  },
]

describe('offline resilience: Supabase fetch failure (#503)', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  describe('workout store', () => {
    it('preserves local exercises when Supabase is unreachable', async () => {
      localStorage.setItem('workout-exercises', JSON.stringify(LOCAL_EXERCISES))

      const store = useWorkoutStore()
      // init should not throw even though Supabase rejects
      await expect(store.init('user-123')).resolves.toBeUndefined()

      expect(store.exercises).toHaveLength(1)
      expect(store.exercises[0].name).toBe('Bench Press')
      expect(store.exercises[0].sets).toHaveLength(1)
    })

    it('logs a warning when Supabase fetch fails', async () => {
      localStorage.setItem('workout-exercises', '[]')
      const store = useWorkoutStore()
      await store.init('user-123')

      expect(logWarn).toHaveBeenCalledWith(
        'Supabase fetch failed in workout store, using local data',
        expect.objectContaining({ error: expect.stringContaining('Network unreachable') }),
      )
    })
  })

  describe('bodyweight store', () => {
    it('preserves local entries when Supabase is unreachable', async () => {
      localStorage.setItem('bodyweight-entries', JSON.stringify(LOCAL_BW_ENTRIES))

      const store = useBodyweightStore()
      // Re-seed entries since the store's load() ran before we set localStorage
      store.entries = [...LOCAL_BW_ENTRIES]

      await expect(store.init('user-123')).resolves.toBeUndefined()

      expect(store.entries).toHaveLength(1)
      expect(store.entries[0].weight).toBe(185)
    })

    it('logs a warning when Supabase fetch fails', async () => {
      localStorage.setItem('bodyweight-entries', '[]')
      const store = useBodyweightStore()

      await store.init('user-123')

      expect(logWarn).toHaveBeenCalledWith(
        'Supabase fetch failed in bodyweight store, using local data',
        expect.objectContaining({ error: expect.stringContaining('Network unreachable') }),
      )
    })
  })
})
