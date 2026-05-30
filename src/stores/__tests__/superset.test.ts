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

/** Convenience: seed N named exercises and return their ids. */
function seed(store: ReturnType<typeof useWorkoutStore>, ...names: string[]): string[] {
  return names.map(n => store.addExercise(n)!)
}

describe('workout store — supersets', () => {
  beforeEach(() => {
    localStorageMock.clear()
    setActivePinia(createPinia())
  })

  describe('setSupersetMembers', () => {
    it('groups two exercises under a shared groupId', () => {
      const store = useWorkoutStore()
      const [a, b] = seed(store, 'Bench', 'Row')
      store.setSupersetMembers(a, [b])
      const exA = store.exercises.find(e => e.id === a)!
      const exB = store.exercises.find(e => e.id === b)!
      expect(exA.groupId).toBeTruthy()
      expect(exA.groupId).toBe(exB.groupId)
    })

    it('does not create a group of one (no partners)', () => {
      const store = useWorkoutStore()
      const [a] = seed(store, 'Bench')
      store.setSupersetMembers(a, [])
      expect(store.exercises[0].groupId).toBeUndefined()
    })

    it('ignores invalid and self partner ids', () => {
      const store = useWorkoutStore()
      const [a] = seed(store, 'Bench')
      store.setSupersetMembers(a, [a, 'does-not-exist'])
      expect(store.exercises[0].groupId).toBeUndefined()
    })

    it('supports a tri-set (three members in one group)', () => {
      const store = useWorkoutStore()
      const [a, b, c] = seed(store, 'Bench', 'Row', 'Curl')
      store.setSupersetMembers(a, [b, c])
      const ids = new Set([a, b, c].map(id => store.exercises.find(e => e.id === id)!.groupId))
      expect(ids.size).toBe(1)
      expect([...ids][0]).toBeTruthy()
    })

    it('reuses the existing groupId when editing membership', () => {
      const store = useWorkoutStore()
      const [a, b, c] = seed(store, 'Bench', 'Row', 'Curl')
      store.setSupersetMembers(a, [b])
      const original = store.exercises.find(e => e.id === a)!.groupId
      store.setSupersetMembers(a, [b, c])
      expect(store.exercises.find(e => e.id === a)!.groupId).toBe(original)
      expect(store.exercises.find(e => e.id === c)!.groupId).toBe(original)
    })

    it('dissolves the group when membership drops below two', () => {
      const store = useWorkoutStore()
      const [a, b] = seed(store, 'Bench', 'Row')
      store.setSupersetMembers(a, [b])
      // Remove the only partner → both should be ungrouped.
      store.setSupersetMembers(a, [])
      expect(store.exercises.find(e => e.id === a)!.groupId).toBeUndefined()
      expect(store.exercises.find(e => e.id === b)!.groupId).toBeUndefined()
    })

    it('drops a deselected member and dissolves the leftover singleton', () => {
      const store = useWorkoutStore()
      const [a, b, c] = seed(store, 'Bench', 'Row', 'Curl')
      store.setSupersetMembers(a, [b, c])
      // Re-pair A with only B; C is dropped. Now A+B remain grouped.
      store.setSupersetMembers(a, [b])
      const exA = store.exercises.find(e => e.id === a)!
      const exB = store.exercises.find(e => e.id === b)!
      const exC = store.exercises.find(e => e.id === c)!
      expect(exA.groupId).toBeTruthy()
      expect(exB.groupId).toBe(exA.groupId)
      expect(exC.groupId).toBeUndefined()
    })

    it('pulls a partner out of its prior group, dissolving it if orphaned', () => {
      const store = useWorkoutStore()
      const [a, b, c, d] = seed(store, 'Bench', 'Row', 'Curl', 'Squat')
      store.setSupersetMembers(a, [b]) // group 1: A,B
      store.setSupersetMembers(c, [d]) // group 2: C,D
      // Now pair C with A — C leaves group 2, which orphans D.
      store.setSupersetMembers(a, [b, c])
      const g = store.exercises.find(e => e.id === a)!.groupId
      expect(store.exercises.find(e => e.id === c)!.groupId).toBe(g)
      expect(store.exercises.find(e => e.id === b)!.groupId).toBe(g)
      expect(store.exercises.find(e => e.id === d)!.groupId).toBeUndefined()
    })

    it('persists grouping to localStorage', () => {
      const store = useWorkoutStore()
      const [a, b] = seed(store, 'Bench', 'Row')
      store.setSupersetMembers(a, [b])
      const saved = JSON.parse(localStorageMock.getItem('workout-exercises')!)
      const groupIds = saved.map((e: { groupId?: string }) => e.groupId)
      expect(groupIds[0]).toBeTruthy()
      expect(groupIds[0]).toBe(groupIds[1])
    })

    it('does nothing for a non-existent exercise', () => {
      const store = useWorkoutStore()
      const [a] = seed(store, 'Bench')
      expect(() => store.setSupersetMembers('nope', [a])).not.toThrow()
      expect(store.exercises[0].groupId).toBeUndefined()
    })
  })

  describe('removeFromSuperset', () => {
    it('removes an exercise and dissolves the orphaned partner', () => {
      const store = useWorkoutStore()
      const [a, b] = seed(store, 'Bench', 'Row')
      store.setSupersetMembers(a, [b])
      store.removeFromSuperset(a)
      expect(store.exercises.find(e => e.id === a)!.groupId).toBeUndefined()
      expect(store.exercises.find(e => e.id === b)!.groupId).toBeUndefined()
    })

    it('keeps a 3-member group intact when one leaves', () => {
      const store = useWorkoutStore()
      const [a, b, c] = seed(store, 'Bench', 'Row', 'Curl')
      store.setSupersetMembers(a, [b, c])
      store.removeFromSuperset(a)
      const exB = store.exercises.find(e => e.id === b)!
      const exC = store.exercises.find(e => e.id === c)!
      expect(store.exercises.find(e => e.id === a)!.groupId).toBeUndefined()
      expect(exB.groupId).toBeTruthy()
      expect(exB.groupId).toBe(exC.groupId)
    })

    it('is a no-op for an ungrouped exercise', () => {
      const store = useWorkoutStore()
      const [a] = seed(store, 'Bench')
      expect(() => store.removeFromSuperset(a)).not.toThrow()
      expect(store.exercises[0].groupId).toBeUndefined()
    })
  })

  describe('supersets getter', () => {
    it('returns groups with 2+ active members and stable labels', () => {
      const store = useWorkoutStore()
      const [a, b, c, d] = seed(store, 'Bench', 'Row', 'Curl', 'Squat')
      store.setSupersetMembers(a, [b])
      store.setSupersetMembers(c, [d])
      const groups = store.supersets
      expect(groups).toHaveLength(2)
      expect(groups[0].label).toBe('A')
      expect(groups[1].label).toBe('B')
      expect(groups[0].exerciseIds).toEqual([a, b])
    })

    it('excludes archived exercises from group membership', () => {
      const store = useWorkoutStore()
      const [a, b] = seed(store, 'Bench', 'Row')
      store.setSupersetMembers(a, [b])
      store.archiveExercise(b)
      // Group now has a single active member → not surfaced.
      expect(store.supersets).toHaveLength(0)
    })

    it('returns an empty array when nothing is grouped', () => {
      const store = useWorkoutStore()
      seed(store, 'Bench', 'Row')
      expect(store.supersets).toEqual([])
    })
  })
})
