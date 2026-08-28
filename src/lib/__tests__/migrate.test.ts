import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock supabase and uuid before importing the module under test
const mockSelect = vi.fn()
const mockEq = vi.fn()
const mockInsert = vi.fn()
const mockFrom = vi.fn()
const mockDelete = vi.fn()
const mockDeleteEq = vi.fn()
const mockDeleteIn = vi.fn()

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
              return result ?? Promise.resolve({ count: 0 })
            },
          }
        },
        insert: (rows: unknown[]) => {
          // Tests can override the result per table via mockInsert's return
          // value; default to a clean success.
          const result = mockInsert(table, rows)
          return Promise.resolve(result ?? { error: null })
        },
        delete: () => {
          mockDelete(table)
          return {
            eq: (...eqArgs: unknown[]) => {
              mockDeleteEq(...eqArgs)
              return {
                in: (...inArgs: unknown[]) => {
                  mockDeleteIn(...inArgs)
                  return Promise.resolve({ error: null })
                },
              }
            },
          }
        },
      }
    },
  },
}))

let uuidCounter = 0
vi.mock('../uuid', () => ({
  uuid: () => `test-uuid-${++uuidCounter}`,
}))

import { migrateLocalStorageToSupabase } from '../migrate'

describe('migrateLocalStorageToSupabase', () => {
  let localStorageMock: Record<string, string>

  beforeEach(() => {
    vi.clearAllMocks()
    // clearAllMocks does not reset implementations, so restore the default
    // (clean-success / empty-count) behavior between tests that override them.
    mockInsert.mockReset()
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
    mockEq.mockReturnValueOnce(Promise.resolve({ count: 5 }))

    await migrateLocalStorageToSupabase('user-1')

    expect(mockFrom).toHaveBeenCalledWith('exercises')
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('skips migration when localStorage is empty', async () => {
    await migrateLocalStorageToSupabase('user-1')

    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('migrates exercises and sets from localStorage to Supabase', async () => {
    const exercises = [
      {
        name: 'Bench Press',
        sets: [
          { date: '2026-03-30', weight: 100, reps: 8, estimated1RM: 125 },
          { date: '2026-03-30', weight: 110, reps: 5, estimated1RM: 128 },
        ],
      },
      {
        name: 'Squat',
        sets: [{ date: '2026-03-30', weight: 140, reps: 5, estimated1RM: 163 }],
      },
    ]
    localStorageMock['workout-exercises'] = JSON.stringify(exercises)

    await migrateLocalStorageToSupabase('user-1')

    // Should insert exercise rows
    expect(mockInsert).toHaveBeenCalledWith('exercises', [
      { id: 'test-uuid-1', user_id: 'user-1', name: 'Bench Press' },
      { id: 'test-uuid-4', user_id: 'user-1', name: 'Squat' },
    ])

    // Should insert set rows with mapped field names
    expect(mockInsert).toHaveBeenCalledWith('sets', [
      { id: 'test-uuid-2', user_id: 'user-1', exercise_id: 'test-uuid-1', date: '2026-03-30', weight: 100, reps: 8, estimated_1rm: 125 },
      { id: 'test-uuid-3', user_id: 'user-1', exercise_id: 'test-uuid-1', date: '2026-03-30', weight: 110, reps: 5, estimated_1rm: 128 },
      { id: 'test-uuid-5', user_id: 'user-1', exercise_id: 'test-uuid-4', date: '2026-03-30', weight: 140, reps: 5, estimated_1rm: 163 },
    ])
  })

  it('migrates bodyweight entries', async () => {
    const entries = [
      { date: '2026-03-28', weight: 185 },
      { date: '2026-03-29', weight: 184.5 },
    ]
    localStorageMock['bodyweight-entries'] = JSON.stringify(entries)

    await migrateLocalStorageToSupabase('user-1')

    expect(mockInsert).toHaveBeenCalledWith('bodyweight_entries', [
      { id: 'test-uuid-1', user_id: 'user-1', date: '2026-03-28', weight: 185 },
      { id: 'test-uuid-2', user_id: 'user-1', date: '2026-03-29', weight: 184.5 },
    ])
  })

  it('migrates both exercises and bodyweight in one call', async () => {
    localStorageMock['workout-exercises'] = JSON.stringify([
      { name: 'Deadlift', sets: [] },
    ])
    localStorageMock['bodyweight-entries'] = JSON.stringify([
      { date: '2026-03-30', weight: 180 },
    ])

    await migrateLocalStorageToSupabase('user-1')

    expect(mockInsert).toHaveBeenCalledWith('exercises', [
      { id: 'test-uuid-1', user_id: 'user-1', name: 'Deadlift' },
    ])
    expect(mockInsert).toHaveBeenCalledWith('bodyweight_entries', [
      { id: 'test-uuid-2', user_id: 'user-1', date: '2026-03-30', weight: 180 },
    ])
  })

  it('handles exercises with no sets array', async () => {
    localStorageMock['workout-exercises'] = JSON.stringify([
      { name: 'Pull-ups' },
    ])

    await migrateLocalStorageToSupabase('user-1')

    expect(mockInsert).toHaveBeenCalledWith('exercises', [
      { id: 'test-uuid-1', user_id: 'user-1', name: 'Pull-ups' },
    ])
    // sets insert should not be called since there are no set rows
    expect(mockInsert).not.toHaveBeenCalledWith('sets', expect.anything())
  })

  it('handles malformed localStorage JSON gracefully', async () => {
    localStorageMock['workout-exercises'] = '{invalid json'
    localStorageMock['bodyweight-entries'] = '{also invalid'

    // Should not throw
    await migrateLocalStorageToSupabase('user-1')

    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('aborts without migrating when the count guard query errors (LIFT-787)', async () => {
    // A transient count-query failure returns null count + an error. The old
    // guard read null as "empty" and would have duplicated existing cloud data.
    mockEq.mockReturnValueOnce(Promise.resolve({ count: null, error: { message: 'network' } }))
    localStorageMock['workout-exercises'] = JSON.stringify([
      { name: 'Bench Press', sets: [{ date: '2026-03-30', weight: 100, reps: 8, estimated1RM: 125 }] },
    ])

    await migrateLocalStorageToSupabase('user-1')

    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('aborts before inserting sets if the exercises insert fails (LIFT-787)', async () => {
    mockInsert.mockImplementation((table: string) =>
      table === 'exercises' ? { error: { message: 'insert failed' } } : { error: null }
    )
    localStorageMock['workout-exercises'] = JSON.stringify([
      { name: 'Bench Press', sets: [{ date: '2026-03-30', weight: 100, reps: 8, estimated1RM: 125 }] },
    ])

    await migrateLocalStorageToSupabase('user-1')

    expect(mockInsert).toHaveBeenCalledWith('exercises', expect.anything())
    // Sets must not be inserted, and no rollback is needed (nothing landed).
    expect(mockInsert).not.toHaveBeenCalledWith('sets', expect.anything())
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('rolls back orphaned exercises if the sets insert fails (LIFT-787)', async () => {
    // Exercises land but sets fail — without rollback the user is left with
    // exercises-without-sets AND the count guard permanently blocks a re-run.
    mockInsert.mockImplementation((table: string) =>
      table === 'sets' ? { error: { message: 'sets failed' } } : { error: null }
    )
    localStorageMock['workout-exercises'] = JSON.stringify([
      { name: 'Bench Press', sets: [{ date: '2026-03-30', weight: 100, reps: 8, estimated1RM: 125 }] },
      { name: 'Squat', sets: [{ date: '2026-03-30', weight: 140, reps: 5, estimated1RM: 163 }] },
    ])

    await migrateLocalStorageToSupabase('user-1')

    // The freshly-minted exercise rows are deleted, scoped to this user and to
    // exactly the UUIDs we created this run.
    expect(mockDelete).toHaveBeenCalledWith('exercises')
    expect(mockDeleteEq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(mockDeleteIn).toHaveBeenCalledWith('id', ['test-uuid-1', 'test-uuid-3'])
  })

  it('skips bodyweight migration when the bodyweight count guard errors (LIFT-787)', async () => {
    mockEq
      .mockReturnValueOnce(Promise.resolve({ count: 0 })) // exercises count
      .mockReturnValueOnce(Promise.resolve({ count: null, error: { message: 'rls' } })) // bodyweight count
    localStorageMock['bodyweight-entries'] = JSON.stringify([{ date: '2026-03-28', weight: 185 }])

    await migrateLocalStorageToSupabase('user-1')

    expect(mockInsert).not.toHaveBeenCalledWith('bodyweight_entries', expect.anything())
  })

  it('skips bodyweight migration when bodyweight already exists in the cloud (LIFT-787)', async () => {
    mockEq
      .mockReturnValueOnce(Promise.resolve({ count: 0 })) // exercises count
      .mockReturnValueOnce(Promise.resolve({ count: 3 })) // bodyweight already migrated
    localStorageMock['bodyweight-entries'] = JSON.stringify([{ date: '2026-03-28', weight: 185 }])

    await migrateLocalStorageToSupabase('user-1')

    expect(mockInsert).not.toHaveBeenCalledWith('bodyweight_entries', expect.anything())
  })

  // ── LIFT-947: validate untrusted localStorage before the one-way cloud insert ──

  it('drops sets with missing/invalid required fields, migrating only valid ones', async () => {
    localStorageMock['workout-exercises'] = JSON.stringify([
      {
        name: 'Bench Press',
        sets: [
          { date: '2026-03-30', weight: 100, reps: 8, estimated1RM: 125 }, // valid
          { weight: 100, reps: 8, estimated1RM: 125 }, // missing date
          { date: '2026-03-30', weight: '110', reps: 5, estimated1RM: 128 }, // string weight
          { date: '2026-03-30', weight: 120, reps: null, estimated1RM: 130 }, // null reps
          { date: '2026-03-30', weight: Infinity, reps: 5, estimated1RM: 130 }, // non-finite weight
          null, // not an object
        ],
      },
    ])

    await migrateLocalStorageToSupabase('user-1')

    expect(mockInsert).toHaveBeenCalledWith('exercises', [
      { id: 'test-uuid-1', user_id: 'user-1', name: 'Bench Press' },
    ])
    expect(mockInsert).toHaveBeenCalledWith('sets', [
      { id: 'test-uuid-2', user_id: 'user-1', exercise_id: 'test-uuid-1', date: '2026-03-30', weight: 100, reps: 8, estimated_1rm: 125 },
    ])
  })

  it('repairs a missing/invalid estimated1RM via Epley instead of dropping the set', async () => {
    localStorageMock['workout-exercises'] = JSON.stringify([
      {
        name: 'Squat',
        sets: [
          { date: '2026-03-30', weight: 100, reps: 10 }, // no estimated1RM → epley(100,10)=133
          { date: '2026-03-30', weight: 140, reps: 5, estimated1RM: 'oops' }, // bad type → epley(140,5)=163
        ],
      },
    ])

    await migrateLocalStorageToSupabase('user-1')

    expect(mockInsert).toHaveBeenCalledWith('sets', [
      { id: 'test-uuid-2', user_id: 'user-1', exercise_id: 'test-uuid-1', date: '2026-03-30', weight: 100, reps: 10, estimated_1rm: 133 },
      { id: 'test-uuid-3', user_id: 'user-1', exercise_id: 'test-uuid-1', date: '2026-03-30', weight: 140, reps: 5, estimated_1rm: 163 },
    ])
  })

  it('drops malformed exercises (missing/blank name or non-object) before inserting', async () => {
    localStorageMock['workout-exercises'] = JSON.stringify([
      { name: 'Deadlift', sets: [] }, // valid
      { name: '' }, // blank name
      { sets: [] }, // no name
      'not-an-object',
      null,
    ])

    await migrateLocalStorageToSupabase('user-1')

    expect(mockInsert).toHaveBeenCalledWith('exercises', [
      { id: 'test-uuid-1', user_id: 'user-1', name: 'Deadlift' },
    ])
  })

  it('ignores a non-array exercises blob without throwing', async () => {
    localStorageMock['workout-exercises'] = JSON.stringify({ not: 'an array' })

    await migrateLocalStorageToSupabase('user-1')

    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('drops bodyweight entries with missing/invalid fields, migrating only valid ones', async () => {
    localStorageMock['bodyweight-entries'] = JSON.stringify([
      { date: '2026-03-28', weight: 185 }, // valid
      { weight: 185 }, // missing date
      { date: '2026-03-29', weight: 'heavy' }, // string weight
      { date: '2026-03-30', weight: NaN }, // non-finite
      null,
    ])

    await migrateLocalStorageToSupabase('user-1')

    expect(mockInsert).toHaveBeenCalledWith('bodyweight_entries', [
      { id: 'test-uuid-1', user_id: 'user-1', date: '2026-03-28', weight: 185 },
    ])
  })

  it('surfaces (does not silently drop) a failed bodyweight insert', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockInsert.mockImplementation((table: string) =>
      table === 'bodyweight_entries' ? { error: { message: 'insert failed' } } : { error: null }
    )
    localStorageMock['bodyweight-entries'] = JSON.stringify([{ date: '2026-03-28', weight: 185 }])

    await migrateLocalStorageToSupabase('user-1')

    expect(mockInsert).toHaveBeenCalledWith('bodyweight_entries', expect.anything())
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
