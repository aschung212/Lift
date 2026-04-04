import { describe, it, expect, beforeEach } from 'vitest'
import { getLocalStorageMock } from '../../__tests__/helpers'
import {
  computeRetroactiveXP,
  isMigrated,
  markMigrated,
  clearMigrationFlag,
} from '../xpMigration'
import type { Exercise } from '../../stores/workout'
import type { BodyweightEntry } from '../../stores/bodyweight'

const localStorageMock = getLocalStorageMock()

function makeExercise(name: string, sets: { weight: number; reps: number; date: string }[]): Exercise {
  return {
    id: `ex-${name}`,
    name,
    tags: [],
    sets: sets.map((s, i) => ({
      id: `${name}-set-${i}`,
      date: s.date,
      weight: s.weight,
      reps: s.reps,
      estimated1RM: s.reps === 1 ? Math.round(s.weight) : Math.round(s.weight * (1 + s.reps / 30)),
    })),
  }
}

describe('xpMigration', () => {
  beforeEach(() => {
    localStorageMock.clear()
  })

  describe('migration flag', () => {
    it('isMigrated returns false by default', () => {
      expect(isMigrated()).toBe(false)
    })

    it('markMigrated sets the flag', () => {
      markMigrated()
      expect(isMigrated()).toBe(true)
    })

    it('clearMigrationFlag resets the flag', () => {
      markMigrated()
      clearMigrationFlag()
      expect(isMigrated()).toBe(false)
    })
  })

  describe('computeRetroactiveXP', () => {
    it('returns 0 XP for empty data', () => {
      const result = computeRetroactiveXP([], [])
      expect(result.totalXP).toBe(0)
      expect(result.xpPerSet).toEqual({})
      expect(result.bodyweightXPDates).toEqual([])
    })

    it('awards flat 50 XP for first 3 sets of a new exercise', () => {
      const ex = makeExercise('Bench', [
        { weight: 135, reps: 5, date: '2026-01-01T12:00:00Z' },
        { weight: 135, reps: 5, date: '2026-01-02T12:00:00Z' },
        { weight: 135, reps: 5, date: '2026-01-03T12:00:00Z' },
      ])
      const result = computeRetroactiveXP([ex], [])
      expect(result.xpPerSet['Bench-set-0']).toBe(50)
      expect(result.xpPerSet['Bench-set-1']).toBe(50)
      expect(result.xpPerSet['Bench-set-2']).toBe(50)
      expect(result.totalXP).toBe(150)
    })

    it('uses normal formula after 3rd set', () => {
      const ex = makeExercise('Bench', [
        { weight: 135, reps: 5, date: '2026-01-01T12:00:00Z' },
        { weight: 135, reps: 5, date: '2026-01-02T12:00:00Z' },
        { weight: 135, reps: 5, date: '2026-01-03T12:00:00Z' },
        { weight: 135, reps: 5, date: '2026-01-04T12:00:00Z' }, // 4th set, same weight = tie
      ])
      const result = computeRetroactiveXP([ex], [])
      // 4th set: estimated1RM = 158, best from prior 3 = 158 → tie → 200
      expect(result.xpPerSet['Bench-set-3']).toBe(200) // tie: 1.0 * 100 * 2
    })

    it('processes sets in chronological order', () => {
      // Sets added out of order — migration should sort by date
      const ex = makeExercise('Squat', [
        { weight: 225, reps: 5, date: '2026-03-01T12:00:00Z' }, // later
        { weight: 135, reps: 5, date: '2026-01-01T12:00:00Z' }, // earlier
        { weight: 185, reps: 5, date: '2026-02-01T12:00:00Z' }, // middle
      ])
      const result = computeRetroactiveXP([ex], [])
      // All 3 should get flat 50 (new exercise), processed 135→185→225
      expect(result.xpPerSet['Squat-set-1']).toBe(50) // 135 (earliest)
      expect(result.xpPerSet['Squat-set-2']).toBe(50) // 185
      expect(result.xpPerSet['Squat-set-0']).toBe(50) // 225 (latest)
    })

    it('awards PR XP when beating best 1RM', () => {
      const ex = makeExercise('Deadlift', [
        { weight: 315, reps: 5, date: '2026-01-01T12:00:00Z' },
        { weight: 315, reps: 5, date: '2026-01-02T12:00:00Z' },
        { weight: 315, reps: 5, date: '2026-01-03T12:00:00Z' },
        { weight: 405, reps: 1, date: '2026-01-10T12:00:00Z' }, // PR!
      ])
      const result = computeRetroactiveXP([ex], [])
      // 4th set: estimated1RM = 405, best from prior 3 = 368 (315*1.167)
      // ratio = 405/368 = 1.1 → PR zone: 1.1 * 100 * 3 = 330
      const prXP = result.xpPerSet['Deadlift-set-3']
      expect(prXP).toBeGreaterThan(200) // definitely PR tier
    })

    it('handles multiple exercises independently', () => {
      const bench = makeExercise('Bench', [
        { weight: 135, reps: 5, date: '2026-01-01T12:00:00Z' },
      ])
      const squat = makeExercise('Squat', [
        { weight: 225, reps: 5, date: '2026-01-01T12:00:00Z' },
      ])
      const result = computeRetroactiveXP([bench, squat], [])
      // Both first sets → 50 each
      expect(result.xpPerSet['Bench-set-0']).toBe(50)
      expect(result.xpPerSet['Squat-set-0']).toBe(50)
      expect(result.totalXP).toBe(100)
    })

    it('awards 100 XP per unique bodyweight date', () => {
      const entries: BodyweightEntry[] = [
        { id: 'bw1', date: '2026-01-01T12:00:00Z', weight: 180 },
        { id: 'bw2', date: '2026-01-02T12:00:00Z', weight: 179 },
        { id: 'bw3', date: '2026-01-01T18:00:00Z', weight: 181 }, // same date as bw1
      ]
      const result = computeRetroactiveXP([], entries)
      expect(result.bodyweightXPDates).toHaveLength(2)
      expect(result.bodyweightXP).toBe(200)
      expect(result.totalXP).toBe(200)
    })

    it('combines set XP and bodyweight XP', () => {
      const ex = makeExercise('Bench', [
        { weight: 135, reps: 5, date: '2026-01-01T12:00:00Z' },
      ])
      const bw: BodyweightEntry[] = [
        { id: 'bw1', date: '2026-01-01T12:00:00Z', weight: 180 },
      ]
      const result = computeRetroactiveXP([ex], bw)
      expect(result.totalXP).toBe(150) // 50 (set) + 100 (bodyweight)
    })

    it('is idempotent — running twice produces the same result', () => {
      const ex = makeExercise('Bench', [
        { weight: 135, reps: 5, date: '2026-01-01T12:00:00Z' },
        { weight: 185, reps: 3, date: '2026-01-15T12:00:00Z' },
        { weight: 225, reps: 1, date: '2026-02-01T12:00:00Z' },
      ])
      const bw: BodyweightEntry[] = [
        { id: 'bw1', date: '2026-01-01T12:00:00Z', weight: 180 },
      ]
      const result1 = computeRetroactiveXP([ex], bw)
      const result2 = computeRetroactiveXP([ex], bw)
      expect(result1.totalXP).toBe(result2.totalXP)
      expect(result1.xpPerSet).toEqual(result2.xpPerSet)
      expect(result1.bodyweightXPDates).toEqual(result2.bodyweightXPDates)
    })

    it('applies no streak multiplier (all pre-migration sets get 1.0x)', () => {
      const ex = makeExercise('Bench', [
        { weight: 135, reps: 5, date: '2026-01-01T12:00:00Z' },
      ])
      const result = computeRetroactiveXP([ex], [])
      // First set = flat 50, no multiplier applied
      expect(result.xpPerSet['Bench-set-0']).toBe(50)
    })
  })
})
