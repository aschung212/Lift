/**
 * Behavioral fuzz test for the sync READ path (SEV1 2026-04-12 regression guard).
 *
 * Why this exists: the pre-#338 bug destroyed ~40-60% of one user's workout data
 * by letting client-side dedup broadcast DELETEs from `_fetchFromSupabase`.
 * The existing structural tests in workout.test.ts / bodyweight.test.ts prove
 * the bad code strings aren't present, but they don't prove the behavior.
 *
 * These tests mount the real store against an in-memory fake Supabase and
 * assert what actually matters: seeding the server with the exact dupe
 * patterns that triggered the SEV1 must NOT produce any server-side DELETEs
 * from the sync READ path. User-initiated deletes still work.
 *
 * If the bug returns, these tests fail with a clear semantic failure
 * (row count dropped / unexpected delete call), not a regex mismatch.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ── Fake Supabase client ─────────────────────────────────────────
// Chainable, thenable, in-memory. Records every call for assertions.
// Defined inside vi.hoisted so it's available to the vi.mock factory
// below (which runs before imports).

const { fakeSupabase } = vi.hoisted(() => {
  interface Row { id: string; [k: string]: unknown }

  class FakeSupabase {
    tables: Record<string, Row[]> = {
      exercises: [],
      sets: [],
      bodyweight_entries: [],
    }
    calls: Array<{
      op: 'select' | 'delete' | 'upsert' | 'update'
      table: string
      filters: Record<string, unknown>
      data?: unknown
    }> = []

    reset() {
      this.tables = { exercises: [], sets: [], bodyweight_entries: [] }
      this.calls = []
    }

    seed(table: string, rows: Row[]) {
      this.tables[table] = rows.map(r => ({ ...r }))
    }

    from(table: string) {
      return new FakeBuilder(this, table)
    }

    deletesFor(table: string) {
      return this.calls.filter(c => c.op === 'delete' && c.table === table)
    }

    upsertsFor(table: string) {
      return this.calls.filter(c => c.op === 'upsert' && c.table === table)
    }

    _exec(
      op: FakeSupabase['calls'][number]['op'],
      table: string,
      filters: Record<string, unknown>,
      data?: unknown,
    ): Row[] {
      this.calls.push({ op, table, filters: { ...filters }, data })
      const rows = this.tables[table] || (this.tables[table] = [])
      const matches = rows.filter(r =>
        Object.entries(filters).every(([k, v]) => r[k] === v),
      )

      if (op === 'select') return matches
      if (op === 'delete') {
        const ids = new Set(matches.map(r => r.id))
        this.tables[table] = rows.filter(r => !ids.has(r.id))
        return matches
      }
      if (op === 'upsert') {
        const records = Array.isArray(data) ? data : [data as Row]
        for (const rec of records) {
          const idx = rows.findIndex(r => r.id === rec.id)
          if (idx >= 0) rows[idx] = { ...rows[idx], ...rec }
          else rows.push({ ...rec })
        }
        return records
      }
      if (op === 'update') {
        for (const m of matches) Object.assign(m, data as Row)
        return matches
      }
      return []
    }
  }

  class FakeBuilder implements PromiseLike<{ data: Row[]; error: null }> {
    private _op: 'select' | 'delete' | 'upsert' | 'update' = 'select'
    private _filters: Record<string, unknown> = {}
    private _data: unknown = null

    constructor(private _parent: FakeSupabase, private _table: string) {}

    select(_cols: string) { this._op = 'select'; return this }
    delete() { this._op = 'delete'; return this }
    upsert(data: unknown) { this._op = 'upsert'; this._data = data; return this }
    update(data: unknown) { this._op = 'update'; this._data = data; return this }
    eq(col: string, val: unknown) { this._filters[col] = val; return this }
    order(_col: string) { return this }

    then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
      onfulfilled?: (v: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>,
      _onrejected?: (r: unknown) => TResult2 | PromiseLike<TResult2>,
    ): PromiseLike<TResult1 | TResult2> {
      const data = this._parent._exec(this._op, this._table, this._filters, this._data)
      return Promise.resolve({ data, error: null as const }).then(onfulfilled)
    }
  }

  return { fakeSupabase: new FakeSupabase() }
})

// Override the global setup.ts mock (supabase: null) with our fake
vi.mock('../../lib/supabase', () => ({
  supabase: fakeSupabase,
  isPreviewMode: { value: false },
}))

// Synchronous syncQueue — invoke ops immediately so assertions don't race debounce
vi.mock('../../lib/syncQueue', () => {
  const invoke = (_key: string, op: () => PromiseLike<unknown>) => {
    // Kick off the op; swallow rejection to match production behavior on best-effort sync
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

// Mock analytics / logger so they don't complain in the test environment
vi.mock('../../lib/logger', () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}))

// Imports must come AFTER vi.mock so the mocks are in place
import { useWorkoutStore } from '../workout'
import { useBodyweightStore } from '../bodyweight'
import { getLocalStorageMock } from '../../__tests__/helpers'

// Helper: flush a microtask tick so any op() chained via syncQueue settles
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

describe('sync fuzz: SEV1 2026-04-12 regression', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    fakeSupabase.reset()
    getLocalStorageMock().clear()
  })

  describe('workoutStore._fetchFromSupabase — READ path is read-only', () => {
    it('does NOT delete sets even when (user|exercise|date|weight|reps) tuples collide (straight-set SEV1 pattern)', async () => {
      // The exact pattern that destroyed crgulland15's data:
      // 5 sets, backdated to the same fixed noon-local timestamp, identical weight/reps.
      const userId = 'test-user'
      fakeSupabase.seed('exercises', [
        { id: 'ex-1', user_id: userId, name: 'Bench Press', tags: [],
          created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
      ])
      fakeSupabase.seed('sets', Array.from({ length: 5 }, (_, i) => ({
        id: `s-${i + 1}`,
        user_id: userId,
        exercise_id: 'ex-1',
        date: '2026-01-01T12:00:00Z',
        weight: 225,
        reps: 5,
        estimated_1rm: 253,
      })))

      const store = useWorkoutStore()
      await store.init(userId)
      await tick()

      expect(fakeSupabase.deletesFor('sets')).toEqual([])
      expect(fakeSupabase.deletesFor('exercises')).toEqual([])
      expect(fakeSupabase.tables.sets).toHaveLength(5)
      expect(fakeSupabase.tables.exercises).toHaveLength(1)
    })

    it('does NOT delete exercises even with case-insensitive same-name duplicates', async () => {
      const userId = 'test-user'
      fakeSupabase.seed('exercises', [
        { id: 'ex-a', user_id: userId, name: 'Squat', tags: [],
          created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
        { id: 'ex-b', user_id: userId, name: 'squat', tags: [],
          created_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-02T00:00:00Z' },
        { id: 'ex-c', user_id: userId, name: 'SQUAT', tags: [],
          created_at: '2026-01-03T00:00:00Z', updated_at: '2026-01-03T00:00:00Z' },
      ])

      const store = useWorkoutStore()
      await store.init(userId)
      await tick()

      expect(fakeSupabase.deletesFor('exercises')).toEqual([])
      expect(fakeSupabase.deletesFor('sets')).toEqual([])
      expect(fakeSupabase.tables.exercises).toHaveLength(3)
    })

    it('fuzz: row counts are monotonic (never decrease) across repeated sync cycles', async () => {
      const userId = 'test-user'
      // Seed server with a mix of straight-set + jittered workouts across 3 exercises
      fakeSupabase.seed('exercises', [
        { id: 'e1', user_id: userId, name: 'Bench', tags: [],
          created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
        { id: 'e2', user_id: userId, name: 'Squat', tags: [],
          created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
        { id: 'e3', user_id: userId, name: 'Deadlift', tags: [],
          created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
      ])
      const sets = []
      // 5x5 Bench with the SEV1 collision pattern
      for (let i = 0; i < 5; i++) {
        sets.push({ id: `b-${i}`, user_id: userId, exercise_id: 'e1',
          date: '2026-01-02T12:00:00Z', weight: 225, reps: 5, estimated_1rm: 253 })
      }
      // 3x10 Squat with same collision pattern
      for (let i = 0; i < 3; i++) {
        sets.push({ id: `sq-${i}`, user_id: userId, exercise_id: 'e2',
          date: '2026-01-03T23:59:59Z', weight: 315, reps: 10, estimated_1rm: 420 })
      }
      // Deadlift, jittered timestamps (the "good" case)
      for (let i = 0; i < 5; i++) {
        sets.push({ id: `d-${i}`, user_id: userId, exercise_id: 'e3',
          date: `2026-01-04T12:00:${String(i).padStart(2, '0')}.${String(i * 100).padStart(3, '0')}Z`,
          weight: 405, reps: 3, estimated_1rm: 446 })
      }
      fakeSupabase.seed('sets', sets)

      const initialSetCount = fakeSupabase.tables.sets.length
      const initialExerciseCount = fakeSupabase.tables.exercises.length

      // Repeatedly init — simulates reconnect / tab re-focus / cross-device syncs
      const store = useWorkoutStore()
      for (let round = 0; round < 8; round++) {
        await store.init(userId)
        await tick()
        expect(
          fakeSupabase.tables.sets.length,
          `sets shrank on round ${round}`,
        ).toBeGreaterThanOrEqual(initialSetCount)
        expect(
          fakeSupabase.tables.exercises.length,
          `exercises shrank on round ${round}`,
        ).toBeGreaterThanOrEqual(initialExerciseCount)
      }

      expect(fakeSupabase.deletesFor('sets')).toEqual([])
      expect(fakeSupabase.deletesFor('exercises')).toEqual([])
    })
  })

  describe('bodyweightStore._fetchFromSupabase — READ path is read-only', () => {
    it('does NOT delete entries even with same-date duplicates (SEV1 pattern)', async () => {
      const userId = 'test-user'
      fakeSupabase.seed('bodyweight_entries', [
        { id: 'bw-1', user_id: userId, date: '2026-01-01T12:00:00Z',
          weight: 180, updated_at: '2026-01-01T12:00:00Z' },
        { id: 'bw-2', user_id: userId, date: '2026-01-01T18:00:00Z',
          weight: 181, updated_at: '2026-01-01T18:00:00Z' },
        { id: 'bw-3', user_id: userId, date: '2026-01-01T23:00:00Z',
          weight: 182, updated_at: '2026-01-01T23:00:00Z' },
      ])

      const store = useBodyweightStore()
      await store.init(userId)
      await tick()

      expect(fakeSupabase.deletesFor('bodyweight_entries')).toEqual([])
      expect(fakeSupabase.tables.bodyweight_entries).toHaveLength(3)
    })

    it('fuzz: bodyweight row count never decreases across repeated sync cycles', async () => {
      const userId = 'test-user'
      fakeSupabase.seed('bodyweight_entries', Array.from({ length: 6 }, (_, i) => ({
        id: `bw-${i}`,
        user_id: userId,
        date: `2026-01-0${(i % 3) + 1}T12:00:00Z`, // intentional date collisions
        weight: 180 + i,
        updated_at: `2026-01-0${(i % 3) + 1}T12:00:00Z`,
      })))
      const initial = fakeSupabase.tables.bodyweight_entries.length

      const store = useBodyweightStore()
      for (let round = 0; round < 5; round++) {
        await store.init(userId)
        await tick()
        expect(fakeSupabase.tables.bodyweight_entries.length).toBeGreaterThanOrEqual(initial)
      }
      expect(fakeSupabase.deletesFor('bodyweight_entries')).toEqual([])
    })
  })

  describe('user-initiated deletes still reach the server (positive control)', () => {
    it('deleteSet issues exactly one DELETE on the sets table', async () => {
      const userId = 'test-user'
      fakeSupabase.seed('exercises', [
        { id: 'ex-1', user_id: userId, name: 'Bench', tags: [],
          created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
      ])
      fakeSupabase.seed('sets', [
        { id: 's-1', user_id: userId, exercise_id: 'ex-1',
          date: '2026-01-01T12:00:00Z', weight: 225, reps: 5, estimated_1rm: 253 },
      ])

      const store = useWorkoutStore()
      await store.init(userId)
      await tick()
      // Baseline: no deletes from init
      expect(fakeSupabase.deletesFor('sets')).toEqual([])

      store.deleteSet('ex-1', 's-1')
      await tick()

      const deletes = fakeSupabase.deletesFor('sets')
      expect(deletes).toHaveLength(1)
      expect(deletes[0].filters).toMatchObject({ id: 's-1', user_id: userId })
      expect(fakeSupabase.tables.sets).toHaveLength(0)
    })

    it('bodyweight deleteEntry issues exactly one DELETE on bodyweight_entries', async () => {
      const userId = 'test-user'
      fakeSupabase.seed('bodyweight_entries', [
        { id: 'bw-1', user_id: userId, date: '2026-01-01T12:00:00Z',
          weight: 180, updated_at: '2026-01-01T12:00:00Z' },
      ])

      const store = useBodyweightStore()
      await store.init(userId)
      await tick()
      expect(fakeSupabase.deletesFor('bodyweight_entries')).toEqual([])

      store.deleteEntry('bw-1')
      await tick()

      const deletes = fakeSupabase.deletesFor('bodyweight_entries')
      expect(deletes).toHaveLength(1)
      expect(deletes[0].filters).toMatchObject({ id: 'bw-1', user_id: userId })
      expect(fakeSupabase.tables.bodyweight_entries).toHaveLength(0)
    })
  })
})
