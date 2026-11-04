/**
 * useProgressionCatchUp (LIFT-1450): the progression catch-up App.vue used to
 * run inline in onMounted, and the copy SettingsSheet carried for the moment
 * progression is switched on.
 *
 * Neither copy was tested where it ran. App.vue is impractical to mount, and
 * SettingsSheet's suite replaces the progression store with a mock, so the XP
 * the migration credits and the streak the catch-up computes were never
 * observed; the streak-revert fix (#1269) is pinned at the store instead
 * (progressionStreakMerge.test.ts). This drives the composable against the REAL
 * progression, workout, bodyweight and preferences stores (Supabase is null
 * under test, so nothing leaves the device) and asserts what the lifter ends up
 * with: the XP the migration credits, the theme the lock falls back to, the
 * streak the catch-up computes, and the toast it schedules.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

vi.mock('../../lib/syncQueue', () => ({
  syncQueue: { enqueue: vi.fn(), enqueueDelete: vi.fn(), clear: vi.fn(), rehydrate: vi.fn() },
}))

const { logWeeklySnapshot } = vi.hoisted(() => ({ logWeeklySnapshot: vi.fn() }))
vi.mock('../../lib/xpInstrumentation', () => ({
  logXPEvent: vi.fn(),
  logBodyweightXPEvent: vi.fn(),
  logWeeklySnapshot,
}))

import { useProgressionStore, UNLOCK_TIERS } from '../../stores/progression'
import { useWorkoutStore } from '../../stores/workout'
import { useBodyweightStore } from '../../stores/bodyweight'
import { usePreferencesStore } from '../../stores/preferences'
import { connectProgressionStore } from '../useTheme'
import { xpToast, unlockCelebration, resetXPCeremony } from '../xpCeremonyUI'
import { isMigrated } from '../../lib/xpMigration'
import { XP_CONFIG } from '../../lib/xp'
import { localDateKey } from '../../lib/dates'
import { useProgressionCatchUp } from '../useProgressionCatchUp'

/** Tuesday 2026-03-31, local time: the weeks of Mar 2, 9, 16 and 23 have ended. */
const NOW = new Date(2026, 2, 31, 10, 0, 0)

/** Three training days in each of the four weeks before NOW. */
const FOUR_MET_WEEKS = [
  '2026-03-02', '2026-03-03', '2026-03-04',
  '2026-03-09', '2026-03-10', '2026-03-11',
  '2026-03-16', '2026-03-17', '2026-03-18',
  '2026-03-23', '2026-03-24', '2026-03-25',
]

const CORRECTION_KEY = 'streak-target-correction-v1'

/** One set of squats on each day, logged the way the log sheet does. */
function logSetsOn(days: string[]): void {
  const workout = useWorkoutStore()
  const id = workout.addExercise('Squat')!
  for (const day of days) workout.logSet(id, 225, 5, day)
}

/** Progression on with a starter picked and a 3-day weekly target, as onboarding leaves it. */
function enableProgression() {
  const progression = useProgressionStore()
  progression.setStarterTheme('fire', 3)
  return progression
}

/** The XP `evaluatePendingWeeks` attributed to each week it evaluated. */
function snapshotWeekXP(): number[] {
  return logWeeklySnapshot.mock.calls.map(([snapshot]) => (snapshot as { weekXP: number }).weekXP)
}

describe('useProgressionCatchUp (LIFT-1450)', () => {
  beforeEach(() => {
    localStorageMock.clear()
    setActivePinia(createPinia())
    connectProgressionStore(() => useProgressionStore())
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    resetXPCeremony()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('catchUpOnLaunch', () => {
    it('credits the retroactive XP once, when progression is on', () => {
      logSetsOn(FOUR_MET_WEEKS)
      const progression = enableProgression()
      const catchUp = useProgressionCatchUp()

      catchUp.catchUpOnLaunch()

      expect(isMigrated()).toBe(true)
      expect(Object.keys(progression.xpPerSet)).toHaveLength(FOUR_MET_WEEKS.length)
      expect(progression.totalXP).toBeGreaterThan(0)

      // The next launch must not price the history a second time.
      const credited = progression.totalXP
      logSetsOn(['2026-03-30'])
      catchUp.catchUpOnLaunch()
      expect(progression.totalXP).toBe(credited)
    })

    it('celebrates the themes the retroactive XP unlocks', () => {
      // Enough weigh-in days, at their flat XP each, to reach the Energy tier.
      const tier = UNLOCK_TIERS.find(t => t.themeId === 'air')!
      const days = Math.ceil(tier.xpRequired / XP_CONFIG.bodyweightXP)
      const bodyweight = useBodyweightStore()
      for (let i = 0; i < days; i++) bodyweight.addEntry(180, localDateKey(new Date(2025, 9, 1 + i)))
      enableProgression()

      useProgressionCatchUp().catchUpOnLaunch()
      vi.advanceTimersByTime(500)

      expect(unlockCelebration.visible).toBe(true)
      expect(unlockCelebration.themeId).toBe('air')
    })

    it('catches up the weeks that ended and toasts the duration tier they reached', () => {
      logSetsOn(FOUR_MET_WEEKS)
      const progression = enableProgression()

      useProgressionCatchUp().catchUpOnLaunch()

      expect(progression.streakHistory.map(e => e.weekStart))
        .toEqual(['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23'])
      expect(progression.streakWeeks).toBe(4)
      // Every set's XP lands in the week it was logged, so the per-week totals
      // add up to the whole ledger. That holds only if the set → date map
      // reached `evaluatePendingWeeks`; without it every week reports 0.
      expect(snapshotWeekXP().reduce((sum, xp) => sum + xp, 0)).toBe(progression.totalXP)

      // The toast waits for the launch to settle before it shows.
      expect(xpToast.visible).toBe(false)
      vi.advanceTimersByTime(1500)
      expect(xpToast.visible).toBe(true)
      expect(xpToast.text).toBe('4-week streak! Duration bonus: 1.25×')
      expect(xpToast.totalXP).toBe(progression.totalXP)
    })

    it('stays quiet when the weeks it evaluates leave the streak inside its tier', () => {
      logSetsOn(['2026-03-23', '2026-03-24', '2026-03-25'])
      const progression = enableProgression()
      progression.streakHistory = [{ weekStart: '2026-03-16', streakCount: 4, weeklyTarget: 3 }]
      progression.streakWeeks = 4

      useProgressionCatchUp().catchUpOnLaunch()
      vi.advanceTimersByTime(1500)

      expect(progression.streakWeeks).toBe(5)
      expect(xpToast.visible).toBe(false)
    })

    it('shows no streak toast in quiet mode', () => {
      logSetsOn(FOUR_MET_WEEKS)
      const progression = enableProgression()
      progression.setShowProgression(false)

      useProgressionCatchUp().catchUpOnLaunch()
      vi.advanceTimersByTime(1500)

      expect(progression.streakWeeks).toBe(4)
      expect(xpToast.visible).toBe(false)
    })

    it('applies a target change still staged at launch and re-evaluates the history against it, once', () => {
      logSetsOn(FOUR_MET_WEEKS)
      const progression = enableProgression()
      // What #285 left behind: the target restored to a stale value, the
      // lifter's own target still staged, and every week evaluated as missed.
      progression.weeklyTarget = 5
      progression.pendingTargetChange = 3
      progression.streakHistory = ['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23']
        .map(weekStart => ({ weekStart, streakCount: 0, weeklyTarget: 5 }))
      progression.streakWeeks = 0

      useProgressionCatchUp().catchUpOnLaunch()

      expect(localStorage.getItem(CORRECTION_KEY)).toBe(NOW.toISOString())
      expect(progression.weeklyTarget).toBe(3)
      expect(progression.pendingTargetChange).toBeNull()
      expect(progression.streakHistory.map(e => e.streakCount)).toEqual([1, 2, 3, 4])
      // The re-evaluation was handed the set → date map too.
      expect(snapshotWeekXP().reduce((sum, xp) => sum + xp, 0)).toBe(progression.totalXP)

      // It is a one-time repair: a change staged later waits for Monday as usual.
      progression.pendingTargetChange = 5
      useProgressionCatchUp().catchUpOnLaunch()
      expect(progression.pendingTargetChange).toBe(5)
      expect(progression.weeklyTarget).toBe(3)
    })

    it('marks the target correction done even when nothing is staged', () => {
      enableProgression()

      useProgressionCatchUp().catchUpOnLaunch()

      expect(localStorage.getItem(CORRECTION_KEY)).toBe(NOW.toISOString())
    })

    it('runs only the theme lock while progression is off', () => {
      logSetsOn(FOUR_MET_WEEKS)
      const progression = useProgressionStore()
      const prefs = usePreferencesStore()
      prefs.setTheme('amethyst')

      useProgressionCatchUp().catchUpOnLaunch()

      expect(isMigrated()).toBe(false)
      expect(progression.totalXP).toBe(0)
      expect(progression.streakHistory).toEqual([])
      expect(localStorage.getItem(CORRECTION_KEY)).toBeNull()
      expect(prefs.theme).toBe('pearl')
    })
  })

  describe('enforceThemeLock', () => {
    it('keeps a theme the lifter has unlocked', () => {
      enableProgression()
      const prefs = usePreferencesStore()
      // Every starter is open during the trial, before the first set confirms one.
      prefs.setTheme('water')

      useProgressionCatchUp().enforceThemeLock()

      expect(prefs.theme).toBe('water')
    })

    it('falls back to the free theme from a locked one', () => {
      enableProgression()
      const prefs = usePreferencesStore()
      prefs.setTheme('amethyst')

      useProgressionCatchUp().enforceThemeLock()

      expect(prefs.theme).toBe('pearl')
    })
  })

  describe('turning progression on later (the Settings path)', () => {
    it('prices the history and catches up the weeks it missed', () => {
      logSetsOn(FOUR_MET_WEEKS)
      const catchUp = useProgressionCatchUp()
      // A launch with progression off accrues nothing...
      catchUp.catchUpOnLaunch()
      const progression = enableProgression()

      // ...so switching it on owes the same catch-up, which SettingsSheet runs.
      catchUp.runMigrationIfNeeded()
      catchUp.catchUpStreaks()

      expect(isMigrated()).toBe(true)
      expect(progression.totalXP).toBeGreaterThan(0)
      expect(progression.streakWeeks).toBe(4)
      // Called with no map, it builds its own.
      expect(snapshotWeekXP().reduce((sum, xp) => sum + xp, 0)).toBe(progression.totalXP)
      vi.advanceTimersByTime(1500)
      expect(xpToast.text).toBe('4-week streak! Duration bonus: 1.25×')
    })
  })
})
