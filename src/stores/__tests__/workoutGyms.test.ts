/**
 * #961 — gym membership on exercises, at the store + sync boundary.
 *
 * Pins the contract for `Exercise.gyms`:
 *   - setExerciseGyms sanitizes, clears via [], sample-adopts, bumps updated_at
 *   - renameGymOnExercises / removeGymFromExercises rewrite membership across
 *     the list (removeGymFromExercises returns affected ids for undo)
 *   - the exercise upsert row ALWAYS carries `gyms` ([] when unset) so a
 *     cleared membership propagates to the server
 *   - load() sanitizes corrupt persisted membership
 *   - the fetch mapping surfaces exercises.gyms and drops empty arrays
 *   - deduplicateByName unions gym membership like tags
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

// Configurable remote dataset for the fetch-mapping tests.
let mockExercises: Record<string, unknown>[] = []
let mockSets: Record<string, unknown>[] = []

vi.mock('../../lib/supabase', () => {
  function resolvingChain(getData: () => Record<string, unknown>[]): Record<string, unknown> {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      order: () => chain,
      // Collection reads page through .range() (#1152); the fixtures here are
      // far under one page, so a single windowed request returns everything.
      range: () => chain,
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

import { useWorkoutStore, deduplicateByName } from '../workout'
import type { Exercise } from '../workout'
import { syncQueue } from '../../lib/syncQueue'

const NOW = '2026-07-16T14:30:00.000Z'

/** The most recent journaled exercise-upsert descriptor row for a given id. */
function exerciseUpsertRow(exerciseId: string): Record<string, unknown> | undefined {
  const enqueue = syncQueue.enqueue as unknown as { mock: { calls: unknown[][] } }
  let row: Record<string, unknown> | undefined
  for (const call of enqueue.mock.calls) {
    const descriptor = call[2] as { table?: string; row?: Record<string, unknown> } | undefined
    if (descriptor?.table === 'exercises' && descriptor.row?.id === exerciseId) row = descriptor.row
  }
  return row
}

describe('#961 exercise gym membership', () => {
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

  // #984 — gym membership assigned AT creation, not only after the fact.
  describe('addExercise({ gyms })', () => {
    it('seeds sanitized membership on the new exercise', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Hack Squat', [], { gyms: [' Gym A ', 'Gym A', 'Gym B'] })!
      expect(store.exercises.find(e => e.id === id)!.gyms).toEqual(['Gym A', 'Gym B'])
    })

    it('omits the field entirely when no gyms are given (unassigned = everywhere)', () => {
      const store = useWorkoutStore()
      store.addExercise('Bench')
      expect('gyms' in store.exercises[0]).toBe(false)
    })

    it('omits the field when every entry sanitizes away', () => {
      const store = useWorkoutStore()
      store.addExercise('Bench', [], { gyms: ['', '   '] })
      expect('gyms' in store.exercises[0]).toBe(false)
    })

    it('persists membership to localStorage in the same write', () => {
      const store = useWorkoutStore()
      store.addExercise('Bench', [], { gyms: ['Gym A'] })
      const persisted = JSON.parse(localStorageMock.getItem('workout-exercises')!)
      expect(persisted[0].gyms).toEqual(['Gym A'])
    })

    it('carries membership on the very first upsert (no setExerciseGyms round-trip)', async () => {
      const store = useWorkoutStore()
      await store.init('user-1')
      const id = store.addExercise('Hack Squat', [], { gyms: ['Gym A'] })!
      expect(exerciseUpsertRow(id)!.gyms).toEqual(['Gym A'])
    })

    it('does NOT rewrite gyms when the name collides with an existing exercise', () => {
      // Typing an existing name returns that exercise untouched — same rule as
      // `tags`. Silently rewriting membership here would be destructive.
      const store = useWorkoutStore()
      const first = store.addExercise('Bench', [], { gyms: ['Gym A'] })!
      const second = store.addExercise('bench', [], { gyms: ['Gym B'] })
      expect(second).toBe(first)
      expect(store.exercises).toHaveLength(1)
      expect(store.exercises[0].gyms).toEqual(['Gym A'])
    })
  })

  describe('setExerciseGyms', () => {
    it('stores sanitized membership and persists it to localStorage', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Hack Squat (PF)')!
      store.setExerciseGyms(id, [' Gym A ', 'Gym A', 'Gym B'])

      expect(store.exercises[0].gyms).toEqual(['Gym A', 'Gym B'])
      const persisted = JSON.parse(localStorageMock.getItem('workout-exercises')!)
      expect(persisted[0].gyms).toEqual(['Gym A', 'Gym B'])
    })

    it('bumps updated_at so the change wins last-write-wins merges', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench')!
      vi.setSystemTime(new Date('2026-07-16T15:00:00.000Z'))
      store.setExerciseGyms(id, ['Gym A'])
      expect(store.exercises[0].updated_at).toBe('2026-07-16T15:00:00.000Z')
    })

    it('clears the field entirely when passed [] (unassigned = everywhere)', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench')!
      store.setExerciseGyms(id, ['Gym A'])
      store.setExerciseGyms(id, [])
      expect('gyms' in store.exercises[0]).toBe(false)
    })

    it('clears the field when every entry sanitizes away', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench')!
      store.setExerciseGyms(id, ['Gym A'])
      store.setExerciseGyms(id, ['', '   '])
      expect('gyms' in store.exercises[0]).toBe(false)
    })

    it('adopts a sample exercise (real user action makes it syncable)', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Sample', [], { sync: false })!
      expect(store.exercises[0].sample).toBe(true)
      store.setExerciseGyms(id, ['Gym A'])
      expect(store.exercises[0].sample).toBeUndefined()
    })

    it('is a no-op for an unknown exercise id', () => {
      const store = useWorkoutStore()
      expect(() => store.setExerciseGyms('nope', ['Gym A'])).not.toThrow()
    })
  })

  describe('upsert payload (always-send rule)', () => {
    it('carries the membership on the upsert row', async () => {
      const store = useWorkoutStore()
      await store.init('user-1')
      const id = store.addExercise('Leg Press')!
      store.setExerciseGyms(id, ['Gym B'])

      const row = exerciseUpsertRow(id)
      expect(row).toBeDefined()
      expect(row!.gyms).toEqual(['Gym B'])
    })

    it('sends gyms: [] when unset so clearing propagates server-side', async () => {
      const store = useWorkoutStore()
      await store.init('user-1')
      const id = store.addExercise('Leg Press')!
      store.setExerciseGyms(id, ['Gym B'])
      store.setExerciseGyms(id, [])

      const row = exerciseUpsertRow(id)
      expect(row).toBeDefined()
      expect(row!.gyms).toEqual([])
    })
  })

  describe('renameGymOnExercises', () => {
    it('rewrites the renamed gym across every exercise carrying it', () => {
      const store = useWorkoutStore()
      const a = store.addExercise('Hack Squat')!
      const b = store.addExercise('Leg Press')!
      const c = store.addExercise('Bench')!
      store.setExerciseGyms(a, ['Old Gym'])
      store.setExerciseGyms(b, ['Old Gym', 'Gym B'])
      store.setExerciseGyms(c, ['Gym B'])

      store.renameGymOnExercises('Old Gym', 'New Gym')

      expect(store.exercises.find(e => e.id === a)!.gyms).toEqual(['New Gym'])
      expect(store.exercises.find(e => e.id === b)!.gyms).toEqual(['New Gym', 'Gym B'])
      expect(store.exercises.find(e => e.id === c)!.gyms).toEqual(['Gym B'])
    })

    it('drops the old entry instead of duplicating when the target is already present', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Row')!
      store.setExerciseGyms(id, ['Old Gym', 'New Gym'])
      store.renameGymOnExercises('Old Gym', 'New Gym')
      expect(store.exercises[0].gyms).toEqual(['New Gym'])
    })

    it('is a no-op for an empty or identical new name', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Row')!
      store.setExerciseGyms(id, ['Gym A'])
      store.renameGymOnExercises('Gym A', '  ')
      store.renameGymOnExercises('Gym A', 'Gym A')
      expect(store.exercises[0].gyms).toEqual(['Gym A'])
    })

    it('enqueues an upsert for each rewritten exercise', async () => {
      const store = useWorkoutStore()
      await store.init('user-1')
      const id = store.addExercise('Hack Squat')!
      store.setExerciseGyms(id, ['Old Gym'])
      store.renameGymOnExercises('Old Gym', 'New Gym')

      const row = exerciseUpsertRow(id)
      expect(row!.gyms).toEqual(['New Gym'])
    })
  })

  describe('removeGymFromExercises', () => {
    it('strips the gym everywhere and returns the affected ids for undo', () => {
      const store = useWorkoutStore()
      const a = store.addExercise('Hack Squat')!
      const b = store.addExercise('Leg Press')!
      const c = store.addExercise('Bench')!
      store.setExerciseGyms(a, ['Doomed Gym'])
      store.setExerciseGyms(b, ['Doomed Gym', 'Gym B'])
      store.setExerciseGyms(c, ['Gym B'])

      const affected = store.removeGymFromExercises('Doomed Gym')

      expect(affected.sort()).toEqual([a, b].sort())
      expect('gyms' in store.exercises.find(e => e.id === a)!).toBe(false)
      expect(store.exercises.find(e => e.id === b)!.gyms).toEqual(['Gym B'])
      expect(store.exercises.find(e => e.id === c)!.gyms).toEqual(['Gym B'])
    })

    it('returns [] when nothing carried the gym', () => {
      const store = useWorkoutStore()
      store.addExercise('Bench')
      expect(store.removeGymFromExercises('Nowhere')).toEqual([])
    })
  })

  describe('load() sanitization', () => {
    it('sanitizes corrupt persisted membership and drops empty results', () => {
      localStorageMock.setItem('workout-exercises', JSON.stringify([
        { id: 'e1', name: 'Bench', tags: [], sets: [], gyms: 'Gym A' },
        { id: 'e2', name: 'Squat', tags: [], sets: [], gyms: ['', 42] },
        { id: 'e3', name: 'Row', tags: [], sets: [], gyms: [' Gym A ', 'Gym A', 'Gym B'] },
      ]))
      setActivePinia(createPinia())
      const store = useWorkoutStore()
      expect('gyms' in store.exercises[0]).toBe(false)
      expect('gyms' in store.exercises[1]).toBe(false)
      expect(store.exercises[2].gyms).toEqual(['Gym A', 'Gym B'])
    })
  })

  describe('fetch mapping', () => {
    it('surfaces exercises.gyms from the fetch and drops empty arrays', async () => {
      mockExercises = [
        {
          id: 'ex-1', name: 'Hack Squat (PF)', tags: [],
          created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z',
          deleted_at: null, gyms: ['Gym A'],
        },
        {
          id: 'ex-2', name: 'Bench Press', tags: [],
          created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z',
          deleted_at: null, gyms: [],
        },
      ]

      const store = useWorkoutStore()
      await store.init('user-1')

      expect(store.exercises.find(e => e.id === 'ex-1')!.gyms).toEqual(['Gym A'])
      expect('gyms' in store.exercises.find(e => e.id === 'ex-2')!).toBe(false)
    })
  })

  describe('deduplicateByName gym union', () => {
    function makeExercise(id: string, name: string, gyms?: string[]): Exercise {
      return { id, name, tags: [], sets: [], ...(gyms ? { gyms } : {}) }
    }

    it('unions gym membership when same-named duplicates merge', () => {
      const { exercises } = deduplicateByName([
        makeExercise('e1', 'Hack Squat', ['Gym A']),
        makeExercise('e2', 'hack squat', ['Gym B']),
      ])
      expect(exercises).toHaveLength(1)
      expect([...exercises[0].gyms!].sort()).toEqual(['Gym A', 'Gym B'])
    })

    it('leaves unassigned exercises unassigned when no duplicate carries gyms', () => {
      const { exercises } = deduplicateByName([
        makeExercise('e1', 'Bench'),
        makeExercise('e2', 'bench'),
      ])
      expect(exercises).toHaveLength(1)
      expect('gyms' in exercises[0]).toBe(false)
    })
  })
})
