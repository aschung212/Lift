import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

vi.mock('../../lib/syncQueue', () => ({
  syncQueue: { enqueue: vi.fn(), enqueueDelete: vi.fn() }
}))
vi.mock('../../lib/conflictResolver', () => ({
  mergeEntities: vi.fn(() => ({ merged: [], localOnly: [] }))
}))

import { useWorkoutStore } from '../workout'
import { useBodyweightStore } from '../bodyweight'
import { epley } from '../../lib/epley'

describe('workout store — bodyweight-loaded mode (LIFT-834)', () => {
  beforeEach(() => {
    localStorageMock.clear()
    setActivePinia(createPinia())
  })

  it('logs a standard exercise with plain Epley e1RM', () => {
    const store = useWorkoutStore()
    const id = store.addExercise('Bench Press')!
    store.logSet(id, 135, 5)
    expect(store.exercises[0].sets[0].estimated1RM).toBe(epley(135, 5))
  })

  it('folds current bodyweight into e1RM when the exercise is bodyweight-loaded', () => {
    const bw = useBodyweightStore()
    bw.addEntry(180, undefined, { sync: false })
    const store = useWorkoutStore()
    const id = store.addExercise('Pull-up')!
    store.setExerciseBodyweightLoaded(id, true)

    store.logSet(id, 25, 5)
    // 25 lb added + 180 lb bodyweight = 205 lb effective load
    expect(store.exercises[0].sets[0].estimated1RM).toBe(epley(205, 5))
    // the entered weight is preserved as the external load
    expect(store.exercises[0].sets[0].weight).toBe(25)
  })

  it('credits a pure-bodyweight rep (0 added) instead of estimating 0', () => {
    const bw = useBodyweightStore()
    bw.addEntry(170, undefined, { sync: false })
    const store = useWorkoutStore()
    const id = store.addExercise('Dip')!
    store.setExerciseBodyweightLoaded(id, true)

    store.logSet(id, 0, 8)
    expect(store.exercises[0].sets[0].estimated1RM).toBe(epley(170, 8))
    expect(store.exercises[0].sets[0].estimated1RM).toBeGreaterThan(0)
  })

  it('does not fold when no bodyweight has been logged', () => {
    const store = useWorkoutStore()
    const id = store.addExercise('Pull-up')!
    store.setExerciseBodyweightLoaded(id, true)

    store.logSet(id, 25, 5)
    expect(store.exercises[0].sets[0].estimated1RM).toBe(epley(25, 5))
  })

  it('re-folds bodyweight on set edit via updateSet', () => {
    const bw = useBodyweightStore()
    bw.addEntry(200, undefined, { sync: false })
    const store = useWorkoutStore()
    const id = store.addExercise('Weighted Chin')!
    store.setExerciseBodyweightLoaded(id, true)
    store.logSet(id, 10, 5)
    const setId = store.exercises[0].sets[0].id

    store.updateSet(id, setId, 45, 3)
    expect(store.exercises[0].sets[0].estimated1RM).toBe(epley(245, 3))
  })

  it('setExerciseBodyweightLoaded toggles and clears the flag', () => {
    const store = useWorkoutStore()
    const id = store.addExercise('Pull-up')!
    expect(store.exercises[0].bodyweightLoaded).toBeUndefined()

    store.setExerciseBodyweightLoaded(id, true)
    expect(store.exercises[0].bodyweightLoaded).toBe(true)

    store.setExerciseBodyweightLoaded(id, false)
    expect(store.exercises[0].bodyweightLoaded).toBeUndefined()
  })

  it('reverts to plain Epley after the flag is turned off', () => {
    const bw = useBodyweightStore()
    bw.addEntry(180, undefined, { sync: false })
    const store = useWorkoutStore()
    const id = store.addExercise('Pull-up')!
    store.setExerciseBodyweightLoaded(id, true)
    store.setExerciseBodyweightLoaded(id, false)

    store.logSet(id, 25, 5)
    expect(store.exercises[0].sets[0].estimated1RM).toBe(epley(25, 5))
  })
})
