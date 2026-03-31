import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useWorkoutStore } from '../workout'

vi.mock('../../lib/supabase', () => ({ supabase: null }))
vi.mock('../../lib/uuid', () => ({ uuid: () => 'test-uuid-' + Math.random().toString(36).slice(2, 8) }))

const localStorageMock = (() => {
  let store = {}
  return {
    getItem: vi.fn(key => store[key] ?? null),
    setItem: vi.fn((key, val) => { store[key] = String(val) }),
    removeItem: vi.fn(key => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
  }
})()
vi.stubGlobal('localStorage', localStorageMock)

describe('useWorkoutStore', () => {
  let store

  beforeEach(() => {
    localStorageMock.clear()
    setActivePinia(createPinia())
    store = useWorkoutStore()
    store.exercises = []
  })

  describe('addExercise', () => {
    it('adds a new exercise with name and tags', () => {
      const id = store.addExercise('Bench Press', ['chest', 'push'])
      expect(id).toBeTruthy()
      expect(store.exercises).toHaveLength(1)
      expect(store.exercises[0].name).toBe('Bench Press')
      expect(store.exercises[0].tags).toEqual(['chest', 'push'])
      expect(store.exercises[0].sets).toEqual([])
    })

    it('trims whitespace from exercise name', () => {
      store.addExercise('  Squat  ')
      expect(store.exercises[0].name).toBe('Squat')
    })

    it('returns null for empty name', () => {
      const id = store.addExercise('   ')
      expect(id).toBeNull()
      expect(store.exercises).toHaveLength(0)
    })

    it('returns existing id for duplicate name (case-insensitive)', () => {
      const id1 = store.addExercise('Squat')
      const id2 = store.addExercise('squat')
      expect(id2).toBe(id1)
      expect(store.exercises).toHaveLength(1)
    })

    it('defaults tags to empty array', () => {
      store.addExercise('Deadlift')
      expect(store.exercises[0].tags).toEqual([])
    })
  })

  describe('logSet and estimated 1RM (Epley formula)', () => {
    let exerciseId

    beforeEach(() => {
      exerciseId = store.addExercise('Bench Press')
    })

    it('adds a set with correct estimated 1RM using Epley formula', () => {
      store.logSet(exerciseId, 200, 5, '2024-01-15')
      const set = store.exercises[0].sets[0]
      expect(set.weight).toBe(200)
      expect(set.reps).toBe(5)
      // Epley: 200 * (1 + 5/30) = 200 * 1.1667 = 233.33 → rounded to 233
      expect(set.estimated1RM).toBe(233)
    })

    it('returns weight directly for single rep (1RM)', () => {
      store.logSet(exerciseId, 315, 1, '2024-01-15')
      expect(store.exercises[0].sets[0].estimated1RM).toBe(315)
    })

    it('stores ISO date string when dateStr is provided', () => {
      store.logSet(exerciseId, 135, 10, '2024-06-01')
      const set = store.exercises[0].sets[0]
      expect(set.date).toContain('2024-06-01')
    })

    it('does nothing for a non-existent exercise', () => {
      store.logSet('nonexistent', 100, 5)
      expect(store.exercises[0].sets).toHaveLength(0)
    })
  })

  describe('getExercisePR', () => {
    it('returns the highest estimated 1RM across all sets', () => {
      const id = store.addExercise('Squat')
      store.logSet(id, 200, 5, '2024-01-01') // e1RM = 233
      store.logSet(id, 225, 3, '2024-01-08') // e1RM = 248
      store.logSet(id, 185, 8, '2024-01-15') // e1RM = 234
      expect(store.getExercisePR(id)).toBe(248)
    })

    it('returns 0 for an exercise with no sets', () => {
      const id = store.addExercise('OHP')
      expect(store.getExercisePR(id)).toBe(0)
    })

    it('returns 0 for a non-existent exercise', () => {
      expect(store.getExercisePR('nonexistent')).toBe(0)
    })
  })

  describe('deleteSet', () => {
    it('removes a specific set from an exercise', () => {
      const id = store.addExercise('Row')
      store.logSet(id, 135, 10, '2024-01-01')
      store.logSet(id, 155, 8, '2024-01-02')
      expect(store.exercises[0].sets).toHaveLength(2)

      const setId = store.exercises[0].sets[0].id
      store.deleteSet(id, setId)
      expect(store.exercises[0].sets).toHaveLength(1)
      expect(store.exercises[0].sets[0].weight).toBe(155)
    })

    it('does nothing when exercise does not exist', () => {
      const id = store.addExercise('Row')
      store.logSet(id, 135, 10, '2024-01-01')
      store.deleteSet('nonexistent', 'any-id')
      expect(store.exercises[0].sets).toHaveLength(1)
    })
  })

  describe('allTags (tag filtering)', () => {
    it('returns unique sorted tags across all exercises', () => {
      store.addExercise('Bench', ['chest', 'push'])
      store.addExercise('Row', ['back', 'pull'])
      store.addExercise('OHP', ['push', 'shoulders'])
      expect(store.allTags).toEqual(['back', 'chest', 'pull', 'push', 'shoulders'])
    })

    it('returns empty array when no exercises have tags', () => {
      store.addExercise('Curl')
      expect(store.allTags).toEqual([])
    })
  })

  describe('getRecentSets', () => {
    it('returns the last N sets in reverse order', () => {
      const id = store.addExercise('DL')
      store.logSet(id, 225, 5, '2024-01-01')
      store.logSet(id, 275, 3, '2024-01-02')
      store.logSet(id, 315, 1, '2024-01-03')

      const recent = store.getRecentSets(id, 2)
      expect(recent).toHaveLength(2)
      expect(recent[0].weight).toBe(315)
      expect(recent[1].weight).toBe(275)
    })
  })

  describe('updateSet', () => {
    it('updates weight, reps, and recalculates estimated 1RM', () => {
      const id = store.addExercise('Squat')
      store.logSet(id, 200, 5, '2024-01-01')
      const setId = store.exercises[0].sets[0].id

      store.updateSet(id, setId, 225, 3, '2024-01-02')
      const set = store.exercises[0].sets[0]
      expect(set.weight).toBe(225)
      expect(set.reps).toBe(3)
      // Epley: 225 * (1 + 3/30) = 225 * 1.1 = 247.5 → 248
      expect(set.estimated1RM).toBe(248)
    })
  })

  describe('deleteExercise', () => {
    it('removes the exercise entirely', () => {
      const id = store.addExercise('Curl')
      store.addExercise('Squat')
      store.deleteExercise(id)
      expect(store.exercises).toHaveLength(1)
      expect(store.exercises[0].name).toBe('Squat')
    })
  })

  describe('moveExercise', () => {
    it('moves an exercise down by one position', () => {
      store.addExercise('A')
      store.addExercise('B')
      store.addExercise('C')
      const id = store.exercises[0].id
      store.moveExercise(id, 1)
      expect(store.exercises.map(e => e.name)).toEqual(['B', 'A', 'C'])
    })

    it('does not move past boundaries', () => {
      store.addExercise('A')
      store.addExercise('B')
      const lastId = store.exercises[1].id
      store.moveExercise(lastId, 1)
      expect(store.exercises.map(e => e.name)).toEqual(['A', 'B'])
    })
  })

  describe('renameTag', () => {
    it('renames a tag across all exercises', () => {
      store.addExercise('Bench Press', ['chest', 'push'])
      store.addExercise('Incline DB', ['chest'])
      store.addExercise('Squat', ['legs'])
      store.renameTag('chest', 'upper body')
      expect(store.exercises[0].tags).toContain('upper body')
      expect(store.exercises[0].tags).not.toContain('chest')
      expect(store.exercises[1].tags).toEqual(['upper body'])
      expect(store.exercises[2].tags).toEqual(['legs'])
    })

    it('avoids duplicate tags when renaming to an existing tag on an exercise', () => {
      store.addExercise('Bench Press', ['chest', 'push'])
      store.renameTag('chest', 'push')
      // 'chest' should be removed, 'push' should not be duplicated
      expect(store.exercises[0].tags).toEqual(['push'])
    })

    it('does nothing for empty or same name', () => {
      store.addExercise('Bench Press', ['chest'])
      store.renameTag('chest', '')
      expect(store.exercises[0].tags).toEqual(['chest'])
      store.renameTag('chest', 'chest')
      expect(store.exercises[0].tags).toEqual(['chest'])
    })
  })

  describe('deleteTag', () => {
    it('removes a tag from all exercises', () => {
      store.addExercise('Bench Press', ['chest', 'push'])
      store.addExercise('Incline DB', ['chest'])
      store.addExercise('Squat', ['legs'])
      store.deleteTag('chest')
      expect(store.exercises[0].tags).toEqual(['push'])
      expect(store.exercises[1].tags).toEqual([])
      expect(store.exercises[2].tags).toEqual(['legs'])
    })

    it('does nothing if tag does not exist', () => {
      store.addExercise('Bench Press', ['chest'])
      store.deleteTag('nonexistent')
      expect(store.exercises[0].tags).toEqual(['chest'])
    })
  })

  describe('persistence', () => {
    it('persists exercises to localStorage', () => {
      store.addExercise('Bench Press')
      const stored = JSON.parse(localStorage.getItem('workout-exercises'))
      expect(stored).toHaveLength(1)
      expect(stored[0].name).toBe('Bench Press')
    })
  })

  describe('getOverloadSuggestion', () => {
    function logSetOnDate(exerciseId, weight, reps, dateStr) {
      store.logSet(exerciseId, weight, reps, dateStr)
    }

    it('returns null when exercise has fewer than 3 sets', () => {
      const id = store.addExercise('Bench Press')
      store.logSet(id, 135, 8, '2026-03-01')
      store.logSet(id, 135, 8, '2026-03-02')
      expect(store.getOverloadSuggestion(id)).toBeNull()
    })

    it('returns null when exercise does not exist', () => {
      expect(store.getOverloadSuggestion('nonexistent')).toBeNull()
    })

    it('returns null when fewer than 2 unique sessions', () => {
      const id = store.addExercise('Bench Press')
      // 3 sets, but all on same day
      store.logSet(id, 135, 8, '2026-03-01')
      store.logSet(id, 135, 8, '2026-03-01')
      store.logSet(id, 135, 8, '2026-03-01')
      expect(store.getOverloadSuggestion(id)).toBeNull()
    })

    it('suggests weight increase when same weight×reps across 2+ sessions', () => {
      const id = store.addExercise('Bench Press')
      logSetOnDate(id, 135, 8, '2026-03-01')
      logSetOnDate(id, 135, 8, '2026-03-03')
      logSetOnDate(id, 135, 8, '2026-03-05')
      const suggestion = store.getOverloadSuggestion(id)
      expect(suggestion).not.toBeNull()
      expect(suggestion.type).toBe('increase_weight')
      expect(suggestion.weight).toBe(140)
      expect(suggestion.reps).toBe(6) // 8 - 2
    })

    it('suggests weight increase when reps are high and increasing', () => {
      const id = store.addExercise('Squat')
      logSetOnDate(id, 185, 7, '2026-03-01')
      logSetOnDate(id, 185, 9, '2026-03-03')
      logSetOnDate(id, 185, 10, '2026-03-05')
      const suggestion = store.getOverloadSuggestion(id)
      expect(suggestion).not.toBeNull()
      expect(suggestion.type).toBe('increase_weight')
      expect(suggestion.weight).toBe(190)
    })

    it('suggests rep increase when reps are increasing but still low', () => {
      const id = store.addExercise('OHP')
      logSetOnDate(id, 95, 3, '2026-03-01')
      logSetOnDate(id, 95, 3, '2026-03-03')
      logSetOnDate(id, 95, 4, '2026-03-05')
      const suggestion = store.getOverloadSuggestion(id)
      expect(suggestion).not.toBeNull()
      expect(suggestion.type).toBe('increase_reps')
      expect(suggestion.weight).toBe(95)
      expect(suggestion.reps).toBe(5) // 4 + 1
    })

    it('suggests consolidation when weight was recently increased', () => {
      const id = store.addExercise('Deadlift')
      logSetOnDate(id, 225, 5, '2026-03-01')
      logSetOnDate(id, 225, 5, '2026-03-03')
      logSetOnDate(id, 235, 4, '2026-03-05')
      const suggestion = store.getOverloadSuggestion(id)
      expect(suggestion).not.toBeNull()
      expect(suggestion.type).toBe('increase_reps')
      expect(suggestion.weight).toBe(235)
      expect(suggestion.reps).toBe(5)
      expect(suggestion.reason).toContain('build reps')
    })

    it('uses heaviest set from each session', () => {
      const id = store.addExercise('Bench Press')
      // Session 1: multiple sets, heaviest is 145×5
      logSetOnDate(id, 135, 8, '2026-03-01')
      logSetOnDate(id, 145, 5, '2026-03-01')
      // Session 2: heaviest is 145×6
      logSetOnDate(id, 135, 8, '2026-03-03')
      logSetOnDate(id, 145, 6, '2026-03-03')
      // Session 3: heaviest is 145×7
      logSetOnDate(id, 135, 8, '2026-03-05')
      logSetOnDate(id, 145, 7, '2026-03-05')
      const suggestion = store.getOverloadSuggestion(id)
      expect(suggestion).not.toBeNull()
      // 145 across all 3 sessions with ≥5 reps → increase weight
      expect(suggestion.type).toBe('increase_weight')
      expect(suggestion.weight).toBe(150)
    })

    it('includes a reason string', () => {
      const id = store.addExercise('Bench Press')
      logSetOnDate(id, 135, 8, '2026-03-01')
      logSetOnDate(id, 135, 8, '2026-03-03')
      logSetOnDate(id, 135, 8, '2026-03-05')
      const suggestion = store.getOverloadSuggestion(id)
      expect(suggestion.reason).toBeTruthy()
      expect(typeof suggestion.reason).toBe('string')
    })
  })
})
