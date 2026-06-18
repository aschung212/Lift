import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock supabase and uuid before importing the module under test
const mockSelect = vi.fn()
const mockEq = vi.fn()
const mockInsert = vi.fn()
const mockFrom = vi.fn()

vi.mock('../supabase', () => ({
  supabase: {
    from: (table: string) => {
      mockFrom(table)
      return {
        select: (...args: unknown[]) => {
          mockSelect(...args)
          return {
            eq: (...eqArgs: unknown[]) => {
              mockEq(...eqArgs)
              return Promise.resolve({ count: 0 })
            },
          }
        },
        insert: (rows: unknown[]) => {
          const result = mockInsert(table, rows)
          return Promise.resolve(result ?? { error: null })
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

  // Regression LIFT-782: Supabase inserts RESOLVE with an `.error` field on a
  // DB/RLS failure rather than rejecting. The migration must surface that as a
  // thrown error so it is not silently marked complete and can be re-run.
  it('throws and skips dependent set inserts when the exercises insert fails', async () => {
    localStorageMock['workout-exercises'] = JSON.stringify([
      {
        name: 'Bench Press',
        sets: [{ date: '2026-03-30', weight: 100, reps: 8, estimated1RM: 125 }],
      },
    ])

    // exercises insert resolves with an error (e.g. RLS denial)
    mockInsert.mockReturnValueOnce({ error: { message: 'RLS policy violation' } })

    await expect(migrateLocalStorageToSupabase('user-1')).rejects.toThrow(
      /Migration failed inserting exercises/
    )

    // Sets must NOT be inserted when the parent exercises insert failed —
    // otherwise we strand sets pointing at rows that don't exist.
    expect(mockInsert).toHaveBeenCalledWith('exercises', expect.anything())
    expect(mockInsert).not.toHaveBeenCalledWith('sets', expect.anything())
  })

  it('throws when the sets insert fails after exercises succeed', async () => {
    localStorageMock['workout-exercises'] = JSON.stringify([
      {
        name: 'Squat',
        sets: [{ date: '2026-03-30', weight: 140, reps: 5, estimated1RM: 163 }],
      },
    ])

    // exercises insert succeeds, sets insert resolves with an error
    mockInsert
      .mockReturnValueOnce({ error: null })
      .mockReturnValueOnce({ error: { message: 'server error' } })

    await expect(migrateLocalStorageToSupabase('user-1')).rejects.toThrow(
      /Migration failed inserting sets/
    )
  })

  it('throws when the bodyweight insert fails', async () => {
    localStorageMock['bodyweight-entries'] = JSON.stringify([
      { date: '2026-03-30', weight: 185 },
    ])

    mockInsert.mockReturnValueOnce({ error: { message: 'server error' } })

    await expect(migrateLocalStorageToSupabase('user-1')).rejects.toThrow(
      /Migration failed inserting bodyweight entries/
    )
  })
})
