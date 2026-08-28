/**
 * Integration test: the workout store hydrates its secondary state
 * defensively, on a real Pinia instance.
 *
 * Regression for #822: customTags, tagRecoveryDays, and tagRecoveryExcluded
 * are hydrated inline in the store's setup-function body. If any of those keys
 * holds corrupt JSON (truncated write, quota eviction mid-write, manual
 * tampering), a raw JSON.parse would throw DURING store construction — which,
 * because it happens in the setup body, fails to construct the store at all and
 * takes down the entire workout feature rather than degrading to defaults.
 *
 * These tests pin the guarded-hydration contract (loadJSON: try/catch parse +
 * shape validation) so a future persistence refactor (#819) cannot silently
 * regress it back to an unguarded parse.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

vi.mock('../../lib/supabase', () => ({
  supabase: null,
  isPreviewMode: { value: false },
}))
vi.mock('../../lib/syncQueue', () => ({
  syncQueue: { enqueue: vi.fn(), enqueueDelete: vi.fn(), clear: vi.fn() },
}))
vi.mock('../../lib/durableStorage', () => ({
  backupToIDB: vi.fn(),
}))

describe('workout store secondary-state hydration (real Pinia)', () => {
  beforeEach(() => {
    localStorageMock.clear()
    setActivePinia(createPinia())
  })

  it('constructs with empty defaults when lift-custom-tags is unparseable', async () => {
    localStorageMock.setItem('lift-custom-tags', '{not json')

    const { useWorkoutStore } = await import('../workout')
    let store!: ReturnType<typeof useWorkoutStore>
    expect(() => { store = useWorkoutStore() }).not.toThrow()
    expect(store.customTags).toEqual([])
  })

  it('constructs with empty defaults when all three secondary keys are corrupt', async () => {
    localStorageMock.setItem('lift-custom-tags', '{not json')
    localStorageMock.setItem('lift-tag-recovery-days', 'undefined')
    localStorageMock.setItem('lift-tag-recovery-excluded', '[1, 2,')

    const { useWorkoutStore } = await import('../workout')
    let store!: ReturnType<typeof useWorkoutStore>
    expect(() => { store = useWorkoutStore() }).not.toThrow()
    expect(store.customTags).toEqual([])
    expect(store.tagRecoveryDays).toEqual({})
    expect(store.tagRecoveryExcluded).toEqual([])
  })

  it('falls back to defaults when a key parses but has the wrong shape', async () => {
    // Valid JSON, but the wrong type — validators must reject these.
    localStorageMock.setItem('lift-custom-tags', JSON.stringify('Push')) // string, not array
    localStorageMock.setItem('lift-tag-recovery-days', JSON.stringify(['Push'])) // array, not object
    localStorageMock.setItem('lift-tag-recovery-excluded', JSON.stringify({ Push: true })) // object, not array

    const { useWorkoutStore } = await import('../workout')
    const store = useWorkoutStore()
    expect(store.customTags).toEqual([])
    expect(store.tagRecoveryDays).toEqual({})
    expect(store.tagRecoveryExcluded).toEqual([])
  })

  it('hydrates valid secondary state without dropping it', async () => {
    localStorageMock.setItem('lift-custom-tags', JSON.stringify(['Push', 'Pull']))
    localStorageMock.setItem('lift-tag-recovery-days', JSON.stringify({ Push: 3 }))
    localStorageMock.setItem('lift-tag-recovery-excluded', JSON.stringify(['Legs']))

    const { useWorkoutStore } = await import('../workout')
    const store = useWorkoutStore()
    expect(store.customTags).toEqual(['Push', 'Pull'])
    expect(store.tagRecoveryDays).toEqual({ Push: 3 })
    expect(store.tagRecoveryExcluded).toEqual(['Legs'])
  })

  it('drops malformed exercises and sets from corrupt primary storage (LIFT-946)', async () => {
    localStorageMock.setItem('workout-exercises', JSON.stringify([
      {
        id: 'ex-1',
        name: 'Bench Press',
        tags: ['Push', 7], // stray non-string tag → dropped
        sets: [
          { id: 's-1', date: '2026-05-01', weight: 185, reps: 5, estimated1RM: 216 },
          { id: 's-2', date: '2026-05-01', reps: 5 }, // missing weight → dropped
        ],
      },
      { id: 'ex-2' }, // missing name → whole exercise dropped
      'not-an-exercise', // dropped
    ]))

    const { useWorkoutStore } = await import('../workout')
    const store = useWorkoutStore()

    expect(store.exercises).toHaveLength(1)
    expect(store.exercises[0].name).toBe('Bench Press')
    expect(store.exercises[0].tags).toEqual(['Push'])
    expect(store.exercises[0].sets).toHaveLength(1)
    expect(store.exercises[0].sets[0].id).toBe('s-1')
  })

  it('drops non-string tags and non-numeric recovery-day values (LIFT-946)', async () => {
    localStorageMock.setItem('lift-custom-tags', JSON.stringify(['Push', 42, 'Pull']))
    localStorageMock.setItem('lift-tag-recovery-days', JSON.stringify({ Push: 3, Pull: '4' }))
    localStorageMock.setItem('lift-tag-recovery-excluded', JSON.stringify(['Legs', null]))

    const { useWorkoutStore } = await import('../workout')
    const store = useWorkoutStore()
    expect(store.customTags).toEqual(['Push', 'Pull'])
    expect(store.tagRecoveryDays).toEqual({ Push: 3 })
    expect(store.tagRecoveryExcluded).toEqual(['Legs'])
  })

  it('_reloadFromStorage keeps current in-memory value on a corrupt key', async () => {
    localStorageMock.setItem('lift-custom-tags', JSON.stringify(['Push']))

    const { useWorkoutStore } = await import('../workout')
    const store = useWorkoutStore()
    expect(store.customTags).toEqual(['Push'])

    // Simulate a corrupt write landing after construction (e.g. a quota-evicted
    // partial write seen by the cross-tab reload listener).
    localStorageMock.setItem('lift-custom-tags', '{not json')
    expect(() => store._reloadFromStorage()).not.toThrow()
    // Degrades by keeping the last-good in-memory value, not resetting to [].
    expect(store.customTags).toEqual(['Push'])
  })
})
