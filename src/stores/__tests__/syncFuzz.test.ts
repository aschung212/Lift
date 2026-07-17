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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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

    updatesFor(table: string) {
      return this.calls.filter(c => c.op === 'update' && c.table === table)
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
        Object.entries(filters).every(([k, v]) => {
          // .is(col, null) sentinel: match NULL or missing
          if (v !== null && typeof v === 'object' && v !== undefined && '__is' in v) {
            const target = (v as { __is: unknown }).__is
            if (target === null) return r[k] == null
            return r[k] === target
          }
          return r[k] === v
        }),
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
    is(col: string, val: null | boolean) { this._filters[col] = { __is: val }; return this }
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
import { _resetTombstones } from '../../lib/tombstones'

// Helper: flush pending timers + the microtask chains kicked off by the
// synchronous syncQueue mock. Driven by fake timers (not a real setTimeout)
// so tests don't burn wall-clock time or flake under CI load (LIFT-895).
const tick = () => vi.runAllTimersAsync()

describe('sync fuzz: SEV1 2026-04-12 regression', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    fakeSupabase.reset()
    getLocalStorageMock().clear()
    // Tombstones cache in-memory — must be reset or they leak between tests
    _resetTombstones()
  })

  afterEach(() => {
    vi.useRealTimers()
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

  describe('user-initiated deletes soft-delete on the server (Gate 5)', () => {
    it('deleteSet issues UPDATE { deleted_at } (never a hard DELETE)', async () => {
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

      store.deleteSet('ex-1', 's-1')
      await tick()

      // NO hard delete
      expect(fakeSupabase.deletesFor('sets')).toEqual([])
      // Exactly one UPDATE with deleted_at set, scoped to id + user_id
      const updates = fakeSupabase.updatesFor('sets')
      expect(updates).toHaveLength(1)
      expect(updates[0].filters).toMatchObject({ id: 's-1', user_id: userId })
      expect((updates[0].data as Record<string, unknown>).deleted_at).toBeTypeOf('string')
      // Server row still exists but with deleted_at populated
      expect(fakeSupabase.tables.sets).toHaveLength(1)
      expect(fakeSupabase.tables.sets[0].deleted_at).toBeTypeOf('string')
    })

    it('bodyweight deleteEntry issues UPDATE { deleted_at } (never a hard DELETE)', async () => {
      const userId = 'test-user'
      fakeSupabase.seed('bodyweight_entries', [
        { id: 'bw-1', user_id: userId, date: '2026-01-01T12:00:00Z',
          weight: 180, updated_at: '2026-01-01T12:00:00Z' },
      ])

      const store = useBodyweightStore()
      await store.init(userId)
      await tick()

      store.deleteEntry('bw-1')
      await tick()

      expect(fakeSupabase.deletesFor('bodyweight_entries')).toEqual([])
      const updates = fakeSupabase.updatesFor('bodyweight_entries')
      expect(updates).toHaveLength(1)
      expect(updates[0].filters).toMatchObject({ id: 'bw-1', user_id: userId })
      expect((updates[0].data as Record<string, unknown>).deleted_at).toBeTypeOf('string')
      expect(fakeSupabase.tables.bodyweight_entries).toHaveLength(1)
      expect(fakeSupabase.tables.bodyweight_entries[0].deleted_at).toBeTypeOf('string')
    })

    it('deleteExercise soft-deletes the exercise AND its sets (cascade)', async () => {
      const userId = 'test-user'
      fakeSupabase.seed('exercises', [
        { id: 'ex-1', user_id: userId, name: 'Bench', tags: [],
          created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
      ])
      fakeSupabase.seed('sets', [
        { id: 's-1', user_id: userId, exercise_id: 'ex-1',
          date: '2026-01-01T12:00:00Z', weight: 225, reps: 5, estimated_1rm: 253 },
        { id: 's-2', user_id: userId, exercise_id: 'ex-1',
          date: '2026-01-02T12:00:00Z', weight: 235, reps: 5, estimated_1rm: 264 },
      ])

      const store = useWorkoutStore()
      await store.init(userId)
      await tick()

      store.deleteExercise('ex-1')
      await tick()

      expect(fakeSupabase.deletesFor('sets')).toEqual([])
      expect(fakeSupabase.deletesFor('exercises')).toEqual([])
      // Exactly one UPDATE on each table
      const exerciseUpdates = fakeSupabase.updatesFor('exercises')
      const setsUpdates = fakeSupabase.updatesFor('sets')
      expect(exerciseUpdates).toHaveLength(1)
      expect(setsUpdates).toHaveLength(1)
      // Sets cascade targets exercise_id, not individual set ids
      expect(setsUpdates[0].filters).toMatchObject({ exercise_id: 'ex-1', user_id: userId })
      // Rows still present with deleted_at populated
      expect(fakeSupabase.tables.exercises[0].deleted_at).toBeTypeOf('string')
      expect(fakeSupabase.tables.sets.every(s => s.deleted_at != null)).toBe(true)
    })

    it('restoreSet issues UPDATE { deleted_at: null } (undo delete)', async () => {
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

      const setToDelete = { ...store.exercises[0].sets[0] }
      store.deleteSet('ex-1', 's-1')
      await tick()
      store.restoreSet('ex-1', setToDelete)
      await tick()

      const updates = fakeSupabase.updatesFor('sets')
      // First update: deleted_at=<time>; second: deleted_at=null
      expect(updates).toHaveLength(2)
      expect((updates[0].data as Record<string, unknown>).deleted_at).toBeTypeOf('string')
      expect((updates[1].data as Record<string, unknown>).deleted_at).toBeNull()
      // Final server state: restored
      expect(fakeSupabase.tables.sets[0].deleted_at).toBeNull()
    })

    it('restoreExercise issues UPDATE { deleted_at: null } on both exercise and sets', async () => {
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
      const exerciseCopy = { ...store.exercises[0] }

      store.deleteExercise('ex-1')
      await tick()
      store.restoreExercise(exerciseCopy)
      await tick()

      const exUpdates = fakeSupabase.updatesFor('exercises')
      const setUpdates = fakeSupabase.updatesFor('sets')
      // Two updates each: soft-delete then restore
      expect(exUpdates).toHaveLength(2)
      expect(setUpdates).toHaveLength(2)
      expect((exUpdates[1].data as Record<string, unknown>).deleted_at).toBeNull()
      expect((setUpdates[1].data as Record<string, unknown>).deleted_at).toBeNull()
      // Final state: all rows active
      expect(fakeSupabase.tables.exercises[0].deleted_at).toBeNull()
      expect(fakeSupabase.tables.sets[0].deleted_at).toBeNull()
    })

    it('_fetchFromSupabase filters soft-deleted rows (uses .is(deleted_at, null))', async () => {
      const userId = 'test-user'
      fakeSupabase.seed('exercises', [
        { id: 'ex-active', user_id: userId, name: 'Active', tags: [],
          created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
          deleted_at: null },
        { id: 'ex-deleted', user_id: userId, name: 'Deleted', tags: [],
          created_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
          deleted_at: '2026-04-01T00:00:00Z' },
      ])
      fakeSupabase.seed('sets', [
        { id: 's-active', user_id: userId, exercise_id: 'ex-active',
          date: '2026-01-01T12:00:00Z', weight: 225, reps: 5, estimated_1rm: 253,
          deleted_at: null },
        { id: 's-deleted', user_id: userId, exercise_id: 'ex-active',
          date: '2026-01-02T12:00:00Z', weight: 235, reps: 5, estimated_1rm: 264,
          deleted_at: '2026-04-01T00:00:00Z' },
      ])

      const store = useWorkoutStore()
      await store.init(userId)
      await tick()

      // Only active rows should appear in local state
      expect(store.exercises.map(e => e.id)).toEqual(['ex-active'])
      expect(store.exercises[0].sets.map(s => s.id)).toEqual(['s-active'])
    })

    it('bodyweight _fetchFromSupabase filters soft-deleted entries', async () => {
      const userId = 'test-user'
      fakeSupabase.seed('bodyweight_entries', [
        { id: 'bw-active', user_id: userId, date: '2026-01-01T12:00:00Z',
          weight: 180, updated_at: '2026-01-01T12:00:00Z', deleted_at: null },
        { id: 'bw-deleted', user_id: userId, date: '2026-01-02T12:00:00Z',
          weight: 181, updated_at: '2026-01-02T12:00:00Z',
          deleted_at: '2026-04-01T00:00:00Z' },
      ])

      const store = useBodyweightStore()
      await store.init(userId)
      await tick()

      expect(store.entries.map(e => e.id)).toEqual(['bw-active'])
    })
  })

  // ── Exercise archival (LIFT-434) ───────────────────────────────
  describe('archive sync survives subsequent mutations and offline races', () => {
    it('archiveExercise upsert payload includes archived_at and propagates to the server', async () => {
      const userId = 'test-user'
      fakeSupabase.seed('exercises', [
        { id: 'ex-1', user_id: userId, name: 'Bench', tags: [],
          created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
      ])
      const store = useWorkoutStore()
      await store.init(userId)
      await tick()

      store.archiveExercise('ex-1')
      await tick()

      const upserts = fakeSupabase.upsertsFor('exercises')
      const archivePayload = (upserts[upserts.length - 1].data as Record<string, unknown>)
      expect(archivePayload.archived_at).toBeTypeOf('string')
      expect(fakeSupabase.tables.exercises[0].archived_at).toBeTypeOf('string')
    })

    it('subsequent rename after archive preserves archived_at on the server', async () => {
      // Critical regression: the syncQueue dedupes by `exercise:${id}` key, so
      // a rename queued right after archive used to overwrite the archive
      // upsert with a payload missing archived_at, clearing it server-side.
      const userId = 'test-user'
      fakeSupabase.seed('exercises', [
        { id: 'ex-1', user_id: userId, name: 'Bench', tags: [],
          created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
      ])
      const store = useWorkoutStore()
      await store.init(userId)
      await tick()

      store.archiveExercise('ex-1')
      store.renameExercise('ex-1', 'Bench Press')
      await tick()

      expect(fakeSupabase.tables.exercises[0].name).toBe('Bench Press')
      expect(fakeSupabase.tables.exercises[0].archived_at).toBeTypeOf('string')
    })

    it('unarchiveExercise clears archived_at on the server', async () => {
      const userId = 'test-user'
      fakeSupabase.seed('exercises', [
        { id: 'ex-1', user_id: userId, name: 'Bench', tags: [],
          archived_at: '2026-04-15T12:00:00Z',
          created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
      ])
      const store = useWorkoutStore()
      await store.init(userId)
      await tick()
      expect(store.exercises[0].archived_at).toBeTypeOf('string')

      store.unarchiveExercise('ex-1')
      await tick()

      expect(fakeSupabase.tables.exercises[0].archived_at).toBeNull()
    })
  })

  // ── Reconciliation gap (LIFT-706) ──────────────────────────────
  // A set added offline to an exercise that ANOTHER device later updated:
  // the remote exercise wins last-write-wins, so it is neither localOnly nor
  // localWins. Before the fix, its offline-added set rendered locally but was
  // never pushed — silently diverging from the server. Now it must be pushed.
  describe('reconciliation pushes offline sets on remote-winning exercises', () => {
    it('upserts a local-only set even when the remote exercise wins the merge', async () => {
      const userId = 'test-user'
      // Local state (loaded from localStorage): older exercise timestamp, but
      // it holds an extra set ('s-local') that was logged offline.
      getLocalStorageMock().setItem('workout-exercises', JSON.stringify([
        {
          id: 'ex-1', name: 'Bench', tags: [],
          updated_at: '2026-01-01T00:00:00Z',
          sets: [
            { id: 's-local', date: '2026-01-15T12:00:00Z', weight: 200, reps: 5, estimated1RM: 233 },
          ],
        },
      ]))
      // Remote state: NEWER exercise timestamp (so remote wins the merge) and a
      // different set the server already knows about.
      fakeSupabase.seed('exercises', [
        { id: 'ex-1', user_id: userId, name: 'Bench', tags: [],
          created_at: '2026-01-01T00:00:00Z', updated_at: '2026-02-01T00:00:00Z' },
      ])
      fakeSupabase.seed('sets', [
        { id: 's-remote', user_id: userId, exercise_id: 'ex-1',
          date: '2026-01-20T12:00:00Z', weight: 225, reps: 5, estimated_1rm: 253 },
      ])

      const store = useWorkoutStore()
      await store.init(userId)
      await tick()

      // The offline set was pushed to the server (the gap fix)…
      const setUpserts = fakeSupabase.upsertsFor('sets')
      const pushedIds = setUpserts.map(u => (u.data as { id: string }).id)
      expect(pushedIds).toContain('s-local')
      // …and the server now holds BOTH sets, no deletes anywhere.
      expect(fakeSupabase.tables.sets.map(s => s.id).sort()).toEqual(['s-local', 's-remote'])
      expect(fakeSupabase.deletesFor('sets')).toEqual([])
      // The already-synced remote set is not redundantly re-pushed.
      expect(pushedIds).not.toContain('s-remote')
    })

    it('does not re-push sets that already exist on the remote exercise', async () => {
      const userId = 'test-user'
      getLocalStorageMock().setItem('workout-exercises', JSON.stringify([
        {
          id: 'ex-1', name: 'Bench', tags: [],
          updated_at: '2026-01-01T00:00:00Z',
          sets: [
            { id: 's-shared', date: '2026-01-20T12:00:00Z', weight: 225, reps: 5, estimated1RM: 253 },
          ],
        },
      ]))
      fakeSupabase.seed('exercises', [
        { id: 'ex-1', user_id: userId, name: 'Bench', tags: [],
          created_at: '2026-01-01T00:00:00Z', updated_at: '2026-02-01T00:00:00Z' },
      ])
      fakeSupabase.seed('sets', [
        { id: 's-shared', user_id: userId, exercise_id: 'ex-1',
          date: '2026-01-20T12:00:00Z', weight: 225, reps: 5, estimated_1rm: 253 },
      ])

      const store = useWorkoutStore()
      await store.init(userId)
      await tick()

      // Nothing new to push — the set is already on the remote.
      expect(fakeSupabase.upsertsFor('sets')).toEqual([])
      expect(fakeSupabase.deletesFor('sets')).toEqual([])
    })
  })
})
