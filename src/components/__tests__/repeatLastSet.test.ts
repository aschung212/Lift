import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, val: string) => { store[key] = String(val) }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
  }
})()
vi.stubGlobal('localStorage', localStorageMock)

vi.mock('../../lib/supabase', () => ({ supabase: null }))
vi.mock('../../lib/syncQueue', () => ({
  syncQueue: { enqueue: vi.fn() }
}))
vi.mock('../../lib/conflictResolver', () => ({
  mergeEntities: vi.fn(() => ({ merged: [], localOnly: [] }))
}))

import { useWorkoutStore } from '../../stores/workout'

/**
 * Tests for the "repeat last set" feature (MAS-358).
 *
 * The feature relies on store.getRecentSets(id, 1) to retrieve the most
 * recent set, then pre-fills the weight and reps inputs. These tests
 * verify the store getter returns the correct set in various scenarios.
 */
describe('repeat last set (MAS-358)', () => {
  beforeEach(() => {
    localStorageMock.clear()
    setActivePinia(createPinia())
  })

  it('returns the most recent set for an exercise', () => {
    const store = useWorkoutStore()
    const id = store.addExercise('Bench Press')!
    store.logSet(id, 135, 10, '2026-03-01')
    store.logSet(id, 155, 8, '2026-03-02')
    store.logSet(id, 175, 5, '2026-03-03')

    const recent = store.getRecentSets(id, 1)
    expect(recent).toHaveLength(1)
    expect(recent[0].weight).toBe(175)
    expect(recent[0].reps).toBe(5)
  })

  it('returns empty array for exercise with no sets', () => {
    const store = useWorkoutStore()
    const id = store.addExercise('Squat')!

    const recent = store.getRecentSets(id, 1)
    expect(recent).toHaveLength(0)
  })

  it('returns empty array for non-existent exercise', () => {
    const store = useWorkoutStore()
    const recent = store.getRecentSets('non-existent', 1)
    expect(recent).toEqual([])
  })

  it('returns the last logged set, not the highest weight', () => {
    const store = useWorkoutStore()
    const id = store.addExercise('Deadlift')!
    // Log heavy set first, then lighter set after
    store.logSet(id, 315, 3, '2026-03-01')
    store.logSet(id, 225, 10, '2026-03-02')

    const recent = store.getRecentSets(id, 1)
    expect(recent).toHaveLength(1)
    // Should return the last logged set (225×10), not the heaviest (315×3)
    expect(recent[0].weight).toBe(225)
    expect(recent[0].reps).toBe(10)
  })

  it('does not return sets from a different exercise', () => {
    const store = useWorkoutStore()
    const benchId = store.addExercise('Bench Press')!
    const squatId = store.addExercise('Squat')!
    store.logSet(benchId, 185, 5, '2026-03-01')
    store.logSet(squatId, 275, 5, '2026-03-01')

    const benchRecent = store.getRecentSets(benchId, 1)
    expect(benchRecent[0].weight).toBe(185)

    const squatRecent = store.getRecentSets(squatId, 1)
    expect(squatRecent[0].weight).toBe(275)
  })

  it('updates after a new set is logged', () => {
    const store = useWorkoutStore()
    const id = store.addExercise('OHP')!
    store.logSet(id, 95, 8, '2026-03-01')

    let recent = store.getRecentSets(id, 1)
    expect(recent[0].weight).toBe(95)
    expect(recent[0].reps).toBe(8)

    // Log another set
    store.logSet(id, 105, 6, '2026-03-02')
    recent = store.getRecentSets(id, 1)
    expect(recent[0].weight).toBe(105)
    expect(recent[0].reps).toBe(6)
  })
})
