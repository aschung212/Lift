/**
 * Regression tests for the read-side recovery entry point (LIFT-1226).
 *
 * Every store's `_fetchFromSupabase` swallows read failures into `lastSyncError`
 * with NO retry, so a transient offline blip / mid-session token expiry / offline
 * cold start used to leave the app on stale local-only data until a full
 * relaunch. `store.refetch()` is the recovery entry point — it re-pulls from the
 * server WITHOUT re-running the localStorage→Supabase migration, no-ops when
 * signed out, and coalesces overlapping fetches via each store's `syncing` guard
 * so reconnect flaps can't stack requests.
 *
 * These tests mount the real stores against the in-memory fake Supabase, init
 * against an empty server, then seed new rows and prove `refetch()` picks them
 * up — the exact "come back online and it just works" behavior the finding says
 * was silently false for reads.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const { fakeSupabase } = await vi.hoisted(async () => {
  const { createFakeSupabase } = await import('../../__tests__/fakeSupabase')
  return { fakeSupabase: createFakeSupabase({ mode: 'ok' }) }
})

vi.mock('../../lib/supabase', () => ({
  supabase: fakeSupabase,
  isPreviewMode: { value: false },
}))

// Synchronous syncQueue so enqueued reconciliation writes don't race a debounce.
vi.mock('../../lib/syncQueue', () => {
  const invoke = (_key: string, op: () => PromiseLike<unknown>) => {
    Promise.resolve(op()).catch(() => {})
  }
  return {
    syncQueue: {
      enqueue: vi.fn(invoke),
      enqueueDelete: vi.fn(invoke),
      clear: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
    },
    syncStatus: { value: 'synced' as const },
    _resetRateLimit: vi.fn(),
    _resetCircuitBreaker: vi.fn(),
  }
})

vi.mock('../../lib/logger', () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}))

import { useWorkoutStore } from '../workout'
import { useBodyweightStore } from '../bodyweight'
import { useProgressionStore } from '../progression'
import { usePreferencesStore } from '../preferences'
import { getLocalStorageMock } from '../../__tests__/helpers'
import { _resetTombstones } from '../../lib/tombstones'

const localStorageMock = getLocalStorageMock()

describe('store refetch() — read-side recovery (LIFT-1226)', () => {
  beforeEach(() => {
    localStorageMock.clear()
    fakeSupabase.reset()
    _resetTombstones()
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  afterEach(() => {
    _resetTombstones()
  })

  describe('workout store', () => {
    it('re-pulls server rows written after the initial fetch, without re-migrating', async () => {
      const store = useWorkoutStore()
      await store.init('u1')
      expect(store.exercises).toHaveLength(0)

      // A second device writes a new exercise to the server after our first load.
      fakeSupabase.seed('exercises', [
        { id: 'ex-remote', user_id: 'u1', name: 'Deadlift', tags: [], deleted_at: null,
          updated_at: '2026-08-27T00:00:00.000Z', created_at: '2026-08-27T00:00:00.000Z' },
      ])

      await store.refetch()

      expect(store.exercises.map(e => e.name)).toContain('Deadlift')
    })

    it('no-ops when signed out (no _userId) — never queries the server', async () => {
      const store = useWorkoutStore()
      await store.refetch()
      expect(fakeSupabase.selectsFor('exercises')).toHaveLength(0)
    })

    it('no-ops while a fetch is already in flight (overlap guard)', async () => {
      const store = useWorkoutStore()
      await store.init('u1')
      const selectsAfterInit = fakeSupabase.selectsFor('exercises').length

      // Simulate an in-flight fetch, then a reconnect flap firing a second refetch.
      store.syncing = true
      fakeSupabase.seed('exercises', [
        { id: 'ex-remote', user_id: 'u1', name: 'Deadlift', tags: [], deleted_at: null,
          updated_at: '2026-08-27T00:00:00.000Z', created_at: '2026-08-27T00:00:00.000Z' },
      ])
      await store.refetch()

      expect(fakeSupabase.selectsFor('exercises')).toHaveLength(selectsAfterInit)
      expect(store.exercises).toHaveLength(0)
    })
  })

  describe('bodyweight store', () => {
    it('re-pulls server entries written after the initial fetch', async () => {
      const store = useBodyweightStore()
      await store.init('u1')
      expect(store.entries).toHaveLength(0)

      fakeSupabase.seed('bodyweight_entries', [
        { id: 'bw-remote', user_id: 'u1', date: '2026-08-27T23:59:59.000Z', weight: 182,
          deleted_at: null, updated_at: '2026-08-27T00:00:00.000Z', created_at: '2026-08-27T00:00:00.000Z' },
      ])

      await store.refetch()

      expect(store.entries.map(e => e.id)).toContain('bw-remote')
    })

    it('no-ops when signed out', async () => {
      const store = useBodyweightStore()
      await store.refetch()
      expect(fakeSupabase.selectsFor('bodyweight_entries')).toHaveLength(0)
    })
  })

  describe('progression store', () => {
    it('re-pulls server progression written after the initial fetch', async () => {
      const store = useProgressionStore()
      await store.init('u1')

      fakeSupabase.seed('user_progression', [
        { id: 'p-remote', user_id: 'u1', streak_weeks: 7, weekly_target: 4,
          progression_enabled: true, unlocked_themes: [], xp_per_set: {},
          bodyweight_xp_dates: [], streak_history: [] },
      ])

      await store.refetch()

      expect(store.streakWeeks).toBe(7)
    })

    it('no-ops when signed out', async () => {
      const store = useProgressionStore()
      await store.refetch()
      expect(fakeSupabase.selectsFor('user_progression')).toHaveLength(0)
    })
  })

  describe('preferences store', () => {
    it('re-pulls the synced preferences blob without re-running init migration', async () => {
      const store = usePreferencesStore()
      await store.init('u1')
      expect(store.weightUnit).toBe('lbs')

      fakeSupabase.seed('user_preferences', [
        { id: 'pref-remote', user_id: 'u1',
          preferences: { features: { workouts: true }, weightUnit: 'kg' } },
      ])

      await store.refetch()

      expect(store.weightUnit).toBe('kg')
    })

    it('no-ops when signed out', async () => {
      const store = usePreferencesStore()
      await store.refetch()
      expect(fakeSupabase.selectsFor('user_preferences')).toHaveLength(0)
    })
  })
})
