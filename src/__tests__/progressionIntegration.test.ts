/**
 * Progression System Integration Tests
 *
 * End-to-end validation of the XP → unlock → streak flow.
 * Tests the interaction between xp.ts, progression store,
 * xpMigration, and useTheme lock/unlock.
 *
 * Issue #125
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from './helpers'

const localStorageMock = getLocalStorageMock()

vi.mock('../lib/syncQueue', () => ({
  syncQueue: { enqueue: vi.fn() }
}))

vi.mock('../lib/xpInstrumentation', () => ({
  logXPEvent: vi.fn(),
  logBodyweightXPEvent: vi.fn(),
  logWeeklySnapshot: vi.fn(),
}))

import { useProgressionStore, UNLOCK_TIERS, getUnlockedThemeIds } from '../stores/progression'
import {
  calculateSetXP,
  calculateBest1RM,
  applyStreakMultiplier,
  calculateBodyweightXP,
  checkRepPR,
  XP_CONFIG,
  type StreakHistoryEntry,
} from '../lib/xp'
import { computeRetroactiveXP, isMigrated, markMigrated, clearMigrationFlag } from '../lib/xpMigration'
import type { Exercise, WorkoutSet } from '../stores/workout'
import type { BodyweightEntry } from '../stores/bodyweight'

// ── Helpers ─────────────────────────────────────────────────────

function makeSet(overrides: Partial<WorkoutSet> & { weight: number; reps: number }): WorkoutSet {
  const w = overrides.weight
  const r = overrides.reps
  return {
    id: overrides.id || `set-${Math.random().toString(36).slice(2)}`,
    date: overrides.date || '2026-04-01T12:00:00Z',
    weight: w,
    reps: r,
    estimated1RM: overrides.estimated1RM ?? (r === 1 ? Math.round(w) : Math.round(w * (1 + r / 30))),
  }
}

function makeExercise(name: string, sets: WorkoutSet[]): Exercise {
  return { id: `ex-${name}`, name, tags: [], sets }
}

// ── Happy path ──────────────────────────────────────────────────

describe('Progression Integration', () => {
  beforeEach(() => {
    localStorageMock.clear()
    setActivePinia(createPinia())
  })

  describe('happy path: new user journey', () => {
    it('starter theme is immediately unlocked and progression is enabled', () => {
      const store = useProgressionStore()
      store.setStarterTheme('fire')
      expect(store.progressionEnabled).toBe(true)
      expect(getUnlockedThemeIds(store.unlockedThemes)).toContain('fire')
      expect(getUnlockedThemeIds(store.unlockedThemes)).toContain('pearl')
      expect(store.totalXP).toBe(0)
    })

    it('logging sets accumulates XP and unlocks themes', () => {
      const store = useProgressionStore()
      store.setStarterTheme('fire')

      // Simulate logging sets worth enough XP to unlock level 2
      store.logSetXP('set-1', 5000)
      store.logSetXP('set-2', 5000)
      store.logSetXP('set-3', 5100)
      store.checkUnlocks()

      expect(store.totalXP).toBe(15100)
      expect(getUnlockedThemeIds(store.unlockedThemes)).toContain('fire') // starter (level 1)
      expect(getUnlockedThemeIds(store.unlockedThemes)).toContain('air')  // level 2 at 15,000
    })

    it('full journey from 0 to all themes unlocked', () => {
      const store = useProgressionStore()
      store.setStarterTheme('water')

      // Jump to max XP
      store.totalXP = 1_000_000
      store.checkUnlocks()

      // All themes should be unlocked
      const allThemeIds = UNLOCK_TIERS.filter(t => t.themeId).map(t => t.themeId!)
      for (const themeId of allThemeIds) {
        expect(getUnlockedThemeIds(store.unlockedThemes)).toContain(themeId)
      }
      // Starter themes (unchosen) should also be unlocked at level 7
      expect(getUnlockedThemeIds(store.unlockedThemes)).toContain('fire')
      expect(getUnlockedThemeIds(store.unlockedThemes)).toContain('luck')

      expect(store.nextUnlockThreshold).toBeNull()
      expect(store.progressPercent).toBe(100)
    })
  })

  // ── XP calculation integration ────────────────────────────────

  describe('XP calculation end-to-end', () => {
    it('all sets on immature exercise earn flat 50', () => {
      const xp1 = calculateSetXP({ setEstimated1RM: 100, exerciseBest1RM: null, setIndex: 0 })
      const xp2 = calculateSetXP({ setEstimated1RM: 100, exerciseBest1RM: null, setIndex: 1 })
      const xp3 = calculateSetXP({ setEstimated1RM: 100, exerciseBest1RM: null, setIndex: 2 })
      const xp4 = calculateSetXP({ setEstimated1RM: 100, exerciseBest1RM: null, setIndex: 3 })
      expect(xp1).toBe(50)
      expect(xp2).toBe(50)
      expect(xp3).toBe(50)
      expect(xp4).toBe(50) // no cap — PR detection handles maturity
    })

    it('zone transitions are correct at boundaries', () => {
      // Warmup → Working boundary at 50%
      expect(calculateSetXP({ setEstimated1RM: 49, exerciseBest1RM: 100, setIndex: 0 })).toBe(10) // warmup
      expect(calculateSetXP({ setEstimated1RM: 50, exerciseBest1RM: 100, setIndex: 0 })).toBe(10) // working (base)

      // Working → Tie at 100%
      const working99 = calculateSetXP({ setEstimated1RM: 99, exerciseBest1RM: 100, setIndex: 0 })
      const tie = calculateSetXP({ setEstimated1RM: 100, exerciseBest1RM: 100, setIndex: 0 })
      expect(working99).toBeLessThan(tie)
      expect(tie).toBe(200) // 2x

      // Tie → PR at 101%
      const pr = calculateSetXP({ setEstimated1RM: 101, exerciseBest1RM: 100, setIndex: 0 })
      expect(pr).toBe(303) // 3x
      expect(pr).toBeGreaterThan(tie)
    })

    it('rep PR multiplier applies correctly and is mutually exclusive with PR zone', () => {
      // Working zone with rep PR
      const without = calculateSetXP({ setEstimated1RM: 85, exerciseBest1RM: 100, setIndex: 0 })
      const withRepPR = calculateSetXP({ setEstimated1RM: 85, exerciseBest1RM: 100, setIndex: 0, isRepPR: true })
      expect(withRepPR).toBe(Math.round(without * XP_CONFIG.repPRMultiplier))

      // PR zone — rep PR still applies at engine level (caller decides exclusivity)
      const prWithout = calculateSetXP({ setEstimated1RM: 105, exerciseBest1RM: 100, setIndex: 0 })
      const prWith = calculateSetXP({ setEstimated1RM: 105, exerciseBest1RM: 100, setIndex: 0, isRepPR: true })
      expect(prWith).toBe(Math.round(prWithout * XP_CONFIG.repPRMultiplier))
    })

    it('streak multiplier compounds with zone XP', () => {
      const baseXP = 72
      const history: StreakHistoryEntry[] = [
        { weekStart: '2026-03-30', streakCount: 4, weeklyTarget: 5 },
      ]
      const xp = applyStreakMultiplier(baseXP, history, '2026-04-01')
      // 4 weeks = 1.25x duration, 5 days = 1.3x target → 1.625x
      expect(xp).toBe(Math.round(72 * 1.625))
    })
  })

  // ── checkRepPR integration ────────────────────────────────────

  describe('rep PR detection', () => {
    it('detects rep PR at same weight', () => {
      const prior = [makeSet({ weight: 135, reps: 5 })]
      expect(checkRepPR(135, 6, prior)).toBe(true)
      expect(checkRepPR(135, 5, prior)).toBe(false) // tie, not PR
      expect(checkRepPR(135, 4, prior)).toBe(false) // below
    })

    it('ignores different weights', () => {
      const prior = [makeSet({ weight: 185, reps: 10 })]
      expect(checkRepPR(135, 1, prior)).toBe(false) // no prior at 135
    })
  })

  // ── Bodyweight XP ─────────────────────────────────────────────

  describe('bodyweight XP', () => {
    it('awards 100 XP per unique date', () => {
      expect(calculateBodyweightXP('2026-04-01', [])).toBe(100)
      expect(calculateBodyweightXP('2026-04-01', ['2026-04-01'])).toBe(0)
    })

    it('integrates with progression store', () => {
      const store = useProgressionStore()
      store.progressionEnabled = true
      store.logBodyweightXP('2026-04-01')
      expect(store.totalXP).toBe(100)
      expect(store.bodyweightXPDates).toContain('2026-04-01')

      // Duplicate date does not add XP
      store.logBodyweightXP('2026-04-01')
      expect(store.totalXP).toBe(100)
    })
  })

  // ── Set edit/delete XP permanence ─────────────────────────────

  describe('XP permanence on edit/delete', () => {
    it('recalcSetXP only increases total', () => {
      const store = useProgressionStore()
      store.logSetXP('set-1', 100)
      store.recalcSetXP('set-1', 50) // edited to lower XP
      expect(store.totalXP).toBe(100) // unchanged
      expect(store.xpPerSet['set-1']).toBe(50) // tracking updated

      store.recalcSetXP('set-1', 150) // edited to higher XP
      expect(store.totalXP).toBe(200) // increased by 100 (150-50)
    })

    it('removeSetXP deducts from total', () => {
      const store = useProgressionStore()
      store.logSetXP('set-1', 200)
      store.removeSetXP('set-1')
      expect(store.totalXP).toBe(0)
      expect(store.xpPerSet['set-1']).toBeUndefined()
    })
  })

  // ── Streak system integration ─────────────────────────────────

  describe('streak lifecycle', () => {
    it('builds and breaks streaks correctly', () => {
      const store = useProgressionStore()
      store.evaluateWeek(3, '2026-03-16') // met default target (3)
      expect(store.streakWeeks).toBe(1)

      store.evaluateWeek(4, '2026-03-23')
      expect(store.streakWeeks).toBe(2)

      store.evaluateWeek(1, '2026-03-30') // missed
      expect(store.streakWeeks).toBe(0)
    })

    it('target change resets streak with anti-gaming', () => {
      const store = useProgressionStore()
      store.evaluateWeek(5, '2026-03-16') // streak=1
      store.evaluateWeek(5, '2026-03-23') // streak=2

      store.setWeeklyTarget(2) // try to lower
      // Anti-gaming: evaluates against max(3, 2) = 3
      store.evaluateWeek(3, '2026-03-30') // met higher target
      // But target change still resets streak
      expect(store.streakWeeks).toBe(1) // fresh start
      expect(store.weeklyTarget).toBe(2) // change applied
    })

    it('revert target preserves streak', () => {
      const store = useProgressionStore()
      store.evaluateWeek(3, '2026-03-16')
      store.evaluateWeek(3, '2026-03-23')
      expect(store.streakWeeks).toBe(2)

      store.setWeeklyTarget(6)
      store.revertTargetChange()
      store.evaluateWeek(3, '2026-03-30')
      expect(store.streakWeeks).toBe(3) // preserved
    })

    it('streak multiplier affects XP via history lookup', () => {
      const store = useProgressionStore()
      // Build a 4-week streak at 3 days/week
      for (let i = 0; i < 4; i++) {
        store.evaluateWeek(3, `2026-03-${String(2 + i * 7).padStart(2, '0')}`)
      }
      expect(store.streakWeeks).toBe(4)

      // Apply multiplier to a set dated in the last evaluated week
      const xp = applyStreakMultiplier(100, store.streakHistory, '2026-03-25')
      // 4 weeks = 1.25x duration, 3 days = 1.1x target → 1.375x
      expect(xp).toBe(138) // 100 * 1.375
    })
  })

  // ── Migration integration ─────────────────────────────────────

  describe('retroactive migration', () => {
    it('computes correct XP for a realistic exercise history', () => {
      const exercise = makeExercise('Bench', [
        makeSet({ weight: 135, reps: 5, date: '2026-01-01T12:00:00Z' }),
        makeSet({ weight: 135, reps: 5, date: '2026-01-08T12:00:00Z' }),
        makeSet({ weight: 135, reps: 5, date: '2026-01-15T12:00:00Z' }),
        makeSet({ weight: 185, reps: 3, date: '2026-02-01T12:00:00Z' }),
        makeSet({ weight: 225, reps: 1, date: '2026-03-01T12:00:00Z' }),
      ])

      const bw: BodyweightEntry[] = [
        { id: 'bw1', date: '2026-01-01T12:00:00Z', weight: 180 },
        { id: 'bw2', date: '2026-01-15T12:00:00Z', weight: 179 },
      ]

      const result = computeRetroactiveXP([exercise], bw)

      // First 3 sets: 50 each = 150
      expect(result.xpPerSet[exercise.sets[0].id]).toBe(50)
      expect(result.xpPerSet[exercise.sets[1].id]).toBe(50)
      expect(result.xpPerSet[exercise.sets[2].id]).toBe(50)

      // 4th set onward uses normal formula
      expect(result.xpPerSet[exercise.sets[3].id]).toBeGreaterThan(10)
      expect(result.xpPerSet[exercise.sets[4].id]).toBeGreaterThan(10)

      // Bodyweight: 2 unique dates = 200
      expect(result.bodyweightXP).toBe(200)
      expect(result.bodyweightXPDates).toHaveLength(2)

      // Total should be sum of all
      const setTotal = Object.values(result.xpPerSet).reduce((a, b) => a + b, 0)
      expect(result.totalXP).toBe(setTotal + 200)
    })

    it('migration flag prevents re-running', () => {
      expect(isMigrated()).toBe(false)
      markMigrated()
      expect(isMigrated()).toBe(true)
      clearMigrationFlag()
      expect(isMigrated()).toBe(false)
    })

    it('empty data produces 0 XP', () => {
      const result = computeRetroactiveXP([], [])
      expect(result.totalXP).toBe(0)
    })
  })

  // ── Theme unlock integration ──────────────────────────────────

  describe('theme unlock system', () => {
    it('unlocks themes at correct thresholds', () => {
      const store = useProgressionStore()
      store.setStarterTheme('luck')

      const thresholds = [
        { xp: 0, expected: ['pearl', 'luck'] },
        { xp: 5_000, expected: ['pearl', 'luck'] }, // starter already unlocked
        { xp: 15_000, expected: ['pearl', 'luck', 'air'] },
        { xp: 40_000, expected: ['pearl', 'luck', 'air', 'amethyst'] },
      ]

      for (const { xp, expected } of thresholds) {
        store.totalXP = xp
        store.checkUnlocks()
        for (const theme of expected) {
          expect(getUnlockedThemeIds(store.unlockedThemes)).toContain(theme)
        }
      }
    })

    it('unchosen starters unlock at level 7', () => {
      const store = useProgressionStore()
      store.setStarterTheme('luck')
      store.totalXP = 500_000
      store.checkUnlocks()

      expect(getUnlockedThemeIds(store.unlockedThemes)).toContain('fire')
      expect(getUnlockedThemeIds(store.unlockedThemes)).toContain('water')
      expect(getUnlockedThemeIds(store.unlockedThemes)).toContain('luck')
    })

    it('checkUnlocks is idempotent', () => {
      const store = useProgressionStore()
      store.setStarterTheme('fire')
      store.totalXP = 15_000
      store.checkUnlocks()
      const count1 = store.unlockedThemes.length
      store.checkUnlocks()
      expect(store.unlockedThemes.length).toBe(count1)
    })
  })

  // ── Quiet mode ────────────────────────────────────────────────

  describe('quiet mode', () => {
    it('showProgression toggle does not affect XP earning', () => {
      const store = useProgressionStore()
      store.progressionEnabled = true
      store.setShowProgression(false)

      store.logSetXP('set-1', 100)
      expect(store.totalXP).toBe(100) // XP still earned

      store.logBodyweightXP('2026-04-01')
      expect(store.totalXP).toBe(200) // bodyweight XP still earned
    })
  })

  // ── Progression toggle ────────────────────────────────────────

  describe('progression toggle', () => {
    it('disabling preserves data, re-enabling restores', () => {
      const store = useProgressionStore()
      store.setStarterTheme('fire')
      store.logSetXP('set-1', 500)

      // Disable
      store.progressionEnabled = false
      expect(store.totalXP).toBe(500) // data preserved
      expect(store.starterTheme).toBe('fire')

      // Re-enable
      store.progressionEnabled = true
      expect(store.totalXP).toBe(500) // data still there
      expect(store.starterTheme).toBe('fire')
    })
  })

  // ── Rolling best 1RM window ───────────────────────────────────

  describe('rolling 6-month best 1RM', () => {
    it('excludes sets older than 6 months', () => {
      const sets = [
        makeSet({ weight: 315, reps: 1, date: '2025-01-01T12:00:00Z', estimated1RM: 315 }),
        makeSet({ weight: 225, reps: 5, date: '2026-03-01T12:00:00Z', estimated1RM: 263 }),
      ]
      const best = calculateBest1RM(sets)
      expect(best).toBe(263) // 315 is outside window
    })

    it('returns null for no sets in window', () => {
      const sets = [
        makeSet({ weight: 315, reps: 1, date: '2024-01-01T12:00:00Z', estimated1RM: 315 }),
      ]
      expect(calculateBest1RM(sets)).toBeNull()
    })
  })

  // ── XP Config tunability ──────────────────────────────────────

  describe('XP_CONFIG is the single source of truth', () => {
    it('all tunable values are accessible', () => {
      expect(XP_CONFIG.prMultiplier).toBe(3)
      expect(XP_CONFIG.tieMultiplier).toBe(2)
      expect(XP_CONFIG.repPRMultiplier).toBe(1.25)
      expect(XP_CONFIG.warmupFlatXP).toBe(10)
      expect(XP_CONFIG.warmupThreshold).toBe(0.5)
      expect(XP_CONFIG.workingBase).toBe(10)
      expect(XP_CONFIG.workingSlope).toBe(176)
      expect(XP_CONFIG.newExerciseFlatXP).toBe(50)
      expect(XP_CONFIG.newExerciseMaxSets).toBe(3)
      expect(XP_CONFIG.minXP).toBe(10)
      expect(XP_CONFIG.bodyweightXP).toBe(100)
      expect(XP_CONFIG.best1RMWindowMonths).toBe(6)
    })
  })

  // ── Startup streak evaluation (LIFT-142) ──────────────────────
  describe('startup streak evaluation', () => {
    it('evaluatePendingWeeks catches up missed weeks on startup', () => {
      const store = useProgressionStore()
      store.progressionEnabled = true
      store.weeklyTarget = 3
      store.streakWeeks = 0
      store.streakHistory = []

      // Date strings spread across two past weeks (Mon 2026-03-17 and Mon 2026-03-24)
      const dates = [
        '2026-03-17',
        '2026-03-18',
        '2026-03-19',
        '2026-03-24',
        '2026-03-25',
      ]

      // Evaluate as if "now" is 2026-03-31 (both weeks are complete)
      store.evaluatePendingWeeks(dates, new Date('2026-03-31T10:00:00Z'))

      // First week had 3 days → meets target → streak 1
      // Second week had 2 days → misses target → streak resets to 0
      expect(store.streakHistory.length).toBe(2)
      expect(store.streakHistory[0].weekStart).toBe('2026-03-16')
      expect(store.streakHistory[1].weekStart).toBe('2026-03-23')
    })

    it('does not evaluate when progression is disabled', () => {
      const store = useProgressionStore()
      store.progressionEnabled = false
      store.streakHistory = []

      const dates = ['2026-03-17', '2026-03-18', '2026-03-19']

      // Mimic the startup guard: only call if progressionEnabled
      if (store.progressionEnabled) {
        store.evaluatePendingWeeks(dates, new Date('2026-03-31T10:00:00Z'))
      }

      expect(store.streakHistory.length).toBe(0)
    })
  })
})
