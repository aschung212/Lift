import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock supabase and uuid before importing the module under test
const mockSelect = vi.fn()
const mockEq = vi.fn()
const mockUpsert = vi.fn()
const mockFrom = vi.fn()
const mockDelete = vi.fn()
const mockInsert = vi.fn()

vi.mock('../supabase', () => ({
  supabase: {
    from: (table: string) => {
      mockFrom(table)
      return {
        select: (...args: unknown[]) => {
          mockSelect(table, ...args)
          return {
            eq: (...eqArgs: unknown[]) => {
              // Tests can override the count-query result via mockEq's return
              // value (e.g. an error or a non-zero count); default to empty.
              const result = mockEq(...eqArgs)
              return result ?? Promise.resolve({ count: 0, error: null })
            },
          }
        },
        upsert: (rows: unknown[]) => {
          // Tests can override the result per table via mockUpsert's return
          // value; default to a clean success.
          const result = mockUpsert(table, rows)
          return Promise.resolve(result ?? { error: null })
        },
        // Present only so a regression back to either is an assertion failure
        // rather than a TypeError: the migration must never insert (it writes
        // the same rows the sync upserts) nor hard-delete (LIFT-1534).
        insert: (rows: unknown[]) => {
          mockInsert(table, rows)
          return Promise.resolve({ error: null })
        },
        delete: () => {
          mockDelete(table)
          return { eq: () => ({ in: () => Promise.resolve({ error: null }) }) }
        },
      }
    },
  },
}))

let uuidCounter = 0
vi.mock('../uuid', () => ({
  uuid: () => `test-uuid-${++uuidCounter}`,
}))

vi.mock('../logger', () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}))

import { migrateLocalStorageToSupabase, MIGRATION_BATCH_SIZE } from '../migrate'
import { logError } from '../logger'

const USER = 'user-1'

/** Every row upserted into `table`, across all of its requests, in order. */
function upserted(table: string): Record<string, unknown>[] {
  return mockUpsert.mock.calls
    .filter(([t]) => t === table)
    .flatMap(([, rows]) => rows as Record<string, unknown>[])
}

/** The row count of each request sent to `table`, in order. */
function requestSizes(table: string): number[] {
  return mockUpsert.mock.calls.filter(([t]) => t === table).map(([, rows]) => (rows as unknown[]).length)
}

/** The full `exercises` row the store's sync sends for an exercise with nothing configured. */
function bareExerciseRow(id: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    id, user_id: USER, name, tags: [], archived_at: null,
    bar_weight: null, plate_count_mode: null, intensity_max_reps: null,
    equipment: null, gyms: [], notes: null, bodyweight_loaded: false,
    ...overrides,
  }
}

/** The full `sets` row the store's sync sends for a set with no log time. */
function bareSetRow(
  id: string, exerciseId: string,
  set: { date: string; weight: number; reps: number; estimated_1rm: number },
) {
  return { id, user_id: USER, exercise_id: exerciseId, ...set, attempted_next_rep: false }
}

describe('migrateLocalStorageToSupabase', () => {
  let localStorageMock: Record<string, string>

  beforeEach(() => {
    vi.clearAllMocks()
    // clearAllMocks does not reset implementations, so restore the default
    // (clean-success / empty-count) behavior between tests that override them.
    mockUpsert.mockReset()
    mockEq.mockReset()
    uuidCounter = 0
    localStorageMock = {}

    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => localStorageMock[key] ?? null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    })
  })

  it('skips migration when user already has cloud data', async () => {
    mockEq.mockReturnValueOnce(Promise.resolve({ count: 5, error: null }))
    localStorageMock['workout-exercises'] = JSON.stringify([{ id: 'ex-1', name: 'Bench Press', sets: [] }])

    await migrateLocalStorageToSupabase(USER)

    expect(mockFrom).toHaveBeenCalledWith('exercises')
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('skips migration when localStorage is empty', async () => {
    await migrateLocalStorageToSupabase(USER)

    expect(mockUpsert).not.toHaveBeenCalled()
  })

  // ── LIFT-1534: the migration writes the rows the sync would write ──
  //
  // The same launch's `_fetchFromSupabase` pushes every local row whose id it
  // cannot find on the server. When this minted a fresh UUID per row, none of
  // the local ids were there, so every exercise and set went up twice. These
  // tests used to assert the minted ids, i.e. they pinned the duplication;
  // `guestAccountMigration.test.ts` runs the migration and the sync against
  // one server to show what that did.

  it('uploads every exercise, set and weigh-in under the id the device already uses (LIFT-1534)', async () => {
    localStorageMock['workout-exercises'] = JSON.stringify([
      {
        id: 'ex-bench', name: 'Bench Press', tags: [],
        sets: [
          { id: 's-1', date: '2026-03-30T23:59:10.000Z', weight: 100, reps: 8, estimated1RM: 125 },
          { id: 's-2', date: '2026-03-30T23:59:20.000Z', weight: 110, reps: 5, estimated1RM: 128 },
        ],
      },
      {
        id: 'ex-squat', name: 'Squat', tags: [],
        sets: [{ id: 's-3', date: '2026-03-30T23:59:30.000Z', weight: 140, reps: 5, estimated1RM: 163 }],
      },
    ])
    localStorageMock['bodyweight-entries'] = JSON.stringify([
      { id: 'bw-1', date: '2026-03-30T23:59:00.000Z', weight: 185 },
    ])

    await migrateLocalStorageToSupabase(USER)

    expect(upserted('exercises')).toEqual([
      bareExerciseRow('ex-bench', 'Bench Press'),
      bareExerciseRow('ex-squat', 'Squat'),
    ])
    expect(upserted('sets')).toEqual([
      bareSetRow('s-1', 'ex-bench', { date: '2026-03-30T23:59:10.000Z', weight: 100, reps: 8, estimated_1rm: 125 }),
      bareSetRow('s-2', 'ex-bench', { date: '2026-03-30T23:59:20.000Z', weight: 110, reps: 5, estimated_1rm: 128 }),
      bareSetRow('s-3', 'ex-squat', { date: '2026-03-30T23:59:30.000Z', weight: 140, reps: 5, estimated_1rm: 163 }),
    ])
    expect(upserted('bodyweight_entries')).toEqual([
      { id: 'bw-1', user_id: USER, date: '2026-03-30T23:59:00.000Z', weight: 185 },
    ])
    // Nothing was minted, and nothing went through insert, which fails on an
    // id the server already holds instead of matching it.
    expect(uuidCounter).toBe(0)
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('sends every column the sync sends, and nothing the server has no column for (LIFT-1534)', async () => {
    // The server stamps `updated_at` when the row lands, so its copy wins the
    // first merge on the device and replaces the local one. Any column missing
    // here would be erased locally by that merge.
    localStorageMock['workout-exercises'] = JSON.stringify([{
      id: 'ex-dip', name: 'Weighted Dip', tags: ['Push', 'Chest'],
      inputMode: 'plates', barWeight: 20, plateCountMode: 'total', intensityMaxReps: 6,
      equipment: 'bodyweight', gyms: ['Home'], notes: 'lean forward', bodyweightLoaded: true,
      archived_at: '2026-06-01T00:00:00.000Z',
      // Local bookkeeping with no column: never sent.
      updated_at: '2026-06-01T00:00:00.000Z', mergedFrom: ['ex-old'],
      sets: [{
        id: 's-dip', date: '2026-05-30T23:59:10.000Z', weight: 25, reps: 8, estimated1RM: 250,
        createdAt: '2026-05-30T18:04:00.000Z', attemptedNextRep: true,
        // Local-only set fields (#1357): never sent.
        rpe: 9, bodyweight: 180,
      }],
    }])

    await migrateLocalStorageToSupabase(USER)

    expect(upserted('exercises')).toEqual([{
      id: 'ex-dip', user_id: USER, name: 'Weighted Dip', tags: ['Push', 'Chest'],
      archived_at: '2026-06-01T00:00:00.000Z', input_mode: 'plates', bar_weight: 20,
      plate_count_mode: 'total', intensity_max_reps: 6, equipment: 'bodyweight',
      gyms: ['Home'], notes: 'lean forward', bodyweight_loaded: true,
    }])
    expect(upserted('sets')).toEqual([{
      id: 's-dip', user_id: USER, exercise_id: 'ex-dip', date: '2026-05-30T23:59:10.000Z',
      weight: 25, reps: 8, estimated_1rm: 250, attempted_next_rep: true,
      created_at: '2026-05-30T18:04:00.000Z',
    }])
  })

  it('mints an id only for a legacy row with none, which the store never loaded', async () => {
    // The pre-account builds keyed rows by `Date.now()`. `parseExercise` needs
    // a string id, so the store drops such a row and the sync can never push
    // it: a fresh id cannot duplicate anything.
    localStorageMock['workout-exercises'] = JSON.stringify([
      { id: 1711500000000, name: 'Deadlift', sets: [{ id: 1711500000001, date: '2026-03-27T12:00:00.000Z', weight: 315, reps: 3 }] },
      { id: 'ex-row', name: 'Barbell Row', sets: [{ date: '2026-03-30T23:59:10.000Z', weight: 135, reps: 8 }] },
    ])

    await migrateLocalStorageToSupabase(USER)

    expect(upserted('exercises').map(r => r.id)).toEqual(['test-uuid-1', 'ex-row'])
    expect(upserted('sets').map(r => [r.id, r.exercise_id])).toEqual([
      ['test-uuid-2', 'test-uuid-1'],
      ['test-uuid-3', 'ex-row'],
    ])
  })

  it('never sends a row that omits input_mode or created_at in a request with one that sends it', async () => {
    // postgrest-js sends the union of a request's keys as `columns` and writes
    // NULL into a row lacking one, not the column's DEFAULT. Both columns are
    // NOT NULL, so a mixed request would fail as a whole.
    localStorageMock['workout-exercises'] = JSON.stringify([
      {
        id: 'ex-plates', name: 'Bench Press', tags: [], inputMode: 'plates',
        sets: [
          { id: 's-timed', date: '2026-09-01T23:59:01.000Z', weight: 185, reps: 5, estimated1RM: 216, createdAt: '2026-09-01T18:00:00.000Z' },
          { id: 's-legacy', date: '2026-08-01T23:59:01.000Z', weight: 180, reps: 5, estimated1RM: 210 },
        ],
      },
      { id: 'ex-numpad', name: 'Cable Fly', tags: [], sets: [] },
    ])

    await migrateLocalStorageToSupabase(USER)

    expect(requestSizes('exercises')).toEqual([1, 1])
    expect(requestSizes('sets')).toEqual([1, 1])
    for (const [, rows] of mockUpsert.mock.calls as [string, Record<string, unknown>[]][]) {
      expect(new Set(rows.map(r => Object.keys(r).sort().join(','))).size).toBe(1)
    }
    expect(upserted('sets').map(r => r.id).sort()).toEqual(['s-legacy', 's-timed'])
  })

  it('splits a long history into requests of at most MIGRATION_BATCH_SIZE rows', async () => {
    const total = MIGRATION_BATCH_SIZE * 2 + 7
    localStorageMock['workout-exercises'] = JSON.stringify([{
      id: 'ex-bench', name: 'Bench Press', tags: [],
      sets: Array.from({ length: total }, (_, i) => ({
        id: `s-${i}`, date: '2026-03-30T23:59:10.000Z', weight: 100 + i, reps: 5, estimated1RM: 117,
      })),
    }])

    await migrateLocalStorageToSupabase(USER)

    expect(requestSizes('sets')).toEqual([MIGRATION_BATCH_SIZE, MIGRATION_BATCH_SIZE, 7])
    expect(upserted('sets').map(r => r.id)).toEqual(Array.from({ length: total }, (_, i) => `s-${i}`))
  })

  it('migrates bodyweight entries', async () => {
    localStorageMock['bodyweight-entries'] = JSON.stringify([
      { id: 'bw-1', date: '2026-03-28', weight: 185 },
      { id: 'bw-2', date: '2026-03-29', weight: 184.5 },
    ])

    await migrateLocalStorageToSupabase(USER)

    expect(upserted('bodyweight_entries')).toEqual([
      { id: 'bw-1', user_id: USER, date: '2026-03-28', weight: 185 },
      { id: 'bw-2', user_id: USER, date: '2026-03-29', weight: 184.5 },
    ])
  })

  it('migrates both exercises and bodyweight in one call', async () => {
    localStorageMock['workout-exercises'] = JSON.stringify([
      { id: 'ex-1', name: 'Deadlift', sets: [] },
    ])
    localStorageMock['bodyweight-entries'] = JSON.stringify([
      { id: 'bw-1', date: '2026-03-30', weight: 180 },
    ])

    await migrateLocalStorageToSupabase(USER)

    expect(upserted('exercises')).toEqual([bareExerciseRow('ex-1', 'Deadlift')])
    expect(upserted('bodyweight_entries')).toEqual([
      { id: 'bw-1', user_id: USER, date: '2026-03-30', weight: 180 },
    ])
  })

  it('handles exercises with no sets array', async () => {
    localStorageMock['workout-exercises'] = JSON.stringify([
      { id: 'ex-1', name: 'Pull-ups' },
    ])

    await migrateLocalStorageToSupabase(USER)

    expect(upserted('exercises')).toEqual([bareExerciseRow('ex-1', 'Pull-ups')])
    // No set rows, so no sets request at all.
    expect(mockUpsert).not.toHaveBeenCalledWith('sets', expect.anything())
  })

  it('handles malformed localStorage JSON gracefully', async () => {
    localStorageMock['workout-exercises'] = '{invalid json'
    localStorageMock['bodyweight-entries'] = '{also invalid'

    // Should not throw
    await migrateLocalStorageToSupabase(USER)

    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('aborts without migrating when the count guard query errors (LIFT-787)', async () => {
    // A transient count-query failure returns null count + an error. Read as
    // "empty", it would upsert local rows over whatever the account holds.
    mockEq.mockReturnValueOnce(Promise.resolve({ count: null, error: { message: 'network' } }))
    localStorageMock['workout-exercises'] = JSON.stringify([
      { id: 'ex-1', name: 'Bench Press', sets: [{ id: 's-1', date: '2026-03-30', weight: 100, reps: 8, estimated1RM: 125 }] },
    ])

    await migrateLocalStorageToSupabase(USER)

    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('leaves the sets to the sync when the exercises upsert fails, and still migrates bodyweight', async () => {
    mockUpsert.mockImplementation((table: string) =>
      table === 'exercises' ? { error: { message: 'upsert failed' } } : { error: null }
    )
    localStorageMock['workout-exercises'] = JSON.stringify([
      { id: 'ex-1', name: 'Bench Press', sets: [{ id: 's-1', date: '2026-03-30', weight: 100, reps: 8, estimated1RM: 125 }] },
    ])
    localStorageMock['bodyweight-entries'] = JSON.stringify([{ id: 'bw-1', date: '2026-03-28', weight: 185 }])

    await migrateLocalStorageToSupabase(USER)

    // A set cannot land before its exercise (foreign key).
    expect(mockUpsert).not.toHaveBeenCalledWith('sets', expect.anything())
    expect(upserted('bodyweight_entries')).toHaveLength(1)
    expect(logError).toHaveBeenCalledWith(
      { message: 'upsert failed' },
      { context: 'migrateLocalStorageToSupabase: exercises upsert failed' },
    )
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('keeps the exercises when their sets fail: nothing is rolled back or hard-deleted (LIFT-1534)', async () => {
    // The old rollback deleted the exercises so a re-run could insert fresh
    // copies (LIFT-787). The rows now carry the device's own ids, so the same
    // launch's sync pushes the missing sets onto them instead, and a delete
    // could only remove rows another tab's sync had written, with their sets.
    mockUpsert.mockImplementation((table: string) =>
      table === 'sets' ? { error: { message: 'sets failed' } } : { error: null }
    )
    localStorageMock['workout-exercises'] = JSON.stringify([
      { id: 'ex-1', name: 'Bench Press', sets: [{ id: 's-1', date: '2026-03-30', weight: 100, reps: 8, estimated1RM: 125 }] },
      { id: 'ex-2', name: 'Squat', sets: [{ id: 's-2', date: '2026-03-30', weight: 140, reps: 5, estimated1RM: 163 }] },
    ])

    await migrateLocalStorageToSupabase(USER)

    expect(upserted('exercises').map(r => r.id)).toEqual(['ex-1', 'ex-2'])
    expect(mockDelete).not.toHaveBeenCalled()
    expect(logError).toHaveBeenCalledWith(
      { message: 'sets failed' },
      { context: 'migrateLocalStorageToSupabase: sets upsert failed' },
    )
  })

  it('skips bodyweight migration when the bodyweight count guard errors (LIFT-787)', async () => {
    mockEq
      .mockReturnValueOnce(Promise.resolve({ count: 0, error: null })) // exercises count
      .mockReturnValueOnce(Promise.resolve({ count: null, error: { message: 'rls' } })) // bodyweight count
    localStorageMock['bodyweight-entries'] = JSON.stringify([{ id: 'bw-1', date: '2026-03-28', weight: 185 }])

    await migrateLocalStorageToSupabase(USER)

    expect(mockUpsert).not.toHaveBeenCalledWith('bodyweight_entries', expect.anything())
  })

  it('skips bodyweight migration when bodyweight already exists in the cloud (LIFT-787)', async () => {
    mockEq
      .mockReturnValueOnce(Promise.resolve({ count: 0, error: null })) // exercises count
      .mockReturnValueOnce(Promise.resolve({ count: 3, error: null })) // bodyweight already migrated
    localStorageMock['bodyweight-entries'] = JSON.stringify([{ id: 'bw-1', date: '2026-03-28', weight: 185 }])

    await migrateLocalStorageToSupabase(USER)

    expect(mockUpsert).not.toHaveBeenCalledWith('bodyweight_entries', expect.anything())
  })

  // ── LIFT-947: validate untrusted localStorage before the one-way cloud write ──

  it('drops sets with missing/invalid required fields, migrating only valid ones', async () => {
    localStorageMock['workout-exercises'] = JSON.stringify([
      {
        id: 'ex-1',
        name: 'Bench Press',
        sets: [
          { id: 's-1', date: '2026-03-30', weight: 100, reps: 8, estimated1RM: 125 }, // valid
          { id: 's-2', weight: 100, reps: 8, estimated1RM: 125 }, // missing date
          { id: 's-3', date: '2026-03-30', weight: '110', reps: 5, estimated1RM: 128 }, // string weight
          { id: 's-4', date: '2026-03-30', weight: 120, reps: null, estimated1RM: 130 }, // null reps
          { id: 's-5', date: '2026-03-30', weight: Infinity, reps: 5, estimated1RM: 130 }, // non-finite weight
          null, // not an object
        ],
      },
    ])

    await migrateLocalStorageToSupabase(USER)

    expect(upserted('exercises')).toEqual([bareExerciseRow('ex-1', 'Bench Press')])
    expect(upserted('sets')).toEqual([
      bareSetRow('s-1', 'ex-1', { date: '2026-03-30', weight: 100, reps: 8, estimated_1rm: 125 }),
    ])
  })

  it('repairs a missing/invalid estimated1RM via Epley instead of dropping the set', async () => {
    localStorageMock['workout-exercises'] = JSON.stringify([
      {
        id: 'ex-1',
        name: 'Squat',
        sets: [
          { id: 's-1', date: '2026-03-30', weight: 100, reps: 10 }, // no estimated1RM → epley(100,10)=133
          { id: 's-2', date: '2026-03-30', weight: 140, reps: 5, estimated1RM: 'oops' }, // bad type → epley(140,5)=163
        ],
      },
    ])

    await migrateLocalStorageToSupabase(USER)

    expect(upserted('sets')).toEqual([
      bareSetRow('s-1', 'ex-1', { date: '2026-03-30', weight: 100, reps: 10, estimated_1rm: 133 }),
      bareSetRow('s-2', 'ex-1', { date: '2026-03-30', weight: 140, reps: 5, estimated_1rm: 163 }),
    ])
  })

  it('drops malformed exercises (missing/blank name or non-object) before upserting', async () => {
    localStorageMock['workout-exercises'] = JSON.stringify([
      { id: 'ex-1', name: 'Deadlift', sets: [] }, // valid
      { id: 'ex-2', name: '' }, // blank name
      { id: 'ex-3', sets: [] }, // no name
      'not-an-object',
      null,
    ])

    await migrateLocalStorageToSupabase(USER)

    expect(upserted('exercises')).toEqual([bareExerciseRow('ex-1', 'Deadlift')])
  })

  it('ignores a non-array exercises blob without throwing', async () => {
    localStorageMock['workout-exercises'] = JSON.stringify({ not: 'an array' })

    await migrateLocalStorageToSupabase(USER)

    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('drops bodyweight entries with missing/invalid fields, migrating only valid ones', async () => {
    localStorageMock['bodyweight-entries'] = JSON.stringify([
      { id: 'bw-1', date: '2026-03-28', weight: 185 }, // valid
      { id: 'bw-2', weight: 185 }, // missing date
      { id: 'bw-3', date: '2026-03-29', weight: 'heavy' }, // string weight
      { id: 'bw-4', date: '2026-03-30', weight: NaN }, // non-finite
      null,
    ])

    await migrateLocalStorageToSupabase(USER)

    expect(upserted('bodyweight_entries')).toEqual([
      { id: 'bw-1', user_id: USER, date: '2026-03-28', weight: 185 },
    ])
  })

  it('surfaces (does not silently drop) a failed bodyweight upsert', async () => {
    mockUpsert.mockImplementation((table: string) =>
      table === 'bodyweight_entries' ? { error: { message: 'upsert failed' } } : { error: null }
    )
    localStorageMock['bodyweight-entries'] = JSON.stringify([{ id: 'bw-1', date: '2026-03-28', weight: 185 }])

    await migrateLocalStorageToSupabase(USER)

    expect(mockUpsert).toHaveBeenCalledWith('bodyweight_entries', expect.anything())
    expect(logError).toHaveBeenCalledWith(
      { message: 'upsert failed' },
      { context: 'migrateLocalStorageToSupabase: bodyweight upsert failed' },
    )
  })
})
