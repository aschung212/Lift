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

import { useWorkoutStore } from '../workout'
import type { Exercise } from '../workout'

describe('workout store', () => {
  beforeEach(() => {
    localStorageMock.clear()
    setActivePinia(createPinia())
  })

  // ── addExercise ────────────────────────────────────────────────
  describe('addExercise', () => {
    it('adds a new exercise with name and tags', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench Press', ['Push', 'Chest'])
      expect(id).toBeTruthy()
      expect(store.exercises).toHaveLength(1)
      expect(store.exercises[0].name).toBe('Bench Press')
      expect(store.exercises[0].tags).toEqual(['Push', 'Chest'])
      expect(store.exercises[0].sets).toEqual([])
    })

    it('trims whitespace from name', () => {
      const store = useWorkoutStore()
      store.addExercise('  Squat  ')
      expect(store.exercises[0].name).toBe('Squat')
    })

    it('returns null for empty name', () => {
      const store = useWorkoutStore()
      expect(store.addExercise('')).toBeNull()
      expect(store.addExercise('   ')).toBeNull()
      expect(store.exercises).toHaveLength(0)
    })

    it('returns existing id for duplicate name (case-insensitive)', () => {
      const store = useWorkoutStore()
      const id1 = store.addExercise('Bench Press')
      const id2 = store.addExercise('bench press')
      expect(id1).toBe(id2)
      expect(store.exercises).toHaveLength(1)
    })

    it('persists to localStorage', () => {
      const store = useWorkoutStore()
      store.addExercise('Deadlift')
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'workout-exercises',
        expect.stringContaining('Deadlift')
      )
    })

    it('defaults tags to empty array', () => {
      const store = useWorkoutStore()
      store.addExercise('OHP')
      expect(store.exercises[0].tags).toEqual([])
    })
  })

  // ── logSet ─────────────────────────────────────────────────────
  describe('logSet', () => {
    it('logs a set to an existing exercise', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Squat')!
      store.logSet(id, 225, 5)
      expect(store.exercises[0].sets).toHaveLength(1)
      expect(store.exercises[0].sets[0].weight).toBe(225)
      expect(store.exercises[0].sets[0].reps).toBe(5)
    })

    it('calculates estimated 1RM using Epley formula', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench')!
      store.logSet(id, 200, 5)
      // Epley: 200 * (1 + 5/30) = 200 * 1.1667 ≈ 233
      expect(store.exercises[0].sets[0].estimated1RM).toBe(233)
    })

    it('returns weight as 1RM for single rep', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench')!
      store.logSet(id, 315, 1)
      expect(store.exercises[0].sets[0].estimated1RM).toBe(315)
    })

    it('uses provided date string', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Squat')!
      store.logSet(id, 135, 10, '2026-03-15')
      expect(store.exercises[0].sets[0].date).toContain('2026-03-15')
    })

    it('does nothing for non-existent exercise', () => {
      const store = useWorkoutStore()
      store.logSet('fake-id', 100, 5)
      expect(store.exercises).toHaveLength(0)
    })

    it('logs multiple sets to same exercise', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Squat')!
      store.logSet(id, 135, 10)
      store.logSet(id, 185, 8)
      store.logSet(id, 225, 5)
      expect(store.exercises[0].sets).toHaveLength(3)
    })
  })

  // ── updateSet ──────────────────────────────────────────────────
  describe('updateSet', () => {
    it('updates weight and reps of an existing set', () => {
      const store = useWorkoutStore()
      const exId = store.addExercise('Bench')!
      store.logSet(exId, 135, 10)
      const setId = store.exercises[0].sets[0].id
      store.updateSet(exId, setId, 185, 5)
      expect(store.exercises[0].sets[0].weight).toBe(185)
      expect(store.exercises[0].sets[0].reps).toBe(5)
    })

    it('recalculates 1RM on update', () => {
      const store = useWorkoutStore()
      const exId = store.addExercise('Bench')!
      store.logSet(exId, 135, 10)
      const setId = store.exercises[0].sets[0].id
      store.updateSet(exId, setId, 200, 5)
      expect(store.exercises[0].sets[0].estimated1RM).toBe(233)
    })

    it('updates date when dateStr provided', () => {
      const store = useWorkoutStore()
      const exId = store.addExercise('Bench')!
      store.logSet(exId, 135, 10)
      const setId = store.exercises[0].sets[0].id
      store.updateSet(exId, setId, 135, 10, '2026-01-01')
      expect(store.exercises[0].sets[0].date).toContain('2026-01-01')
    })

    it('does nothing for missing exercise or set', () => {
      const store = useWorkoutStore()
      const exId = store.addExercise('Bench')!
      store.updateSet(exId, 'fake-set', 200, 5)
      store.updateSet('fake-ex', 'fake-set', 200, 5)
      // No crash, no changes
      expect(store.exercises[0].sets).toHaveLength(0)
    })
  })

  // ── deleteSet / restoreSet ─────────────────────────────────────
  describe('deleteSet / restoreSet', () => {
    it('deletes a set by id', () => {
      const store = useWorkoutStore()
      const exId = store.addExercise('Squat')!
      store.logSet(exId, 225, 5)
      store.logSet(exId, 275, 3)
      const setId = store.exercises[0].sets[0].id
      store.deleteSet(exId, setId)
      expect(store.exercises[0].sets).toHaveLength(1)
      expect(store.exercises[0].sets[0].weight).toBe(275)
    })

    it('restores a previously deleted set', () => {
      const store = useWorkoutStore()
      const exId = store.addExercise('Squat')!
      store.logSet(exId, 225, 5)
      const deletedSet = { ...store.exercises[0].sets[0] }
      store.deleteSet(exId, deletedSet.id)
      expect(store.exercises[0].sets).toHaveLength(0)
      store.restoreSet(exId, deletedSet)
      expect(store.exercises[0].sets).toHaveLength(1)
      expect(store.exercises[0].sets[0].weight).toBe(225)
    })
  })

  // ── clearSets / restoreSets ────────────────────────────────────
  describe('clearSets / restoreSets', () => {
    it('clears all sets for an exercise', () => {
      const store = useWorkoutStore()
      const exId = store.addExercise('Bench')!
      store.logSet(exId, 135, 10)
      store.logSet(exId, 185, 5)
      store.clearSets(exId)
      expect(store.exercises[0].sets).toHaveLength(0)
    })

    it('restores cleared sets', () => {
      const store = useWorkoutStore()
      const exId = store.addExercise('Bench')!
      store.logSet(exId, 135, 10)
      store.logSet(exId, 185, 5)
      const savedSets = [...store.exercises[0].sets]
      store.clearSets(exId)
      store.restoreSets(exId, savedSets)
      expect(store.exercises[0].sets).toHaveLength(2)
    })
  })

  // ── renameExercise ─────────────────────────────────────────────
  describe('renameExercise', () => {
    it('renames an exercise', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench Press')!
      store.renameExercise(id, 'Flat Bench')
      expect(store.exercises[0].name).toBe('Flat Bench')
    })

    it('trims the new name', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench')!
      store.renameExercise(id, '  Incline Bench  ')
      expect(store.exercises[0].name).toBe('Incline Bench')
    })

    it('does nothing for empty name', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench')!
      store.renameExercise(id, '')
      expect(store.exercises[0].name).toBe('Bench')
    })

    it('does nothing for non-existent exercise', () => {
      const store = useWorkoutStore()
      store.addExercise('Bench')
      store.renameExercise('fake-id', 'New Name')
      expect(store.exercises[0].name).toBe('Bench')
    })
  })

  // ── updateExerciseTags ─────────────────────────────────────────
  describe('updateExerciseTags', () => {
    it('replaces tags for an exercise', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench', ['Push'])!
      store.updateExerciseTags(id, ['Push', 'Chest', 'Upper'])
      expect(store.exercises[0].tags).toEqual(['Push', 'Chest', 'Upper'])
    })

    it('does not mutate the input array', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench')!
      const tags = ['Push']
      store.updateExerciseTags(id, tags)
      tags.push('Mutated')
      expect(store.exercises[0].tags).toEqual(['Push'])
    })
  })

  // ── deleteExercise / restoreExercise ───────────────────────────
  describe('deleteExercise / restoreExercise', () => {
    it('deletes an exercise', () => {
      const store = useWorkoutStore()
      store.addExercise('Bench')
      store.addExercise('Squat')
      const benchId = store.exercises[0].id
      store.deleteExercise(benchId)
      expect(store.exercises).toHaveLength(1)
      expect(store.exercises[0].name).toBe('Squat')
    })

    it('restores an exercise at a specific index', () => {
      const store = useWorkoutStore()
      store.addExercise('Bench')
      store.addExercise('Squat')
      store.addExercise('Deadlift')
      const squat = { ...store.exercises[1] }
      store.deleteExercise(squat.id)
      store.restoreExercise(squat as Exercise, 1)
      expect(store.exercises[1].name).toBe('Squat')
      expect(store.exercises).toHaveLength(3)
    })

    it('appends exercise when index is undefined', () => {
      const store = useWorkoutStore()
      store.addExercise('Bench')
      const bench = { ...store.exercises[0] } as Exercise
      store.deleteExercise(bench.id)
      store.restoreExercise(bench)
      expect(store.exercises[0].name).toBe('Bench')
    })
  })

  // ── moveExercise / reorderExercise ─────────────────────────────
  describe('moveExercise / reorderExercise', () => {
    it('moves exercise down', () => {
      const store = useWorkoutStore()
      store.addExercise('Bench')
      store.addExercise('Squat')
      store.addExercise('Deadlift')
      const benchId = store.exercises[0].id
      store.moveExercise(benchId, 1)
      expect(store.exercises[0].name).toBe('Squat')
      expect(store.exercises[1].name).toBe('Bench')
    })

    it('moves exercise up', () => {
      const store = useWorkoutStore()
      store.addExercise('Bench')
      store.addExercise('Squat')
      const squatId = store.exercises[1].id
      store.moveExercise(squatId, -1)
      expect(store.exercises[0].name).toBe('Squat')
      expect(store.exercises[1].name).toBe('Bench')
    })

    it('does nothing for out-of-bounds move', () => {
      const store = useWorkoutStore()
      store.addExercise('Bench')
      store.addExercise('Squat')
      const benchId = store.exercises[0].id
      store.moveExercise(benchId, -1) // Can't move first item up
      expect(store.exercises[0].name).toBe('Bench')
    })

    it('reorders exercise from one index to another', () => {
      const store = useWorkoutStore()
      store.addExercise('A')
      store.addExercise('B')
      store.addExercise('C')
      store.reorderExercise(2, 0) // Move C to front
      expect(store.exercises.map(e => e.name)).toEqual(['C', 'A', 'B'])
    })

    it('does nothing for invalid reorder indices', () => {
      const store = useWorkoutStore()
      store.addExercise('A')
      store.reorderExercise(-1, 0)
      store.reorderExercise(0, -1)
      store.reorderExercise(5, 0)
      store.reorderExercise(0, 0) // same index
      expect(store.exercises).toHaveLength(1)
    })
  })

  // ── renameTag / deleteTag ──────────────────────────────────────
  describe('renameTag', () => {
    it('renames a tag across all exercises', () => {
      const store = useWorkoutStore()
      store.addExercise('Bench', ['Push'])
      store.addExercise('OHP', ['Push', 'Shoulders'])
      store.renameTag('Push', 'Upper Push')
      expect(store.exercises[0].tags).toEqual(['Upper Push'])
      expect(store.exercises[1].tags).toContain('Upper Push')
      expect(store.exercises[1].tags).toContain('Shoulders')
    })

    it('does nothing for empty new name', () => {
      const store = useWorkoutStore()
      store.addExercise('Bench', ['Push'])
      store.renameTag('Push', '')
      expect(store.exercises[0].tags).toEqual(['Push'])
    })

    it('does nothing when old and new name are the same', () => {
      const store = useWorkoutStore()
      store.addExercise('Bench', ['Push'])
      store.renameTag('Push', 'Push')
      expect(store.exercises[0].tags).toEqual(['Push'])
    })

    it('removes duplicate when exercise already has the new tag name', () => {
      const store = useWorkoutStore()
      store.addExercise('Bench', ['Push', 'Upper'])
      store.renameTag('Push', 'Upper')
      // Should have just 'Upper', not ['Upper', 'Upper']
      expect(store.exercises[0].tags).toEqual(['Upper'])
    })
  })

  describe('deleteTag', () => {
    it('removes a tag from all exercises', () => {
      const store = useWorkoutStore()
      store.addExercise('Bench', ['Push', 'Chest'])
      store.addExercise('Squat', ['Push', 'Legs'])
      store.deleteTag('Push')
      expect(store.exercises[0].tags).toEqual(['Chest'])
      expect(store.exercises[1].tags).toEqual(['Legs'])
    })

    it('does nothing if tag does not exist', () => {
      const store = useWorkoutStore()
      store.addExercise('Bench', ['Push'])
      store.deleteTag('Nonexistent')
      expect(store.exercises[0].tags).toEqual(['Push'])
    })
  })

  // ── Getters ────────────────────────────────────────────────────
  describe('allTags', () => {
    it('returns sorted unique tags across all exercises', () => {
      const store = useWorkoutStore()
      store.addExercise('Bench', ['Push', 'Chest'])
      store.addExercise('Squat', ['Legs', 'Push'])
      expect(store.allTags).toEqual(['Chest', 'Legs', 'Push'])
    })

    it('returns empty array when no exercises', () => {
      const store = useWorkoutStore()
      expect(store.allTags).toEqual([])
    })
  })

  describe('getExercisePR', () => {
    it('returns highest estimated 1RM', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench')!
      store.logSet(id, 135, 10) // 1RM ≈ 180
      store.logSet(id, 225, 3) // 1RM ≈ 248
      store.logSet(id, 185, 5) // 1RM ≈ 216
      expect(store.getExercisePR(id)).toBe(248)
    })

    it('returns 0 for exercise with no sets', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench')!
      expect(store.getExercisePR(id)).toBe(0)
    })

    it('returns 0 for non-existent exercise', () => {
      const store = useWorkoutStore()
      expect(store.getExercisePR('fake')).toBe(0)
    })
  })

  describe('getRecentSets', () => {
    it('returns sets in reverse order (most recent first)', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Squat')!
      store.logSet(id, 135, 10)
      store.logSet(id, 185, 8)
      store.logSet(id, 225, 5)
      const recent = store.getRecentSets(id, 2)
      expect(recent).toHaveLength(2)
      expect(recent[0].weight).toBe(225)
      expect(recent[1].weight).toBe(185)
    })

    it('returns empty array for non-existent exercise', () => {
      const store = useWorkoutStore()
      expect(store.getRecentSets('fake')).toEqual([])
    })

    it('defaults to 5 items', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench')!
      for (let i = 0; i < 10; i++) {
        store.logSet(id, 100 + i * 10, 5)
      }
      expect(store.getRecentSets(id)).toHaveLength(5)
    })
  })

  describe('getOverloadSuggestion', () => {
    function addSetsOnDays(store: ReturnType<typeof useWorkoutStore>, exId: string, entries: Array<{ date: string; weight: number; reps: number }>) {
      for (const e of entries) {
        store.logSet(exId, e.weight, e.reps, e.date)
      }
    }

    it('returns null with fewer than 3 sets', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench')!
      store.logSet(id, 135, 10)
      store.logSet(id, 135, 10)
      expect(store.getOverloadSuggestion(id)).toBeNull()
    })

    it('returns null with fewer than 2 sessions', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench')!
      // 3 sets on same day = 1 session
      addSetsOnDays(store, id, [
        { date: '2026-03-01', weight: 135, reps: 10 },
        { date: '2026-03-01', weight: 185, reps: 5 },
        { date: '2026-03-01', weight: 225, reps: 3 },
      ])
      expect(store.getOverloadSuggestion(id)).toBeNull()
    })

    it('suggests weight increase after consistent sessions at same weight', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench')!
      addSetsOnDays(store, id, [
        { date: '2026-03-01', weight: 185, reps: 5 },
        { date: '2026-03-03', weight: 185, reps: 5 },
        { date: '2026-03-05', weight: 185, reps: 5 },
      ])
      const suggestion = store.getOverloadSuggestion(id)
      expect(suggestion).not.toBeNull()
      expect(suggestion!.type).toBe('increase_weight')
      expect(suggestion!.weight).toBe(190)
    })

    it('suggests rep increase after recent weight increase', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench')!
      addSetsOnDays(store, id, [
        { date: '2026-03-01', weight: 185, reps: 5 },
        { date: '2026-03-03', weight: 185, reps: 5 },
        { date: '2026-03-05', weight: 195, reps: 3 },
      ])
      const suggestion = store.getOverloadSuggestion(id)
      expect(suggestion).not.toBeNull()
      expect(suggestion!.type).toBe('increase_reps')
      expect(suggestion!.weight).toBe(195)
      expect(suggestion!.reps).toBe(4)
    })

    it('suggests weight increase when reps reach 8+', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench')!
      addSetsOnDays(store, id, [
        { date: '2026-03-01', weight: 135, reps: 6 },
        { date: '2026-03-03', weight: 135, reps: 7 },
        { date: '2026-03-05', weight: 135, reps: 8 },
      ])
      const suggestion = store.getOverloadSuggestion(id)
      expect(suggestion).not.toBeNull()
      expect(suggestion!.type).toBe('increase_weight')
      expect(suggestion!.weight).toBe(140)
    })

    it('returns null for non-existent exercise', () => {
      const store = useWorkoutStore()
      expect(store.getOverloadSuggestion('fake')).toBeNull()
    })
  })

  // ── sync opt-out ───────────────────────────────────────────────
  describe('sync opt-out', () => {
    it('respects sync: false flag on addExercise', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench', [], { sync: false })
      expect(id).toBeTruthy()
      expect(store.exercises).toHaveLength(1)
    })

    it('respects sync: false flag on logSet', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench', [], { sync: false })!
      store.logSet(id, 135, 10, undefined, { sync: false })
      expect(store.exercises[0].sets).toHaveLength(1)
    })

    it('respects sync: false flag on deleteSet', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench')!
      store.logSet(id, 135, 10)
      const setId = store.exercises[0].sets[0].id
      store.deleteSet(id, setId, { sync: false })
      expect(store.exercises[0].sets).toHaveLength(0)
    })

    it('respects sync: false flag on deleteExercise', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench')!
      store.deleteExercise(id, { sync: false })
      expect(store.exercises).toHaveLength(0)
    })
  })
})
