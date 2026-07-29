/**
 * LIFT-836 — duration/time-based set support at the store boundary.
 *
 * Duration exercises (planks, dead hangs, loaded carries, isometric holds) log
 * a number of SECONDS held instead of weight × reps. This suite pins the store
 * contract:
 *   - logDurationSet stores `duration` and zeroes weight/reps/estimated1RM
 *   - a duration set is excluded from getExercisePR (estimated1RM is 0)
 *   - addExercise({ isDuration }) and setExerciseIsDuration flip the flag, and
 *     the exercise upsert row always carries is_duration
 *   - the set upsert row carries duration; a normal set sends duration: null
 *   - duration round-trips through localStorage and the Supabase fetch mapping
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

let mockExercises: Record<string, unknown>[] = []
let mockSets: Record<string, unknown>[] = []

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

/** Most recent journaled upsert descriptor row for a table + id. */
function upsertRow(table: 'sets' | 'exercises', id: string): Record<string, unknown> | undefined {
  const enqueue = syncQueue.enqueue as unknown as { mock: { calls: unknown[][] } }
  let row: Record<string, unknown> | undefined
  for (const call of enqueue.mock.calls) {
    const descriptor = call[2] as { table?: string; row?: Record<string, unknown> } | undefined
    if (descriptor?.table === table && descriptor.row?.id === id) row = descriptor.row
  }
  return row
}

describe('LIFT-836 duration sets', () => {
  beforeEach(() => {
    localStorageMock.clear()
    mockExercises = []
    mockSets = []
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('logDurationSet stores seconds and zeroes weight/reps/estimated1RM', () => {
    const store = useWorkoutStore()
    const id = store.addExercise('Plank', [], { isDuration: true })!
    store.logDurationSet(id, 90, '2026-07-20')

    const set = store.exercises[0].sets[0]
    expect(set.duration).toBe(90)
    expect(set.weight).toBe(0)
    expect(set.reps).toBe(0)
    expect(set.estimated1RM).toBe(0)
    expect(set.date).toMatch(/^2026-07-20T23:59:/)
  })

  it('clamps and rejects invalid durations', () => {
    const store = useWorkoutStore()
    const id = store.addExercise('Dead Hang', [], { isDuration: true })!
    store.logDurationSet(id, 0) // rejected
    store.logDurationSet(id, -5) // rejected
    expect(store.exercises[0].sets).toHaveLength(0)
    store.logDurationSet(id, 999999) // clamped to max
    expect(store.exercises[0].sets[0].duration).toBe(86399)
  })

  it('excludes a duration set from getExercisePR', () => {
    const store = useWorkoutStore()
    const id = store.addExercise('Weighted Plank', [], { isDuration: true })!
    store.logDurationSet(id, 120)
    expect(store.getExercisePR(id)).toBe(0)
  })

  it('addExercise({ isDuration }) sets the flag and the upsert carries is_duration', async () => {
    const store = useWorkoutStore()
    await store.init('user-1')
    const id = store.addExercise('Farmer Carry', [], { isDuration: true })!
    expect(store.exercises[0].isDuration).toBe(true)
    const row = upsertRow('exercises', id)
    expect(row!.is_duration).toBe(true)
  })

  it('setExerciseIsDuration toggles the flag and clears it on false', async () => {
    const store = useWorkoutStore()
    await store.init('user-1')
    const id = store.addExercise('Hold')!
    store.setExerciseIsDuration(id, true)
    expect(store.exercises[0].isDuration).toBe(true)
    store.setExerciseIsDuration(id, false)
    expect(store.exercises[0].isDuration).toBeUndefined()
    expect(upsertRow('exercises', id)!.is_duration).toBe(false)
  })

  it('duration set upsert row carries duration; a normal set sends null', async () => {
    const store = useWorkoutStore()
    await store.init('user-1')
    const durId = store.addExercise('Plank', [], { isDuration: true })!
    store.logDurationSet(durId, 60)
    const durSetId = store.exercises.find(e => e.id === durId)!.sets[0].id
    expect(upsertRow('sets', durSetId)!.duration).toBe(60)

    const wtId = store.addExercise('Squat')!
    store.logSet(wtId, 225, 5)
    const wtSetId = store.exercises.find(e => e.id === wtId)!.sets[0].id
    expect(upsertRow('sets', wtSetId)!.duration).toBeNull()
  })

  it('round-trips duration + isDuration through localStorage', () => {
    const store = useWorkoutStore()
    const id = store.addExercise('Plank', [], { isDuration: true })!
    store.logDurationSet(id, 75)

    setActivePinia(createPinia())
    const reloaded = useWorkoutStore()
    expect(reloaded.exercises[0].isDuration).toBe(true)
    expect(reloaded.exercises[0].sets[0].duration).toBe(75)
  })

  it('surfaces sets.duration and exercises.is_duration from the fetch', async () => {
    mockExercises = [
      { id: 'ex-1', name: 'Plank', tags: [], is_duration: true, created_at: '2026-06-20T00:00:00.000Z', updated_at: '2026-06-20T00:00:00.000Z', deleted_at: null },
    ]
    mockSets = [
      { id: 's-1', exercise_id: 'ex-1', date: '2026-06-20T23:59:30.000Z', weight: 0, reps: 0, estimated_1rm: 0, duration: 90, created_at: '2026-06-20T18:45:00.000Z', deleted_at: null },
    ]
    const store = useWorkoutStore()
    await store.init('user-1')
    const ex = store.exercises.find(e => e.id === 'ex-1')!
    expect(ex.isDuration).toBe(true)
    expect(ex.sets[0].duration).toBe(90)
  })
})
