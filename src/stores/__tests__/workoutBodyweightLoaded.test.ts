import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

vi.mock('../../lib/syncQueue', () => ({
  syncQueue: { enqueue: vi.fn(), enqueueDelete: vi.fn() },
}))
vi.mock('../../lib/conflictResolver', () => ({
  mergeEntities: vi.fn(() => ({ merged: [], localOnly: [] })),
}))

import { useWorkoutStore } from '../workout'
import { useBodyweightStore } from '../bodyweight'
import { epley } from '../../lib/epley'

describe('workout store — bodyweight-loaded exercises (LIFT-834)', () => {
  beforeEach(() => {
    localStorageMock.clear()
    setActivePinia(createPinia())
  })

  it('folds current bodyweight into a logged set for a flagged exercise', () => {
    useBodyweightStore().addEntry(160)
    const store = useWorkoutStore()
    const id = store.addExercise('Weighted Pull-up')!
    store.setExerciseBodyweightLoaded(id, true)
    store.logSet(id, 25, 8)
    const set = store.exercises[0].sets[0]
    expect(set.bodyweight).toBe(160)
    // e1RM anchors on the effective 185 lb load, not the bare +25.
    expect(set.estimated1RM).toBe(epley(185, 8))
  })

  it('credits pure-bodyweight reps (added = 0) with a real e1RM', () => {
    useBodyweightStore().addEntry(170)
    const store = useWorkoutStore()
    const id = store.addExercise('Pull-up')!
    store.setExerciseBodyweightLoaded(id, true)
    store.logSet(id, 0, 10)
    const set = store.exercises[0].sets[0]
    expect(set.estimated1RM).toBe(epley(170, 10))
    expect(set.estimated1RM).toBeGreaterThan(0)
  })

  it('does not fold bodyweight for a normal (unflagged) exercise', () => {
    useBodyweightStore().addEntry(160)
    const store = useWorkoutStore()
    const id = store.addExercise('Bench')!
    store.logSet(id, 200, 5)
    const set = store.exercises[0].sets[0]
    expect(set.bodyweight).toBeUndefined()
    expect(set.estimated1RM).toBe(epley(200, 5))
  })

  it('logs without a captured bodyweight when none is tracked, folding in nothing', () => {
    const store = useWorkoutStore()
    const id = store.addExercise('Dip')!
    store.setExerciseBodyweightLoaded(id, true)
    store.logSet(id, 45, 6)
    const set = store.exercises[0].sets[0]
    expect(set.bodyweight).toBeUndefined()
    expect(set.estimated1RM).toBe(epley(45, 6))
  })

  it('recomputes existing sets when the flag is toggled on, then reverts on toggle off', () => {
    useBodyweightStore().addEntry(150)
    const store = useWorkoutStore()
    const id = store.addExercise('Chin-up')!
    store.logSet(id, 20, 5) // logged before the flag
    expect(store.exercises[0].sets[0].estimated1RM).toBe(epley(20, 5))

    store.setExerciseBodyweightLoaded(id, true)
    const set = store.exercises[0].sets[0]
    expect(set.bodyweight).toBe(150)
    expect(set.estimated1RM).toBe(epley(170, 5))

    store.setExerciseBodyweightLoaded(id, false)
    expect(store.exercises[0].bodyweightLoaded).toBeUndefined()
    expect(store.exercises[0].sets[0].estimated1RM).toBe(epley(20, 5))
    // Captured bodyweight is kept so re-enabling restores the same values.
    expect(store.exercises[0].sets[0].bodyweight).toBe(150)
  })

  it('updateSet preserves the bodyweight captured at log time', () => {
    useBodyweightStore().addEntry(160)
    const store = useWorkoutStore()
    const id = store.addExercise('Weighted Dip')!
    store.setExerciseBodyweightLoaded(id, true)
    store.logSet(id, 25, 8)
    const setId = store.exercises[0].sets[0].id

    // Bodyweight changes later; editing the set must keep the original capture.
    useBodyweightStore().addEntry(175)
    store.updateSet(id, setId, 35, 6)
    const set = store.exercises[0].sets[0]
    expect(set.bodyweight).toBe(160)
    expect(set.estimated1RM).toBe(epley(195, 6))
  })
})
