import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

vi.mock('../../lib/syncQueue', () => ({
  syncQueue: { enqueue: vi.fn(), enqueueDelete: vi.fn() }
}))
vi.mock('../../lib/conflictResolver', () => ({
  mergeEntities: vi.fn(() => ({ merged: [], localOnly: [] }))
}))

import { useWorkoutStore, deduplicateSets, deduplicateByName } from '../workout'
import type { Exercise, WorkoutSet } from '../workout'

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

  // ── reorderExercise ─────────────────────────────────────────────
  describe('reorderExercise', () => {
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

    it('transfers recovery days to the new tag name', () => {
      const store = useWorkoutStore()
      store.addExercise('Bench', ['Push'])
      store.setTagRecoveryDays('Push', 2)
      store.renameTag('Push', 'Upper Push')
      expect(store.tagRecoveryDays['Upper Push']).toBe(2)
      expect(store.tagRecoveryDays['Push']).toBeUndefined()
    })

    it('drops recovery days if new tag name already has them', () => {
      const store = useWorkoutStore()
      store.addExercise('Bench', ['Push', 'Upper'])
      store.setTagRecoveryDays('Push', 2)
      store.setTagRecoveryDays('Upper', 3)
      store.renameTag('Push', 'Upper')
      expect(store.tagRecoveryDays['Upper']).toBe(3) // keeps existing
      expect(store.tagRecoveryDays['Push']).toBeUndefined()
    })

    it('transfers excluded status to the new tag name', () => {
      const store = useWorkoutStore()
      store.addExercise('Bench', ['Push'])
      store.setTagRecoveryExcluded('Push', true)
      store.renameTag('Push', 'Upper Push')
      expect(store.tagRecoveryExcluded).toContain('Upper Push')
      expect(store.tagRecoveryExcluded).not.toContain('Push')
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

    it('removes recovery days for the deleted tag', () => {
      const store = useWorkoutStore()
      store.addExercise('Bench', ['Push'])
      store.setTagRecoveryDays('Push', 2)
      store.deleteTag('Push')
      expect(store.tagRecoveryDays['Push']).toBeUndefined()
    })

    it('removes excluded status for the deleted tag', () => {
      const store = useWorkoutStore()
      store.addExercise('Bench', ['Push'])
      store.setTagRecoveryExcluded('Push', true)
      store.deleteTag('Push')
      expect(store.tagRecoveryExcluded).not.toContain('Push')
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

    describe('sinceDate (PR baseline)', () => {
      it('excludes sets before sinceDate', () => {
        const store = useWorkoutStore()
        const id = store.addExercise('Bench')!
        store.logSet(id, 225, 5, '2025-06-01T10:00:00Z') // 1RM ≈ 262
        store.logSet(id, 185, 5, '2026-02-01T10:00:00Z') // 1RM ≈ 216
        store.logSet(id, 135, 5, '2026-03-01T10:00:00Z') // 1RM ≈ 158
        expect(store.getExercisePR(id, '2026-01-01')).toBe(216)
      })

      it('includes sets exactly on sinceDate', () => {
        const store = useWorkoutStore()
        const id = store.addExercise('Bench')!
        store.logSet(id, 135, 5, '2026-01-01T00:00:00Z')
        expect(store.getExercisePR(id, '2026-01-01')).toBeGreaterThan(0)
      })

      it('returns 0 when all sets are before sinceDate', () => {
        const store = useWorkoutStore()
        const id = store.addExercise('Bench')!
        store.logSet(id, 225, 5, '2024-01-01T10:00:00Z')
        expect(store.getExercisePR(id, '2026-01-01')).toBe(0)
      })

      it('undefined sinceDate preserves all-time behavior', () => {
        const store = useWorkoutStore()
        const id = store.addExercise('Bench')!
        store.logSet(id, 225, 5, '2020-01-01T10:00:00Z')
        store.logSet(id, 135, 5, '2026-03-01T10:00:00Z')
        // Older set has higher 1RM; without baseline it should win
        const allTime = store.getExercisePR(id)
        expect(allTime).toBeGreaterThan(store.getExercisePR(id, '2026-01-01'))
      })
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

  // ── onboarding edge cases (MAS-270) ────────────────────────────
  describe('onboarding edge cases', () => {
    it('chooseStarter pattern does not duplicate existing exercises', () => {
      const store = useWorkoutStore()
      // Simulate user who already has exercises (e.g. from previous onboarding)
      store.addExercise('Bench Press', ['Push', 'Chest'])
      store.addExercise('Squat', ['Legs'])
      expect(store.exercises).toHaveLength(2)

      // Simulate chooseStarter calling addExercise for all 6 starter exercises
      const starterExercises = [
        { name: 'Bench Press', tags: ['Push', 'Chest'] },
        { name: 'Squat', tags: ['Legs'] },
        { name: 'Deadlift', tags: ['Pull', 'Legs'] },
        { name: 'Overhead Press', tags: ['Push', 'Shoulders'] },
        { name: 'Barbell Row', tags: ['Pull', 'Back'] },
        { name: 'Pull-ups', tags: ['Pull', 'Back'] },
      ]
      for (const ex of starterExercises) {
        store.addExercise(ex.name, ex.tags)
      }
      // Should only have 6, not 8 (duplicates returned existing IDs)
      expect(store.exercises).toHaveLength(6)
    })

    it('addExercise returns existing id for case-insensitive duplicate during onboarding', () => {
      const store = useWorkoutStore()
      const id1 = store.addExercise('Bench Press', ['Push'])
      // Simulate onboarding calling with same name
      const id2 = store.addExercise('Bench Press', ['Push', 'Chest'])
      expect(id1).toBe(id2)
      expect(store.exercises).toHaveLength(1)
      // Tags should NOT be updated by duplicate add — original tags preserved
      expect(store.exercises[0].tags).toEqual(['Push'])
    })

    it('existing user data survives simulated localStorage loss of onboarding flag', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench Press', ['Push'])!
      store.logSet(id, 185, 5)
      expect(store.exercises).toHaveLength(1)
      expect(store.exercises[0].sets).toHaveLength(1)

      // Simulate localStorage clearing the onboarding flag but NOT workout data
      // (workout data persists in store state and its own localStorage key)
      localStorageMock.removeItem('onboarding-complete')
      expect(localStorageMock.getItem('onboarding-complete')).toBeNull()

      // Workout data should still be intact
      expect(store.exercises).toHaveLength(1)
      expect(store.exercises[0].sets).toHaveLength(1)
      expect(store.exercises[0].sets[0].weight).toBe(185)
    })

    it('re-running chooseStarter on existing data does not create duplicate sets', () => {
      const store = useWorkoutStore()
      // User already has Bench Press with logged sets
      const id = store.addExercise('Bench Press', ['Push'])!
      store.logSet(id, 185, 5)
      store.logSet(id, 200, 3)
      expect(store.exercises[0].sets).toHaveLength(2)

      // Simulate chooseStarter running again (addExercise returns existing id)
      const id2 = store.addExercise('Bench Press', ['Push', 'Chest'])
      expect(id2).toBe(id)
      // Sets should be untouched — chooseStarter only calls addExercise, not logSet
      expect(store.exercises[0].sets).toHaveLength(2)
    })

    it('store loads persisted exercises on re-initialization', () => {
      // First "session": add exercises and log sets
      const store1 = useWorkoutStore()
      const id = store1.addExercise('Squat', ['Legs'])!
      store1.logSet(id, 225, 5)

      // Verify data was persisted to localStorage
      const raw = localStorageMock.getItem('workout-exercises')
      expect(raw).toBeTruthy()
      const parsed = JSON.parse(raw)
      expect(parsed).toHaveLength(1)
      expect(parsed[0].name).toBe('Squat')
      expect(parsed[0].sets).toHaveLength(1)
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

    it('marks exercises as sample when sync: false (#232)', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Sample Exercise', [], { sync: false })!
      expect(store.exercises[0].sample).toBe(true)
    })

    it('does not mark exercises as sample when sync: true', () => {
      const store = useWorkoutStore()
      store.addExercise('Real Exercise')
      expect(store.exercises[0].sample).toBeUndefined()
    })

    it('clears sample flag when a real set is logged (#232)', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Sample Exercise', [], { sync: false })!
      expect(store.exercises[0].sample).toBe(true)
      // Log a real set (sync: true by default)
      store.logSet(id, 135, 10)
      expect(store.exercises[0].sample).toBeUndefined()
    })

    it('keeps sample flag when a sample set is logged', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Sample Exercise', [], { sync: false })!
      store.logSet(id, 135, 10, undefined, { sync: false })
      expect(store.exercises[0].sample).toBe(true)
    })
  })

  // ── deduplicateSets (sync triplicate cleanup) ─────────────────
  describe('deduplicateSets', () => {
    function makeSet(id: string, date: string, weight: number, reps: number): WorkoutSet {
      return { id, date, weight, reps, estimated1RM: Math.round(weight * (1 + reps / 30)) }
    }

    it('removes exact timestamp duplicates (old fixed format)', () => {
      const sets = [
        makeSet('b1', '2026-04-04T23:59:59.000Z', 225, 10),
        makeSet('b2', '2026-04-04T23:59:59.000Z', 225, 10),
        makeSet('b3', '2026-04-04T23:59:59.000Z', 225, 10),
      ]
      const { unique, removedIds } = deduplicateSets(sets)
      expect(unique).toHaveLength(1)
      expect(removedIds).toHaveLength(2)
    })

    it('preserves jitter-differentiated sets (5x5 safe)', () => {
      // Different jitter timestamps = different sets, even if same weight/reps
      const sets = [
        makeSet('a1', '2026-04-04T23:59:42.317Z', 225, 5),
        makeSet('a2', '2026-04-04T23:59:18.901Z', 225, 5),
        makeSet('a3', '2026-04-04T23:59:55.123Z', 225, 5),
        makeSet('a4', '2026-04-04T23:59:07.456Z', 225, 5),
        makeSet('a5', '2026-04-04T23:59:33.789Z', 225, 5),
      ]
      const { unique, removedIds } = deduplicateSets(sets)
      expect(unique).toHaveLength(5)
      expect(removedIds).toHaveLength(0)
    })

    it('keeps sets with different weight or reps on the same day', () => {
      const sets = [
        makeSet('c1', '2026-04-04T23:59:42.317Z', 225, 36),
        makeSet('c2', '2026-04-04T23:59:18.901Z', 505, 6),
        makeSet('c3', '2026-04-04T23:59:55.123Z', 500, 5),
        makeSet('c4', '2026-04-04T23:59:11.456Z', 315, 6),
      ]
      const { unique, removedIds } = deduplicateSets(sets)
      expect(unique).toHaveLength(4)
      expect(removedIds).toHaveLength(0)
    })

    it('keeps sets with the same weight/reps on different days', () => {
      const sets = [
        makeSet('d1', '2026-04-01T23:59:42.317Z', 505, 6),
        makeSet('d2', '2026-04-04T23:59:18.901Z', 505, 6),
      ]
      const { unique, removedIds } = deduplicateSets(sets)
      expect(unique).toHaveLength(2)
      expect(removedIds).toHaveLength(0)
    })

    it('preserves real-time logged identical sets (3x10 in-session)', () => {
      const sets = [
        makeSet('e1', '2026-04-04T14:30:00.000Z', 225, 10),
        makeSet('e2', '2026-04-04T14:45:00.000Z', 225, 10),
        makeSet('e3', '2026-04-04T15:00:00.000Z', 225, 10),
      ]
      const { unique, removedIds } = deduplicateSets(sets)
      expect(unique).toHaveLength(3)
      expect(removedIds).toHaveLength(0)
    })
  })

  // ── deduplicateByName ─────────────────────────────────────────
  describe('deduplicateByName', () => {
    it('merges exercises with same name, keeping the one with most sets', () => {
      const exercises: Exercise[] = [
        { id: 'x1', name: 'Squat', tags: ['Legs'], sets: [
          { id: 's1', date: '2026-04-01T23:59:59.000Z', weight: 225, reps: 5, estimated1RM: 263 },
          { id: 's2', date: '2026-04-01T23:59:59.000Z', weight: 275, reps: 3, estimated1RM: 303 },
        ]},
        { id: 'x2', name: 'squat', tags: [], sets: [
          { id: 's3', date: '2026-04-01T23:59:42.000Z', weight: 225, reps: 5, estimated1RM: 263 },
        ]},
      ]
      const { exercises: result, removed } = deduplicateByName(exercises)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('x1')
      expect(removed).toHaveLength(1)
      expect(removed[0].id).toBe('x2')
    })

    it('SEV1 regression 2026-04-12 — dedup must never push server DELETEs (READ path is read-only)', () => {
      // Incident: client-side dedup in _fetchFromSupabase broadcast DELETE ops
      // to Supabase every sync. For users with backdated straight-set programs
      // (5x5 with T12:00:00 noon-local or T23:59:59 fixed timestamps), identical
      // (date|weight|reps) tuples collapsed to one survivor and the rest were
      // permanently deleted server-side. ~11 sets/session lost. No PITR on free
      // tier = unrecoverable.
      //
      // Root cause: client treated its dedup heuristic as authoritative over
      // server data. Fix: dedup is purely local; server is source of truth.
      //
      // This structural test prevents the exact anti-patterns from returning.
      // Functional behavior is covered by the deduplicateSets / deduplicateByName
      // unit tests above — those verify the local pruning still works.
      const __filename = fileURLToPath(import.meta.url)
      const __dirname = dirname(__filename)
      const src = readFileSync(resolve(__dirname, '../workout.ts'), 'utf-8')

      // Extract the _fetchFromSupabase function body. Uses brace counting
      // to handle nested braces correctly.
      const fnStart = src.indexOf('async function _fetchFromSupabase()')
      expect(fnStart).toBeGreaterThan(-1)
      const openBrace = src.indexOf('{', fnStart)
      let depth = 1
      let i = openBrace + 1
      while (i < src.length && depth > 0) {
        if (src[i] === '{') depth++
        else if (src[i] === '}') depth--
        i++
      }
      const body = src.slice(openBrace + 1, i - 1)

      // Every .delete(...) call in this function MUST be part of tombstone
      // processing (syncing pending USER-initiated deletes). Non-tombstone
      // deletes in the read path are the bug we shipped a SEV1 for.
      //
      // Heuristic: for each .delete( match, the prior 10 lines must mention
      // "tombstone" (either the import or the branch condition isTombstoned).
      const deletePattern = /\.delete\s*\(/g
      let match: RegExpExecArray | null
      while ((match = deletePattern.exec(body)) !== null) {
        const before = body.slice(Math.max(0, match.index - 400), match.index)
        expect(before).toMatch(/tombstone/i)
      }

      // Guard against the specific variable names and comment fragments that
      // existed before the fix. If these reappear, the bug is back.
      expect(body).not.toMatch(/dupSetIds/)
      expect(body).not.toMatch(/Set was content-deduped out/)
      expect(body).not.toMatch(/Delete the duplicate exercise from Supabase/)
    })

    it('SEV1 regression 2026-04-12 — bodyweight read path is also read-only', () => {
      // Bodyweight store had the same anti-pattern as workout: date-level dedup
      // broadcast deletes to Supabase. Same fix applied.
      const __filename = fileURLToPath(import.meta.url)
      const __dirname = dirname(__filename)
      const src = readFileSync(resolve(__dirname, '../bodyweight.ts'), 'utf-8')

      const fnStart = src.indexOf('async _fetchFromSupabase()')
      expect(fnStart).toBeGreaterThan(-1)
      const openBrace = src.indexOf('{', fnStart)
      let depth = 1
      let i = openBrace + 1
      while (i < src.length && depth > 0) {
        if (src[i] === '{') depth++
        else if (src[i] === '}') depth--
        i++
      }
      const body = src.slice(openBrace + 1, i - 1)

      const deletePattern = /\.delete\s*\(/g
      let match: RegExpExecArray | null
      while ((match = deletePattern.exec(body)) !== null) {
        const before = body.slice(Math.max(0, match.index - 400), match.index)
        expect(before).toMatch(/tombstone/i)
      }

      expect(body).not.toMatch(/dupIds/)
      expect(body).not.toMatch(/Clean up duplicate entries from Supabase/)
    })

    it('sorts merged sets chronologically (regression: out-of-order after dedup)', () => {
      const exercises: Exercise[] = [
        { id: 'x1', name: 'Bench', tags: [], sets: [
          { id: 's1', date: '2026-04-02T23:59:59.000Z', weight: 185, reps: 5, estimated1RM: 216 },
          { id: 's3', date: '2026-04-04T23:59:59.000Z', weight: 195, reps: 5, estimated1RM: 228 },
        ]},
        { id: 'x2', name: 'bench', tags: [], sets: [
          { id: 's2', date: '2026-04-03T23:59:59.000Z', weight: 190, reps: 5, estimated1RM: 222 },
        ]},
      ]
      const { exercises: result } = deduplicateByName(exercises)
      expect(result).toHaveLength(1)
      expect(result[0].sets.map(s => s.id)).toEqual(['s1', 's2', 's3'])
    })
  })

  // ── $reset (#500) ─────────────────────────────────────────────
  describe('$reset', () => {
    it('clears all state back to initial values', () => {
      const store = useWorkoutStore()
      store.addExercise('Bench Press', ['Push'])
      store.addCustomTag('Accessory')
      expect(store.exercises.length).toBeGreaterThan(0)
      expect(store.customTags.length).toBeGreaterThan(0)

      store.$reset()

      expect(store.exercises).toEqual([])
      expect(store.customTags).toEqual([])
      expect(store.tagRecoveryDays).toEqual({})
      expect(store.tagRecoveryExcluded).toEqual([])
    })

    it('persists cleared state to localStorage', () => {
      const store = useWorkoutStore()
      store.addExercise('Squat')
      localStorageMock.setItem.mockClear()

      store.$reset()

      expect(localStorageMock.setItem).toHaveBeenCalledWith('workout-exercises', '[]')
      expect(localStorageMock.setItem).toHaveBeenCalledWith('lift-custom-tags', '[]')
    })

    it('does not throw (regression: setup stores lack auto $reset)', () => {
      const store = useWorkoutStore()
      expect(() => store.$reset()).not.toThrow()
    })
  })
})
