/**
 * #619 — durable per-exercise notes, at the pure-sanitizer + store + sync
 * boundary.
 *
 * Pins the contract for `Exercise.notes`:
 *   - sanitizeExerciseNotes trims, length-caps, and collapses empty → undefined
 *   - setExerciseNotes stores the sanitized note, persists it, bumps updated_at,
 *     clears the field when emptied, no-ops when unchanged, and sample-adopts
 *   - the exercise upsert row ALWAYS carries `notes` (null when unset) so an
 *     emptied note propagates to the server
 *   - load() sanitizes corrupt persisted notes
 *   - the fetch mapping surfaces exercises.notes and drops empty/whitespace
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'
import { sanitizeExerciseNotes, MAX_EXERCISE_NOTES_LENGTH } from '../../lib/inputLimits'

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

const NOW = '2026-07-29T14:30:00.000Z'

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

describe('sanitizeExerciseNotes (#619)', () => {
  it('trims surrounding whitespace', () => {
    expect(sanitizeExerciseNotes('  brace hard  ')).toBe('brace hard')
  })

  it('caps at the max length', () => {
    const long = 'a'.repeat(MAX_EXERCISE_NOTES_LENGTH + 50)
    expect(sanitizeExerciseNotes(long)).toHaveLength(MAX_EXERCISE_NOTES_LENGTH)
  })

  it('collapses an empty or whitespace-only note to undefined', () => {
    expect(sanitizeExerciseNotes('')).toBeUndefined()
    expect(sanitizeExerciseNotes('   ')).toBeUndefined()
  })

  it('returns undefined for non-string input', () => {
    expect(sanitizeExerciseNotes(undefined)).toBeUndefined()
    expect(sanitizeExerciseNotes(null)).toBeUndefined()
    expect(sanitizeExerciseNotes(42)).toBeUndefined()
    expect(sanitizeExerciseNotes({})).toBeUndefined()
  })
})

describe('#619 exercise notes', () => {
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

  describe('setExerciseNotes', () => {
    it('stores the sanitized note and persists it to localStorage', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Squat')!
      store.setExerciseNotes(id, '  brace before unrack  ')

      expect(store.exercises[0].notes).toBe('brace before unrack')
      const persisted = JSON.parse(localStorageMock.getItem('workout-exercises')!)
      expect(persisted[0].notes).toBe('brace before unrack')
    })

    it('bumps updated_at so the change wins last-write-wins merges', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench')!
      vi.setSystemTime(new Date('2026-07-29T15:00:00.000Z'))
      store.setExerciseNotes(id, 'tuck elbows')
      expect(store.exercises[0].updated_at).toBe('2026-07-29T15:00:00.000Z')
    })

    it('clears the field entirely when passed an empty string', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench')!
      store.setExerciseNotes(id, 'tuck elbows')
      store.setExerciseNotes(id, '')
      expect('notes' in store.exercises[0]).toBe(false)
    })

    it('clears the field when the note is only whitespace', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench')!
      store.setExerciseNotes(id, 'tuck elbows')
      store.setExerciseNotes(id, '   ')
      expect('notes' in store.exercises[0]).toBe(false)
    })

    it('is a no-op (no updated_at bump) when the note is unchanged', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench')!
      store.setExerciseNotes(id, 'cue')
      const stamp = store.exercises[0].updated_at
      vi.setSystemTime(new Date('2026-07-29T16:00:00.000Z'))
      store.setExerciseNotes(id, '  cue  ') // sanitizes to the same value
      expect(store.exercises[0].updated_at).toBe(stamp)
    })

    it('adopts a sample exercise (real user action makes it syncable)', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Sample', [], { sync: false })!
      expect(store.exercises[0].sample).toBe(true)
      store.setExerciseNotes(id, 'a cue')
      expect(store.exercises[0].sample).toBeUndefined()
    })

    it('is a no-op for an unknown exercise id', () => {
      const store = useWorkoutStore()
      expect(() => store.setExerciseNotes('nope', 'x')).not.toThrow()
    })
  })

  describe('upsert payload (always-send rule)', () => {
    it('carries the note on the upsert row', async () => {
      const store = useWorkoutStore()
      await store.init('user-1')
      const id = store.addExercise('Deadlift')!
      store.setExerciseNotes(id, 'neutral spine')

      const row = exerciseUpsertRow(id)
      expect(row).toBeDefined()
      expect(row!.notes).toBe('neutral spine')
    })

    it('sends notes: null when unset so clearing propagates server-side', async () => {
      const store = useWorkoutStore()
      await store.init('user-1')
      const id = store.addExercise('Deadlift')!
      store.setExerciseNotes(id, 'neutral spine')
      store.setExerciseNotes(id, '')

      const row = exerciseUpsertRow(id)
      expect(row).toBeDefined()
      expect(row!.notes).toBeNull()
    })
  })

  describe('load() sanitization', () => {
    it('trims/caps persisted notes and drops empty ones', () => {
      const long = 'b'.repeat(MAX_EXERCISE_NOTES_LENGTH + 20)
      localStorageMock.setItem('workout-exercises', JSON.stringify([
        { id: 'e1', name: 'Bench', tags: [], sets: [], notes: '  a cue  ' },
        { id: 'e2', name: 'Squat', tags: [], sets: [], notes: '   ' },
        { id: 'e3', name: 'Row', tags: [], sets: [], notes: 42 },
        { id: 'e4', name: 'Curl', tags: [], sets: [], notes: long },
      ]))
      setActivePinia(createPinia())
      const store = useWorkoutStore()
      expect(store.exercises[0].notes).toBe('a cue')
      expect('notes' in store.exercises[1]).toBe(false)
      expect('notes' in store.exercises[2]).toBe(false)
      expect(store.exercises[3].notes).toHaveLength(MAX_EXERCISE_NOTES_LENGTH)
    })
  })

  describe('fetch mapping', () => {
    it('surfaces exercises.notes from the fetch and drops empty/whitespace', async () => {
      mockExercises = [
        {
          id: 'ex-1', name: 'Hack Squat', tags: [],
          created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z',
          deleted_at: null, notes: '  drive knees out  ',
        },
        {
          id: 'ex-2', name: 'Bench Press', tags: [],
          created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z',
          deleted_at: null, notes: '   ',
        },
        {
          id: 'ex-3', name: 'Row', tags: [],
          created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z',
          deleted_at: null, notes: null,
        },
      ]

      const store = useWorkoutStore()
      await store.init('user-1')

      expect(store.exercises.find(e => e.id === 'ex-1')!.notes).toBe('drive knees out')
      expect('notes' in store.exercises.find(e => e.id === 'ex-2')!).toBe(false)
      expect('notes' in store.exercises.find(e => e.id === 'ex-3')!).toBe(false)
    })
  })
})
