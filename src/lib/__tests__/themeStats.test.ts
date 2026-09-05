import { describe, it, expect } from 'vitest'
import { computeThemeStats, computeAllThemeStats } from '../themeStats'
import type { Exercise } from '../../stores/workout'
import type { SetXPEntry } from '../../stores/progression'

function makeExercise(
  name: string,
  sets: { id: string; weight: number; reps: number; date: string; bodyweight?: number }[],
  bodyweightLoaded = false,
): Exercise {
  return {
    id: `ex-${name}`,
    name,
    tags: [],
    ...(bodyweightLoaded ? { bodyweightLoaded: true } : {}),
    sets: sets.map(s => ({
      ...s,
      estimated1RM: s.reps === 1 ? Math.round(s.weight) : Math.round(s.weight * (1 + s.reps / 30)),
    })),
  }
}

function makeEntry(overrides: Partial<SetXPEntry> = {}): SetXPEntry {
  return { xp: 72, theme: 'fire', epoch: 1, zone: 'working', isPR: false, isRepPR: false, ...overrides }
}

describe('themeStats', () => {
  describe('computeThemeStats', () => {
    it('returns zeros for a theme with no data', () => {
      const stats = computeThemeStats('fire', {}, [])
      expect(stats.totalSets).toBe(0)
      expect(stats.totalXP).toBe(0)
      expect(stats.avgXPPerSet).toBe(0)
      expect(stats.favoriteExercise).toBeNull()
    })

    it('counts sets and XP for a single theme', () => {
      const xpPerSet: Record<string, SetXPEntry> = {
        's1': makeEntry({ xp: 54 }),
        's2': makeEntry({ xp: 89 }),
        's3': makeEntry({ xp: 200, zone: 'tie' }),
      }
      const exercises = [makeExercise('Bench', [
        { id: 's1', weight: 135, reps: 5, date: '2026-04-01T12:00:00Z' },
        { id: 's2', weight: 185, reps: 3, date: '2026-04-01T14:00:00Z' },
        { id: 's3', weight: 225, reps: 1, date: '2026-04-02T12:00:00Z' },
      ])]

      const stats = computeThemeStats('fire', xpPerSet, exercises)
      expect(stats.totalSets).toBe(3)
      expect(stats.totalXP).toBe(343)
      expect(stats.avgXPPerSet).toBe(114)
      expect(stats.totalReps).toBe(9) // 5+3+1
      expect(stats.totalVolume).toBe(135*5 + 185*3 + 225*1) // 675+555+225=1455
      expect(stats.daysUsed).toBe(2) // Apr 1 and Apr 2
    })

    // #1333 — the per-theme volume stat flattened each set into a lookup that
    // dropped the exercise, then summed the raw `set.weight`. A theme worn
    // through a calisthenics block reported a fraction of the work done in it.
    it('folds bodyweight into the volume of a bodyweight-loaded exercise (#1333)', () => {
      const xpPerSet: Record<string, SetXPEntry> = {
        's1': makeEntry({ xp: 60 }),
        's2': makeEntry({ xp: 70 }),
      }
      const exercises = [
        makeExercise(
          'Pull-ups',
          [
            { id: 's1', weight: 0, reps: 10, date: '2026-04-01T12:00:00Z', bodyweight: 185 },
            { id: 's2', weight: 25, reps: 6, date: '2026-04-01T12:05:00Z', bodyweight: 185 },
          ],
          true,
        ),
      ]

      const stats = computeThemeStats('fire', xpPerSet, exercises)
      // Before the fix: 0*10 + 25*6 = 150.
      expect(stats.totalVolume).toBe(185 * 10 + 210 * 6)
    })

    it('leaves a normal lift’s volume alone when its sets carry a bodyweight', () => {
      const xpPerSet: Record<string, SetXPEntry> = { 's1': makeEntry({ xp: 60 }) }
      const exercises = [
        makeExercise('Squat', [
          { id: 's1', weight: 225, reps: 5, date: '2026-04-01T12:00:00Z', bodyweight: 185 },
        ]),
      ]
      expect(computeThemeStats('fire', xpPerSet, exercises).totalVolume).toBe(1125)
    })

    it('ignores sets from other themes', () => {
      const xpPerSet: Record<string, SetXPEntry> = {
        's1': makeEntry({ theme: 'fire', xp: 50 }),
        's2': makeEntry({ theme: 'water', xp: 100 }),
      }
      const stats = computeThemeStats('fire', xpPerSet, [])
      expect(stats.totalSets).toBe(1)
      expect(stats.totalXP).toBe(50)
    })

    it('ignores legacy number entries', () => {
      const xpPerSet: Record<string, SetXPEntry | number> = {
        's1': 50, // legacy format — no theme tag
        's2': makeEntry({ theme: 'fire', xp: 100 }),
      }
      const stats = computeThemeStats('fire', xpPerSet, [])
      expect(stats.totalSets).toBe(1)
      expect(stats.totalXP).toBe(100)
    })

    it('counts PRs and rep PRs', () => {
      const xpPerSet: Record<string, SetXPEntry> = {
        's1': makeEntry({ isPR: true, zone: 'pr' }),
        's2': makeEntry({ isRepPR: true }),
        's3': makeEntry({ isPR: true, zone: 'pr' }),
        's4': makeEntry(),
      }
      const stats = computeThemeStats('fire', xpPerSet, [])
      expect(stats.prCount).toBe(2)
      expect(stats.repPRCount).toBe(1)
    })

    it('computes zone breakdown', () => {
      const xpPerSet: Record<string, SetXPEntry> = {
        's1': makeEntry({ zone: 'warmup' }),
        's2': makeEntry({ zone: 'working' }),
        's3': makeEntry({ zone: 'working' }),
        's4': makeEntry({ zone: 'pr' }),
        's5': makeEntry({ zone: 'tie' }),
      }
      const stats = computeThemeStats('fire', xpPerSet, [])
      expect(stats.zoneBreakdown).toEqual({
        warmup: 1, working: 2, pr: 1, tie: 1, newExercise: 0,
      })
    })

    it('finds favorite exercise', () => {
      const exercises = [
        makeExercise('Bench', [
          { id: 's1', weight: 135, reps: 5, date: '2026-04-01T12:00:00Z' },
          { id: 's2', weight: 135, reps: 5, date: '2026-04-01T12:00:00Z' },
          { id: 's3', weight: 135, reps: 5, date: '2026-04-01T12:00:00Z' },
        ]),
        makeExercise('Squat', [
          { id: 's4', weight: 225, reps: 5, date: '2026-04-01T12:00:00Z' },
        ]),
      ]
      const xpPerSet: Record<string, SetXPEntry> = {
        's1': makeEntry(), 's2': makeEntry(), 's3': makeEntry(), 's4': makeEntry(),
      }
      const stats = computeThemeStats('fire', xpPerSet, exercises)
      expect(stats.favoriteExercise).toEqual({ name: 'Bench', sets: 3 })
    })

    it('computes date range', () => {
      const exercises = [makeExercise('Bench', [
        { id: 's1', weight: 135, reps: 5, date: '2026-03-01T12:00:00Z' },
        { id: 's2', weight: 135, reps: 5, date: '2026-04-15T12:00:00Z' },
      ])]
      const xpPerSet: Record<string, SetXPEntry> = {
        's1': makeEntry(), 's2': makeEntry(),
      }
      const stats = computeThemeStats('fire', xpPerSet, exercises)
      expect(stats.firstSetDate).toBe('2026-03-01T12:00:00Z')
      expect(stats.lastSetDate).toBe('2026-04-15T12:00:00Z')
    })
  })

  describe('computeAllThemeStats', () => {
    it('returns stats for all themes with data', () => {
      const xpPerSet: Record<string, SetXPEntry> = {
        's1': makeEntry({ theme: 'fire' }),
        's2': makeEntry({ theme: 'fire' }),
        's3': makeEntry({ theme: 'water' }),
      }
      const results = computeAllThemeStats(xpPerSet, [])
      expect(results).toHaveLength(2)
      expect(results[0].themeId).toBe('fire') // most sets first
      expect(results[0].totalSets).toBe(2)
      expect(results[1].themeId).toBe('water')
      expect(results[1].totalSets).toBe(1)
    })

    it('returns empty array when no enriched entries', () => {
      const xpPerSet: Record<string, number> = { 's1': 50 }
      const results = computeAllThemeStats(xpPerSet, [])
      expect(results).toEqual([])
    })
  })
})
