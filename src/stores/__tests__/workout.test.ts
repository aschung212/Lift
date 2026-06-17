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

  // ── archiveExercise / unarchiveExercise (LIFT-434) ─────────────
  describe('archiveExercise / unarchiveExercise', () => {
    it('marks an exercise as archived without removing it', () => {
      const store = useWorkoutStore()
      store.addExercise('Bench')
      const id = store.exercises[0].id
      store.archiveExercise(id)
      expect(store.exercises).toHaveLength(1)
      expect(store.exercises[0].archived_at).toBeTruthy()
    })

    it('removes the exercise from activeExercises but keeps it in archivedExercises', () => {
      const store = useWorkoutStore()
      store.addExercise('Bench')
      store.addExercise('Squat')
      const benchId = store.exercises[0].id
      store.archiveExercise(benchId)
      expect(store.activeExercises.map(e => e.name)).toEqual(['Squat'])
      expect(store.archivedExercises.map(e => e.name)).toEqual(['Bench'])
    })

    it('preserves sets on an archived exercise', () => {
      const store = useWorkoutStore()
      store.addExercise('Bench')
      const id = store.exercises[0].id
      store.logSet(id, 135, 5)
      store.logSet(id, 145, 5)
      store.archiveExercise(id)
      expect(store.exercises[0].sets).toHaveLength(2)
      expect(store.getExercisePR(id)).toBeGreaterThan(0)
    })

    it('unarchives an exercise by clearing archived_at', () => {
      const store = useWorkoutStore()
      store.addExercise('Bench')
      const id = store.exercises[0].id
      store.archiveExercise(id)
      expect(store.archivedExercises).toHaveLength(1)
      store.unarchiveExercise(id)
      expect(store.archivedExercises).toHaveLength(0)
      expect(store.activeExercises).toHaveLength(1)
      expect(store.exercises[0].archived_at).toBeUndefined()
    })

    it('is idempotent — archiving an already-archived exercise does not overwrite the timestamp', () => {
      const store = useWorkoutStore()
      store.addExercise('Bench')
      const id = store.exercises[0].id
      store.archiveExercise(id)
      const firstStamp = store.exercises[0].archived_at
      store.archiveExercise(id)
      expect(store.exercises[0].archived_at).toBe(firstStamp)
    })

    it('persists archive state to localStorage', () => {
      const store = useWorkoutStore()
      store.addExercise('Bench')
      const id = store.exercises[0].id
      store.archiveExercise(id)
      const raw = localStorageMock.getItem('workout-exercises')
      expect(raw).toBeTruthy()
      const parsed = JSON.parse(raw!) as Exercise[]
      expect(parsed[0].archived_at).toBeTruthy()
    })

    it('no-ops on unknown exercise id', () => {
      const store = useWorkoutStore()
      store.addExercise('Bench')
      expect(() => store.archiveExercise('nonexistent')).not.toThrow()
      expect(() => store.unarchiveExercise('nonexistent')).not.toThrow()
      expect(store.exercises[0].archived_at).toBeUndefined()
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

  describe('getLastSession', () => {
    it('returns sets from the most recent prior day', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Squat')!
      store.logSet(id, 135, 10, '2026-05-20')
      store.logSet(id, 185, 8, '2026-05-20')
      store.logSet(id, 225, 5, '2026-05-22')
      const session = store.getLastSession(id, '2026-05-25')
      expect(session).not.toBeNull()
      expect(session!.date).toBe('2026-05-22')
      expect(session!.sets).toHaveLength(1)
      expect(session!.sets[0].weight).toBe(225)
    })

    it('returns multiple sets from the same day', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench')!
      store.logSet(id, 135, 10, '2026-05-20')
      store.logSet(id, 155, 8, '2026-05-20')
      store.logSet(id, 175, 5, '2026-05-20')
      const session = store.getLastSession(id, '2026-05-25')
      expect(session).not.toBeNull()
      expect(session!.date).toBe('2026-05-20')
      expect(session!.sets).toHaveLength(3)
    })

    it('excludes today from last session', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Deadlift')!
      store.logSet(id, 315, 5, '2026-05-25')
      store.logSet(id, 275, 8, '2026-05-23')
      const session = store.getLastSession(id, '2026-05-25')
      expect(session).not.toBeNull()
      expect(session!.date).toBe('2026-05-23')
      expect(session!.sets).toHaveLength(1)
    })

    it('returns null for non-existent exercise', () => {
      const store = useWorkoutStore()
      expect(store.getLastSession('fake')).toBeNull()
    })

    it('returns null when all sets are from today', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('OHP')!
      store.logSet(id, 95, 10, '2026-05-25')
      expect(store.getLastSession(id, '2026-05-25')).toBeNull()
    })

    it('returns null for exercise with no sets', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Rows')!
      expect(store.getLastSession(id, '2026-05-25')).toBeNull()
    })
  })

  describe('getUsualLadder', () => {
    const TODAY = '2026-05-25'
    const BENCH_LADDER: Array<[number, number]> = [[45, 10], [95, 10], [135, 10], [185, 10], [225, 10], [275, 10]]

    function logSessions(
      store: ReturnType<typeof useWorkoutStore>,
      exId: string,
      days: string[],
      ladder: Array<[number, number]>,
    ) {
      for (const day of days) {
        for (const [weight, reps] of ladder) store.logSet(exId, weight, reps, day)
      }
    }

    it('detects a repeated warm-up ladder across 4 identical sessions', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench')!
      logSessions(store, id, ['2026-05-01', '2026-05-08', '2026-05-15', '2026-05-22'], BENCH_LADDER)
      const ladder = store.getUsualLadder(id, TODAY)
      expect(ladder).not.toBeNull()
      expect(ladder!.sessionsSampled).toBe(4)
      expect(ladder!.consensusCount).toBe(6)
      expect(ladder!.rungs).toHaveLength(6)
      expect(ladder!.rungs.map(r => [r.weightLbs, r.reps])).toEqual(BENCH_LADDER)
      expect(ladder!.rungs.every(r => r.source === 'consensus')).toBe(true)
    })

    it('tolerates 2 deviant sessions in a 6-session window', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench')!
      logSessions(store, id, ['2026-05-01', '2026-05-08', '2026-05-15', '2026-05-22'], BENCH_LADDER)
      // Two deviant days (a deload and an experiment) interleaved
      logSessions(store, id, ['2026-05-10'], [[45, 15], [65, 15], [85, 15]])
      logSessions(store, id, ['2026-05-18'], [[100, 5], [150, 5], [200, 5], [250, 2]])
      const ladder = store.getUsualLadder(id, TODAY)
      expect(ladder).not.toBeNull()
      expect(ladder!.sessionsSampled).toBe(6)
      // 4/6 support clears the max(3, ceil(0.6×6)=4) threshold at every position
      expect(ladder!.rungs.slice(0, 6).map(r => [r.weightLbs, r.reps])).toEqual(BENCH_LADDER)
    })

    it('requires unanimity at exactly 3 sessions (1 deviant of 3 → null)', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench')!
      logSessions(store, id, ['2026-05-08', '2026-05-15'], BENCH_LADDER)
      logSessions(store, id, ['2026-05-22'], [[100, 5], [150, 5], [200, 5]])
      // support threshold is max(3, ceil(0.6×3)=2) = 3 → 2/3 fails everywhere
      expect(store.getUsualLadder(id, TODAY)).toBeNull()
    })

    it('returns null with fewer than 3 prior sessions', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench')!
      logSessions(store, id, ['2026-05-15', '2026-05-22'], BENCH_LADDER)
      expect(store.getUsualLadder(id, TODAY)).toBeNull()
    })

    it("excludes today's sets from detection", () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench')!
      logSessions(store, id, ['2026-05-01', '2026-05-08', '2026-05-15'], BENCH_LADDER)
      // Today the user is mid-deviation — must not affect the ladder
      logSessions(store, id, [TODAY], [[300, 1], [305, 1]])
      const ladder = store.getUsualLadder(id, TODAY)
      expect(ladder).not.toBeNull()
      expect(ladder!.sessionsSampled).toBe(3)
      expect(ladder!.rungs.map(r => [r.weightLbs, r.reps])).toEqual(BENCH_LADDER)
    })

    it('truncates the consensus prefix at the first unsupported position', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench')!
      const days = ['2026-05-01', '2026-05-08', '2026-05-15', '2026-05-22']
      days.forEach((day, i) => {
        logSessions(store, id, [day], [[45, 10], [95, 10], [135, 10], [150 + i * 20, 5]])
      })
      const ladder = store.getUsualLadder(id, TODAY)
      expect(ladder).not.toBeNull()
      expect(ladder!.consensusCount).toBe(3)
      // Position 4 drifts 20 lbs per session → carried from the newest session as a 'recent' tail
      expect(ladder!.rungs).toHaveLength(4)
      expect(ladder!.rungs[3]).toEqual({ weightLbs: 210, reps: 5, source: 'recent' })
    })

    it('keeps repeated working sets as separate rungs (3×225)', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Squat')!
      logSessions(store, id, ['2026-05-01', '2026-05-08', '2026-05-15'], [[135, 10], [225, 5], [225, 5], [225, 5]])
      const ladder = store.getUsualLadder(id, TODAY)
      expect(ladder).not.toBeNull()
      expect(ladder!.rungs.map(r => [r.weightLbs, r.reps])).toEqual([[135, 10], [225, 5], [225, 5], [225, 5]])
    })

    it('clusters kg-entered float weights within 1 lb and returns the newest raw value', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('OHP')!
      // 60 kg re-entered across sessions with conversion drift (all within 1 lb)
      logSessions(store, id, ['2026-05-01'], [[132.0, 8], [154.0, 5], [176.0, 3]])
      logSessions(store, id, ['2026-05-08'], [[132.5, 8], [154.5, 5], [176.5, 3]])
      logSessions(store, id, ['2026-05-15'], [[132.277, 8], [154.324, 5], [176.37, 3]])
      const ladder = store.getUsualLadder(id, TODAY)
      expect(ladder).not.toBeNull()
      expect(ladder!.consensusCount).toBe(3)
      // Newest session's raw floats come back, so kg users see their own numbers
      expect(ladder!.rungs.map(r => r.weightLbs)).toEqual([132.277, 154.324, 176.37])
    })

    it('survives a deload in the most recent session', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench')!
      logSessions(store, id, ['2026-05-01', '2026-05-08', '2026-05-15', '2026-05-22'], BENCH_LADDER)
      logSessions(store, id, ['2026-05-24'], [[45, 15], [65, 15], [85, 15]])
      const ladder = store.getUsualLadder(id, TODAY)
      expect(ladder).not.toBeNull()
      // Deload weights lose the cluster vote 4-to-1; rung values stay on the ladder
      expect(ladder!.rungs.slice(0, 6).map(r => [r.weightLbs, r.reps])).toEqual(BENCH_LADDER)
    })

    it('drops the recent tail when the newest session deviated from the ladder', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench')!
      const ladder: Array<[number, number]> = [[45, 10], [95, 10], [135, 10], [185, 10]]
      logSessions(store, id, ['2026-05-01', '2026-05-08', '2026-05-15', '2026-05-22'], ladder)
      // Newest session is a LONG deload — without the on-ladder guard its
      // later sets would leak in as contradictory rungs after the top set
      logSessions(store, id, ['2026-05-24'], [[45, 15], [65, 15], [85, 15], [105, 15], [125, 15], [145, 15]])
      const usual = store.getUsualLadder(id, TODAY)
      expect(usual).not.toBeNull()
      expect(usual!.consensusCount).toBe(4)
      expect(usual!.rungs).toHaveLength(4)
      expect(usual!.rungs.map(r => r.weightLbs)).toEqual([45, 95, 135, 185])
    })

    it('returns null when only 2 positions are established', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Curls')!
      logSessions(store, id, ['2026-05-01', '2026-05-08', '2026-05-15'], [[30, 12], [40, 10]])
      expect(store.getUsualLadder(id, TODAY)).toBeNull()
    })

    it('uses modal reps with ties broken toward the newest session', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Rows')!
      logSessions(store, id, ['2026-05-01'], [[100, 10], [120, 12], [140, 10]])
      logSessions(store, id, ['2026-05-08'], [[100, 10], [120, 8], [140, 10]])
      logSessions(store, id, ['2026-05-15'], [[100, 8], [120, 8], [140, 10]])
      logSessions(store, id, ['2026-05-22'], [[100, 8], [120, 8], [140, 10]])
      const ladder = store.getUsualLadder(id, TODAY)
      expect(ladder).not.toBeNull()
      // Position 1: reps tie 2×10 vs 2×8 → newest session (8) wins
      expect(ladder!.rungs[0].reps).toBe(8)
      // Position 2: mode (3×8) beats the newest-adjacent outlier (1×12)
      expect(ladder!.rungs[1].reps).toBe(8)
    })

    it('caps the ladder at 10 rungs', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Volume Day')!
      const twelveSets: Array<[number, number]> = Array.from({ length: 12 }, (_, i) => [100 + i * 10, 5])
      logSessions(store, id, ['2026-05-01', '2026-05-08', '2026-05-15'], twelveSets)
      const ladder = store.getUsualLadder(id, TODAY)
      expect(ladder).not.toBeNull()
      expect(ladder!.rungs).toHaveLength(10)
    })

    it('returns null for non-existent exercise', () => {
      const store = useWorkoutStore()
      expect(store.getUsualLadder('fake', TODAY)).toBeNull()
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
      expect(suggestion!.confidence).toBe('high')
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
      // Consolidation advice fires after almost any weight bump — never nudge-worthy
      expect(suggestion!.confidence).toBe('low')
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
      expect(suggestion!.confidence).toBe('high')
    })

    it('marks mid-progression rep advice as low confidence', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench')!
      // Low-rep build at the same weight (3 → 4 reps stays under the
      // branch-1 threshold of 5) → "keep building" advice
      addSetsOnDays(store, id, [
        { date: '2026-03-01', weight: 135, reps: 3 },
        { date: '2026-03-03', weight: 135, reps: 3 },
        { date: '2026-03-05', weight: 135, reps: 4 },
      ])
      const suggestion = store.getOverloadSuggestion(id)
      expect(suggestion).not.toBeNull()
      expect(suggestion!.type).toBe('increase_reps')
      expect(suggestion!.confidence).toBe('low')
    })

    it('excludes an in-progress today session when today is passed (#741)', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench')!
      addSetsOnDays(store, id, [
        { date: '2026-03-01', weight: 275, reps: 10 },
        { date: '2026-03-08', weight: 275, reps: 10 },
        { date: '2026-03-15', weight: 275, reps: 10 },
        // Mid-workout today: warm-ups logged, top set still ahead
        { date: '2026-03-22', weight: 45, reps: 10 },
        { date: '2026-03-22', weight: 135, reps: 10 },
      ])
      // Without exclusion, today's 135 reads as the latest top set → wrong branch
      expect(store.getOverloadSuggestion(id)!.confidence).toBe('low')
      // With exclusion, the consistent 275×10 sessions yield the real signal
      const suggestion = store.getOverloadSuggestion(id, '2026-03-22')
      expect(suggestion).not.toBeNull()
      expect(suggestion!.type).toBe('increase_weight')
      expect(suggestion!.weight).toBe(280)
      expect(suggestion!.confidence).toBe('high')
    })

    it('marks the default add-a-rep fallback as low confidence', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench')!
      // Weights trending down — fallback branch
      addSetsOnDays(store, id, [
        { date: '2026-03-01', weight: 200, reps: 5 },
        { date: '2026-03-03', weight: 185, reps: 5 },
        { date: '2026-03-05', weight: 175, reps: 5 },
      ])
      const suggestion = store.getOverloadSuggestion(id)
      expect(suggestion).not.toBeNull()
      expect(suggestion!.type).toBe('increase_reps')
      expect(suggestion!.confidence).toBe('low')
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
      store.addExercise('Sample Exercise', [], { sync: false })
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

    // SEV1 2026-04-12 structural tests (READ path is read-only) consolidated
    // into architecturalInvariants.test.ts (LIFT-653).

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

  // ── setExerciseWarmupScheme (LIFT-725) ──────────────────────────
  describe('setExerciseWarmupScheme', () => {
    it('stores a custom scheme and persists it to localStorage', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Bench Press', [])
      store.setExerciseWarmupScheme(id, [{ pct: 0.5, reps: 6 }, { pct: 0.8, reps: 2 }])

      expect(store.exercises[0].warmupScheme).toEqual([{ pct: 0.5, reps: 6 }, { pct: 0.8, reps: 2 }])
      const persisted = JSON.parse(localStorageMock.getItem('workout-exercises')!)
      expect(persisted[0].warmupScheme).toEqual([{ pct: 0.5, reps: 6 }, { pct: 0.8, reps: 2 }])
    })

    it('sanitizes out-of-range steps before storing', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Squat', [])
      store.setExerciseWarmupScheme(id, [{ pct: 5, reps: 0 }] as never)
      // pct clamped to 0.95, reps clamped to 1.
      expect(store.exercises[0].warmupScheme).toEqual([{ pct: 0.95, reps: 1 }])
    })

    it('keeps an empty scheme as "no warmup ramp"', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Deadlift', [])
      store.setExerciseWarmupScheme(id, [])
      expect(store.exercises[0].warmupScheme).toEqual([])
    })

    it('clears the override when passed null', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Row', [])
      store.setExerciseWarmupScheme(id, [{ pct: 0.5, reps: 5 }])
      store.setExerciseWarmupScheme(id, null)
      expect(store.exercises[0].warmupScheme).toBeUndefined()
      expect('warmupScheme' in store.exercises[0]).toBe(false)
    })

    it('is a no-op for an unknown exercise id', () => {
      const store = useWorkoutStore()
      expect(() => store.setExerciseWarmupScheme('nope', [{ pct: 0.5, reps: 5 }])).not.toThrow()
    })
  })
})
