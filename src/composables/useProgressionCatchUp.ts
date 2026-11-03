/**
 * useProgressionCatchUp — brings progression up to date with the training
 * history already on the device (LIFT-1450).
 *
 * Progression only accrues while it is on and the app is open, so it falls
 * behind the history two ways: weeks end while the app is closed, and sets are
 * logged while progression is off. That gives two moments that owe a catch-up:
 * every launch (App.vue), and the moment the lifter turns progression on or
 * settles their starter theme (SettingsSheet). Each carried its own
 * hand-written copy of the steps, down to a literal table of the duration
 * multipliers. They live here once:
 *
 *  - `runMigrationIfNeeded`: the one-time retroactive XP pass (#123), which
 *    prices every set already logged and celebrates what it unlocks.
 *  - `enforceThemeLock`: fall back to the free theme when the one in use is
 *    locked.
 *  - `catchUpStreaks`: evaluate every week that ended unevaluated, and toast
 *    when that carried the streak up a duration-multiplier tier.
 *
 * `catchUpOnLaunch` is the launch's sequence of them, plus a one-time
 * streak-target correction that only the launch runs.
 */
import { useProgressionStore } from '../stores/progression'
import { useWorkoutStore, type Exercise } from '../stores/workout'
import { useBodyweightStore } from '../stores/bodyweight'
import { useTheme } from './useTheme'
import { useXPCeremony } from './useXPCeremony'
import { showXPToast } from './xpCeremonyUI'
import { isMigrated, markMigrated, computeRetroactiveXP } from '../lib/xpMigration'
import { durationTierReached } from '../lib/xp'

/** Device-local marker for the one-time target correction; holds when it ran. */
const STREAK_TARGET_CORRECTION_KEY = 'streak-target-correction-v1'

export interface UseProgressionCatchUpReturn {
  /** App.vue's launch sequence. Its doc comment covers the ordering it relies on. */
  catchUpOnLaunch: () => void
  /** The retroactive XP pass, once, when progression is on. */
  runMigrationIfNeeded: () => void
  /** Switch to the free theme if the one in use is locked. */
  enforceThemeLock: () => void
  /** Evaluate the weeks that ended unevaluated; toast a step up a duration tier. */
  catchUpStreaks: (setIdToDate?: Record<string, string>) => void
}

/** setId → YYYY-MM-DD, which `evaluatePendingWeeks` uses to total each week's XP. */
function buildSetIdToDate(exercises: readonly Exercise[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const exercise of exercises) {
    for (const set of exercise.sets) {
      map[set.id] = set.date.slice(0, 10)
    }
  }
  return map
}

export function useProgressionCatchUp(): UseProgressionCatchUpReturn {
  const progressionStore = useProgressionStore()
  const workoutStore = useWorkoutStore()
  const bodyweightStore = useBodyweightStore()
  const { currentTheme, isThemeUnlocked } = useTheme()
  const { celebrateUnlocks } = useXPCeremony()

  function runMigrationIfNeeded(): void {
    if (progressionStore.progressionEnabled && !isMigrated()) {
      const result = computeRetroactiveXP(workoutStore.exercises, bodyweightStore.entries)
      if (result.totalXP > 0) {
        progressionStore.totalXP = result.totalXP
        progressionStore.xpPerSet = result.xpPerSet
        progressionStore.bodyweightXPDates = result.bodyweightXPDates
        const newUnlocks = progressionStore.checkUnlocks()
        progressionStore._persist()
        if (newUnlocks.length > 0) {
          celebrateUnlocks(newUnlocks)
        }
      }
      markMigrated()
    }
  }

  function enforceThemeLock(): void {
    if (!isThemeUnlocked(currentTheme.value)) {
      currentTheme.value = 'pearl'
    }
  }

  /**
   * `setIdToDate` is optional so a caller with nothing else to share it with
   * can omit it; the launch passes the map it already built for the target
   * correction rather than walking every set twice.
   */
  function catchUpStreaks(setIdToDate = buildSetIdToDate(workoutStore.exercises)): void {
    const streakBefore = progressionStore.streakWeeks
    progressionStore.evaluatePendingWeeks(workoutStore.workoutDates, new Date(), setIdToDate)
    const streakAfter = progressionStore.streakWeeks
    const multiplier = durationTierReached(streakBefore, streakAfter)
    if (progressionStore.showProgression && multiplier !== null) {
      setTimeout(() => showXPToast(
        `${streakAfter}-week streak! Duration bonus: ${multiplier}×`,
        progressionStore.progressPercent,
        progressionStore.totalXP,
        progressionStore.nextUnlockThreshold
      ), 1500)
    }
  }

  /**
   * One-time repair (#285): a localStorage eviction let Supabase restore the
   * default weekly target, so the backfilled weeks were evaluated against the
   * wrong one. A target change still staged at launch is taken as the real
   * target: it is applied, and the whole history re-evaluated against it.
   */
  function correctStreakTargetOnce(setIdToDate: Record<string, string>): void {
    if (localStorage.getItem(STREAK_TARGET_CORRECTION_KEY)) return
    localStorage.setItem(STREAK_TARGET_CORRECTION_KEY, new Date().toISOString())
    if (progressionStore.pendingTargetChange === null) return
    progressionStore.weeklyTarget = progressionStore.pendingTargetChange
    progressionStore.pendingTargetChange = null
    progressionStore.reEvaluateStreaks(workoutStore.workoutDates, new Date(), setIdToDate)
  }

  /**
   * Migration, theme lock, then (with progression on) the target correction and
   * the week catch-up.
   *
   * This runs synchronously against LOCAL state and does not wait for the
   * network: App.vue calls it from onMounted after starting auth
   * (`initAuth(initSupabase())`, deliberately not awaited), so a launch on a
   * dead uplink still evaluates its weeks. The progression read that auth
   * starts waits on the SDK, the session and the network, so it normally lands
   * after this has advanced `streakHistory`. That is why `_fetchFromSupabase`
   * merges the history (`mergeStreakHistory`) instead of adopting the server's
   * copy. Adopting it reverted the weeks evaluated here: the milestone toast
   * announced a streak the badge no longer showed, and the fetch's own sync
   * wrote the stale streak back to the server (#1269).
   */
  function catchUpOnLaunch(): void {
    runMigrationIfNeeded()
    enforceThemeLock()
    if (!progressionStore.progressionEnabled) return
    const setIdToDate = buildSetIdToDate(workoutStore.exercises)
    correctStreakTargetOnce(setIdToDate)
    catchUpStreaks(setIdToDate)
  }

  return { catchUpOnLaunch, runMigrationIfNeeded, enforceThemeLock, catchUpStreaks }
}
