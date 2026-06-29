/**
 * #846 — real per-set timestamp (`createdAt`).
 *
 * `WorkoutSet.date` is stamped end-of-day (`…T23:59:<jitter>Z`, no time-of-day,
 * per #746). A separate `createdAt` carries the real wall-clock log time so the
 * AI Coach payload (coachDigest) can derive time-of-day + within-workout order.
 * This suite pins that contract at the store boundary:
 *   - logSet stamps a real createdAt distinct from the end-of-day date
 *   - createdAt round-trips through localStorage
 *   - editing a set never resets createdAt
 *   - the upsert row carries created_at (so offline sets keep their log time),
 *     and omits it for legacy sets with no local createdAt (leaving the
 *     server's insert-time value untouched on conflict)
 *   - the fetch mapping surfaces sets.created_at → WorkoutSet.createdAt
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

// Configurable remote dataset for the fetch-mapping test.
let mockExercises: Record<string, unknown>[] = []
let mockSets: Record<string, unknown>[] = []

// Resolving supabase mock: fetch returns the configured rows; upsert is a no-op
// (the durable thunk never runs because syncQueue is mocked — we assert on the
// descriptor row instead).
vi.mock('../../lib/supabase', () => {
  function resolvingChain(getData: () => Record<string, unknown>[]): Record<string, unknown> {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      order: () => chain,
      upsert: () => Promise.resolve({ error: null }),
      then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
        Promise.resolve({ data: getData(), error: null }).then(resolve, reject),
    }
    return chain
  }
  return {
    supabase: {
      from: (table: string) =>
        resolvingChain(() => (table === 'sets' ? mockSets : mockExercises)),
    },
    isPreviewMode: { value: false },
  }
})

vi.mock('../../lib/syncQueue', () => ({
  syncQueue: { enqueue: vi.fn(), enqueueDelete: vi.fn(), clear: vi.fn(), rehydrate: vi.fn() },
}))

vi.mock('../../lib/logger', () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}))

import { useWorkoutStore } from '../workout'
import { syncQueue } from '../../lib/syncQueue'

const NOW = '2026-06-28T14:30:00.000Z'

/** The most recent journaled set-upsert descriptor row for a given set id. */
function setUpsertRow(setId: string): Record<string, unknown> | undefined {
  const enqueue = syncQueue.enqueue as unknown as { mock: { calls: unknown[][] } }
  let row: Record<string, unknown> | undefined
  for (const call of enqueue.mock.calls) {
    const descriptor = call[2] as { table?: string; row?: Record<string, unknown> } | undefined
    if (descriptor?.table === 'sets' && descriptor.row?.id === setId) row = descriptor.row
  }
  return row
}

describe('#846 per-set createdAt timestamp', () => {
  beforeEach(() => {
    localStorageMock.clear()
    mockExercises = []
    mockSets = []
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stamps a real createdAt distinct from the end-of-day date', () => {
    const store = useWorkoutStore()
    const id = store.addExercise('Squat')!
    // Backdate the calendar day — date becomes end-of-day for that day, but the
    // log moment (createdAt) is still the real "now".
    store.logSet(id, 225, 5, '2026-06-20')

    const set = store.exercises[0].sets[0]
    expect(set.date).toMatch(/^2026-06-20T23:59:/)
    expect(set.createdAt).toBe(NOW)
    expect(set.createdAt).not.toBe(set.date)
  })

  it('persists createdAt through localStorage', () => {
    const store = useWorkoutStore()
    const id = store.addExercise('Bench')!
    store.logSet(id, 185, 5)

    const raw = localStorageMock.getItem('workout-exercises')!
    const parsed = JSON.parse(raw)
    expect(parsed[0].sets[0].createdAt).toBe(NOW)
  })

  it('does not reset createdAt when a set is edited', () => {
    const store = useWorkoutStore()
    const exId = store.addExercise('Bench')!
    store.logSet(exId, 135, 10)
    const setId = store.exercises[0].sets[0].id
    const original = store.exercises[0].sets[0].createdAt
    expect(original).toBe(NOW)

    // Time passes, then the user fixes the weight/reps and even the day.
    vi.setSystemTime(new Date('2026-06-29T09:00:00.000Z'))
    store.updateSet(exId, setId, 185, 5, '2026-06-25')

    const set = store.exercises[0].sets[0]
    expect(set.weight).toBe(185)
    expect(set.date).toMatch(/^2026-06-25T23:59:/)
    expect(set.createdAt).toBe(original) // unchanged by the edit
  })

  it('enqueues an upsert row carrying created_at for a freshly logged set', async () => {
    const store = useWorkoutStore()
    await store.init('user-1') // sets _userId so the sync branch fires
    const exId = store.addExercise('Deadlift')!
    store.logSet(exId, 315, 3)
    const setId = store.exercises[0].sets[0].id

    const row = setUpsertRow(setId)
    expect(row).toBeDefined()
    expect(row!.created_at).toBe(NOW)
  })

  it('omits created_at from the upsert row for a legacy set with no local createdAt', async () => {
    // Seed a pre-#846 set (no createdAt) directly into localStorage.
    localStorageMock.setItem('workout-exercises', JSON.stringify([
      {
        id: 'ex-legacy',
        name: 'OHP',
        tags: ['Push'],
        updated_at: '2026-05-01T00:00:00.000Z',
        sets: [{ id: 'set-legacy', date: '2026-05-01T23:59:30.000Z', weight: 95, reps: 5, estimated1RM: 111 }],
      },
    ]))
    setActivePinia(createPinia())
    const store = useWorkoutStore()
    await store.init('user-1')

    // Edit it — must not invent a created_at (would clobber the server's
    // insert-time value on conflict).
    store.updateSet('ex-legacy', 'set-legacy', 100, 5)

    const row = setUpsertRow('set-legacy')
    expect(row).toBeDefined()
    expect(row!.weight).toBe(100)
    expect('created_at' in row!).toBe(false)
  })

  it('surfaces sets.created_at from the fetch as WorkoutSet.createdAt', async () => {
    mockExercises = [
      {
        id: 'ex-1',
        name: 'Bench Press',
        tags: ['Push'],
        created_at: '2026-06-20T00:00:00.000Z',
        updated_at: '2026-06-20T00:00:00.000Z',
        deleted_at: null,
      },
    ]
    mockSets = [
      {
        id: 's-1',
        exercise_id: 'ex-1',
        date: '2026-06-20T23:59:30.000Z',
        weight: 185,
        reps: 5,
        estimated_1rm: 216,
        created_at: '2026-06-20T18:45:00.000Z',
        deleted_at: null,
      },
    ]

    const store = useWorkoutStore()
    await store.init('user-1')

    const ex = store.exercises.find(e => e.id === 'ex-1')
    expect(ex).toBeDefined()
    expect(ex!.sets[0].createdAt).toBe('2026-06-20T18:45:00.000Z')
  })
})
