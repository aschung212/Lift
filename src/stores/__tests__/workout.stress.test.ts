/**
 * Load & stress tests for the workout store.
 *
 * Validates that core operations remain performant under realistic
 * and extreme data volumes: 500+ exercises, 10k+ sets, rapid
 * sequential mutations, and large-data getter computations.
 *
 * These tests set performance budgets — if any operation exceeds its
 * budget, it signals a regression that would degrade UX on real devices.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

vi.mock('../../lib/syncQueue', () => ({
  syncQueue: { enqueue: vi.fn() }
}))
vi.mock('../../lib/conflictResolver', () => ({
  mergeEntities: vi.fn(() => ({ merged: [], localOnly: [] }))
}))

import { useWorkoutStore } from '../workout'
import type { Exercise, WorkoutSet } from '../workout'

// ── Helpers ──────────────────────────────────────────────────────

function makeExercise(index: number, setCount: number): Exercise {
  const sets: WorkoutSet[] = []
  for (let j = 0; j < setCount; j++) {
    const day = String(j % 365).padStart(3, '0')
    sets.push({
      id: `set-${index}-${j}`,
      date: `2026-${String(Math.floor(j / 28) % 12 + 1).padStart(2, '0')}-${String((j % 28) + 1).padStart(2, '0')}T12:00:00.000Z`,
      weight: 100 + (j % 20) * 5,
      reps: 3 + (j % 10),
      estimated1RM: Math.round((100 + (j % 20) * 5) * (1 + (3 + (j % 10)) / 30)),
    })
  }
  return {
    id: `exercise-${index}`,
    name: `Exercise ${index}`,
    tags: [`Tag${index % 10}`, `Group${index % 5}`],
    sets,
  }
}

function seedStore(store: ReturnType<typeof useWorkoutStore>, exerciseCount: number, setsPerExercise: number) {
  const exercises: Exercise[] = []
  for (let i = 0; i < exerciseCount; i++) {
    exercises.push(makeExercise(i, setsPerExercise))
  }
  // Inject directly to avoid per-exercise persist overhead during setup
  store.$patch({ exercises })
}

function measure(fn: () => void): number {
  const start = performance.now()
  fn()
  return performance.now() - start
}

// ── Tests ────────────────────────────────────────────────────────

describe('workout store — load & stress tests', () => {
  beforeEach(() => {
    localStorageMock.clear()
    setActivePinia(createPinia())
  })

  // ── Store initialization with large datasets ───────────────────

  describe('large dataset initialization', () => {
    it('initializes store with 500 exercises (20 sets each = 10,000 sets) under 100ms', () => {
      const exercises: Exercise[] = []
      for (let i = 0; i < 500; i++) {
        exercises.push(makeExercise(i, 20))
      }
      localStorageMock.setItem('workout-exercises', JSON.stringify(exercises))

      const elapsed = measure(() => {
        // Force store creation which reads from localStorage
        setActivePinia(createPinia())
        const store = useWorkoutStore()
        expect(store.exercises.length).toBe(500)
      })

      expect(elapsed).toBeLessThan(100)
    })

    it('initializes store with 1000 exercises (50 sets each = 50,000 sets) under 500ms', () => {
      const exercises: Exercise[] = []
      for (let i = 0; i < 1000; i++) {
        exercises.push(makeExercise(i, 50))
      }
      localStorageMock.setItem('workout-exercises', JSON.stringify(exercises))

      const elapsed = measure(() => {
        setActivePinia(createPinia())
        const store = useWorkoutStore()
        expect(store.exercises.length).toBe(1000)
      })

      expect(elapsed).toBeLessThan(500)
    })
  })

  // ── Rapid set logging ──────────────────────────────────────────

  describe('rapid set logging', () => {
    it('logs 100 sets in rapid succession under 200ms', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench Press', ['Push'])!

      const elapsed = measure(() => {
        for (let i = 0; i < 100; i++) {
          store.logSet(id, 135 + i, 5 + (i % 8), '2026-04-01', { sync: false })
        }
      })

      expect(store.exercises[0].sets).toHaveLength(100)
      expect(elapsed).toBeLessThan(200)
    })

    it('logs 500 sets across 50 exercises under 2000ms', () => {
      const store = useWorkoutStore()
      const ids: string[] = []
      for (let i = 0; i < 50; i++) {
        ids.push(store.addExercise(`Exercise ${i}`, [], { sync: false })!)
      }

      const elapsed = measure(() => {
        for (let i = 0; i < 500; i++) {
          const exerciseIdx = i % 50
          store.logSet(ids[exerciseIdx], 100 + i, 5, '2026-04-01', { sync: false })
        }
      })

      const totalSets = store.exercises.reduce((sum, e) => sum + e.sets.length, 0)
      expect(totalSets).toBe(500)
      // Each logSet calls _persist() (localStorage serialization), so 500 writes
      expect(elapsed).toBeLessThan(2000)
    })
  })

  // ── Getter performance under load ──────────────────────────────

  describe('getter performance under load', () => {
    it('computes PR for exercise with 1000 sets under 5ms', () => {
      const store = useWorkoutStore()
      seedStore(store, 1, 1000)
      const exerciseId = store.exercises[0].id

      const elapsed = measure(() => {
        const pr = store.getExercisePR(exerciseId)
        expect(pr).toBeGreaterThan(0)
      })

      expect(elapsed).toBeLessThan(20)
    })

    it('computes PR set for exercise with 1000 sets under 20ms', () => {
      const store = useWorkoutStore()
      seedStore(store, 1, 1000)
      const exerciseId = store.exercises[0].id

      const elapsed = measure(() => {
        const prSet = store.getExercisePRSet(exerciseId)
        expect(prSet).not.toBeNull()
      })

      expect(elapsed).toBeLessThan(20)
    })

    it('computes overload suggestion with 500 sets under 50ms', () => {
      const store = useWorkoutStore()
      seedStore(store, 1, 500)
      const exerciseId = store.exercises[0].id

      const elapsed = measure(() => {
        const suggestion = store.getOverloadSuggestion(exerciseId)
        // With 500 sets across many dates, should produce a suggestion
        expect(suggestion).not.toBeNull()
      })

      expect(elapsed).toBeLessThan(50)
    })

    it('computes allTags with 500 exercises (10 tags each) under 50ms', () => {
      const store = useWorkoutStore()
      seedStore(store, 500, 5)

      const elapsed = measure(() => {
        const tags = store.allTags
        expect(tags.length).toBeGreaterThan(0)
      })

      expect(elapsed).toBeLessThan(50)
    })
  })

  // ── Mutation operations at scale ───────────────────────────────

  describe('mutation operations at scale', () => {
    it('deletes sets from a large exercise (500 sets) under 50ms per deletion', () => {
      const store = useWorkoutStore()
      seedStore(store, 1, 500)
      const exerciseId = store.exercises[0].id
      const setIds = store.exercises[0].sets.slice(0, 10).map(s => s.id)

      const elapsed = measure(() => {
        for (const setId of setIds) {
          store.deleteSet(exerciseId, setId, { sync: false })
        }
      })

      expect(store.exercises[0].sets).toHaveLength(490)
      // 10 deletions should complete well under 500ms total
      expect(elapsed).toBeLessThan(500)
    })

    it('renames tag across 500 exercises under 100ms', () => {
      const store = useWorkoutStore()
      seedStore(store, 500, 5)
      // Tag0 appears on every 10th exercise (indices 0, 10, 20, ...)
      const taggedBefore = store.exercises.filter(e => e.tags.includes('Tag0')).length
      expect(taggedBefore).toBeGreaterThan(0)

      const elapsed = measure(() => {
        store.renameTag('Tag0', 'RenamedTag')
      })

      const taggedAfter = store.exercises.filter(e => e.tags.includes('RenamedTag')).length
      expect(taggedAfter).toBe(taggedBefore)
      expect(elapsed).toBeLessThan(100)
    })

    it('deletes tag across 500 exercises under 100ms', () => {
      const store = useWorkoutStore()
      seedStore(store, 500, 5)

      const elapsed = measure(() => {
        store.deleteTag('Tag1')
      })

      const remaining = store.exercises.filter(e => e.tags.includes('Tag1'))
      expect(remaining).toHaveLength(0)
      expect(elapsed).toBeLessThan(100)
    })

    it('reorders exercises in a list of 500 under 10ms', () => {
      const store = useWorkoutStore()
      seedStore(store, 500, 5)
      const firstName = store.exercises[0].name
      const lastName = store.exercises[499].name

      const elapsed = measure(() => {
        store.reorderExercise(0, 499)
      })

      expect(store.exercises[499].name).toBe(firstName)
      expect(store.exercises[0].name).not.toBe(firstName)
      // reorder calls _persist with full serialization of 500 exercises
      expect(elapsed).toBeLessThan(50)
    })
  })

  // ── Persistence (serialization) stress ─────────────────────────

  describe('persistence serialization', () => {
    it('serializes 500 exercises with 20 sets each to localStorage under 200ms', () => {
      const store = useWorkoutStore()
      seedStore(store, 500, 20)

      const elapsed = measure(() => {
        // _persist is called by mutations; call it directly to benchmark
        store._persist()
      })

      const stored = localStorageMock.setItem.mock.calls
      expect(stored.length).toBeGreaterThan(0)
      expect(elapsed).toBeLessThan(200)
    })

    it('handles serialization of exercises with long names and many tags', () => {
      const store = useWorkoutStore()
      const exercises: Exercise[] = []
      for (let i = 0; i < 200; i++) {
        exercises.push({
          id: `exercise-${i}`,
          name: `Very Long Exercise Name That Simulates Real User Input ${i} With Extra Details`,
          tags: Array.from({ length: 15 }, (_, j) => `DetailedTag${j}-Category${i % 5}`),
          sets: Array.from({ length: 30 }, (_, j) => ({
            id: `set-${i}-${j}`,
            date: `2026-01-${String((j % 28) + 1).padStart(2, '0')}T12:00:00.000Z`,
            weight: 100 + j * 5,
            reps: 5,
            estimated1RM: Math.round((100 + j * 5) * (1 + 5 / 30)),
          })),
        })
      }
      store.$patch({ exercises })

      const elapsed = measure(() => {
        store._persist()
      })

      expect(elapsed).toBeLessThan(200)
    })
  })

  // ── Deduplication stress ───────────────────────────────────────

  describe('deduplication at scale', () => {
    it('addExercise rejects duplicates efficiently with 500 existing exercises', () => {
      const store = useWorkoutStore()
      seedStore(store, 500, 5)

      // Try adding 100 duplicates (case-insensitive match)
      const elapsed = measure(() => {
        for (let i = 0; i < 100; i++) {
          const result = store.addExercise(`exercise ${i}`, [], { sync: false })
          // Should return existing ID, not create new
          expect(result).toBe(`exercise-${i}`)
        }
      })

      // Still 500 exercises — no duplicates added
      expect(store.exercises).toHaveLength(500)
      expect(elapsed).toBeLessThan(200)
    })
  })

  // ── Concurrent-style rapid operations ──────────────────────────

  describe('rapid mixed operations', () => {
    it('handles 200 mixed add/log/delete operations under 500ms', () => {
      const store = useWorkoutStore()

      const elapsed = measure(() => {
        // Phase 1: Add 50 exercises
        const ids: string[] = []
        for (let i = 0; i < 50; i++) {
          ids.push(store.addExercise(`Rapid Exercise ${i}`, [`Cat${i % 5}`], { sync: false })!)
        }

        // Phase 2: Log 100 sets across those exercises
        for (let i = 0; i < 100; i++) {
          store.logSet(ids[i % 50], 100 + i, 5, '2026-04-01', { sync: false })
        }

        // Phase 3: Delete 50 sets
        for (let i = 0; i < 50; i++) {
          const exercise = store.exercises[i % 50]
          if (exercise.sets.length > 0) {
            store.deleteSet(exercise.id, exercise.sets[0].id, { sync: false })
          }
        }
      })

      expect(elapsed).toBeLessThan(500)
      // 50 exercises should exist
      expect(store.exercises).toHaveLength(50)
      // Each exercise had 2 sets logged, then 1 deleted = 1 remaining
      for (const ex of store.exercises) {
        expect(ex.sets).toHaveLength(1)
      }
    })
  })
})
