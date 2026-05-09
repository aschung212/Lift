/**
 * useXPCeremony — orchestrates the full XP attribution pipeline.
 *
 * Encapsulates the ceremony that fires after logging a set or bodyweight entry:
 *   check eligibility → record XP → credit if enabled → check unlocks →
 *   show celebration → log analytics → show XP toast.
 *
 * Extracted from BodyweightTracker.vue and WorkoutTracker.vue (issue #521).
 */

import { THEMES } from './useTheme'
import { useProgressionStore, showXPToast, showUnlockCelebration } from '../stores/progression'
import { XP_CONFIG } from '../lib/xp'
import { logXPEvent, logBodyweightXPEvent } from '../lib/xpInstrumentation'
import type { ThemeId } from './useTheme'

export interface SetXPCeremonyInput {
  setId: string
  exerciseId: string
  xp: number
  baseXP: number
  zone: 'warmup' | 'working' | 'pr' | 'tie' | 'new_exercise'
  isPR: boolean
  isTie: boolean
  isRepPR: boolean
  activeTheme: string
  estimated1RM: number
  exerciseBest1RM: number | null
  streakMultiplier: number
  onUnlock?: () => void
}

export interface BodyweightXPCeremonyInput {
  date: string
  activeTheme: string
  onUnlock?: () => void
}

export function useXPCeremony() {
  const progressionStore = useProgressionStore()

  /**
   * Run the full XP ceremony for a logged workout set.
   *
   * Steps: record metadata → credit XP (if enabled) → trial lock-in →
   * check unlocks → celebration → analytics → toast.
   */
  function logSetXPCeremony(input: SetXPCeremonyInput): void {
    const {
      setId, exerciseId, xp, baseXP, zone,
      isPR, isTie, isRepPR, activeTheme,
      estimated1RM, exerciseBest1RM, streakMultiplier,
      onUnlock,
    } = input

    const setMeta = { theme: activeTheme, epoch: progressionStore.epoch, zone, isPR, isRepPR }

    // Always record metadata (shadow ledger — enables per-theme stats even without progression)
    progressionStore.recordSetXP(setId, xp, setMeta)

    // Only credit XP and trigger progression effects when enabled
    if (progressionStore.progressionEnabled) {
      const wasTrialPeriod = !progressionStore.starterConfirmed
      progressionStore.creditSetXP(setId, xp)

      // Notify when starter locks in on first set
      if (wasTrialPeriod && progressionStore.starterConfirmed) {
        const starterLabel = THEMES.find(t => t.id === progressionStore.starterTheme)?.label
        if (starterLabel) {
          setTimeout(() => showXPToast(
            `${starterLabel} locked in as your starter`,
            progressionStore.progressPercent,
            progressionStore.totalXP,
            progressionStore.nextUnlockThreshold
          ), 4500)
        }
      }

      _checkUnlocksAndCelebrate(onUnlock)
    }

    // Log analytics (always, regardless of progression toggle)
    logXPEvent({
      userId: progressionStore._userId,
      setId,
      exerciseId,
      setDate: new Date().toISOString(),
      baseXP,
      streakMultiplier,
      finalXP: xp,
      isPR,
      isTie,
      isRepPR,
      zone,
      activeTheme,
      epoch: progressionStore.epoch,
    })

    // Show XP toast with zone breakdown
    if (progressionStore.progressionEnabled && progressionStore.showProgression) {
      const parts: string[] = []

      if (exerciseBest1RM === null) {
        parts.push('New Exercise')
      } else {
        const ratio = estimated1RM / exerciseBest1RM
        if (ratio > 1.0) parts.push(`PR! (${XP_CONFIG.prMultiplier}x)`)
        else if (ratio === 1.0) parts.push(`Tied PR (${XP_CONFIG.tieMultiplier}x)`)
        else if (ratio < XP_CONFIG.warmupThreshold) parts.push('Warmup')
        else parts.push(`${Math.round(ratio * 100)}% of best`)
      }
      if (isRepPR) parts.push(`Rep PR (${XP_CONFIG.repPRMultiplier}x)`)
      if (streakMultiplier > 1) parts.push(`${streakMultiplier}x streak`)
      parts.push(`${xp} XP`)

      showXPToast(parts.join(' · '), progressionStore.progressPercent, progressionStore.totalXP, progressionStore.nextUnlockThreshold)
    }
  }

  /**
   * Run the full XP ceremony for a bodyweight log entry.
   *
   * Steps: check eligibility → log XP → check unlocks → celebration →
   * analytics → toast.
   */
  function logBodyweightXPCeremony(input: BodyweightXPCeremonyInput): void {
    const { date, activeTheme, onUnlock } = input

    if (!progressionStore.progressionEnabled) return

    const dateKey = date.slice(0, 10)
    const alreadyCredited = progressionStore.bodyweightXPDates.includes(dateKey)
    progressionStore.logBodyweightXP(date)

    _checkUnlocksAndCelebrate(onUnlock)

    if (!alreadyCredited) {
      logBodyweightXPEvent(progressionStore._userId, date, XP_CONFIG.bodyweightXP, activeTheme, progressionStore.epoch)
      if (progressionStore.showProgression) {
        showXPToast(`+${XP_CONFIG.bodyweightXP} XP`, progressionStore.progressPercent, progressionStore.totalXP, progressionStore.nextUnlockThreshold)
      }
    }
  }

  /**
   * Check for newly unlocked themes and trigger celebration UI.
   * Shared between set and bodyweight ceremonies.
   */
  function _checkUnlocksAndCelebrate(onUnlock?: () => void): void {
    const newUnlocks = progressionStore.checkUnlocks()
    if (newUnlocks.length > 0) {
      const theme = THEMES.find(t => t.id === newUnlocks[0])
      if (theme) {
        setTimeout(() => {
          showUnlockCelebration(theme.id, theme.label)
          onUnlock?.()
        }, progressionStore.showProgression ? 1500 : 500)
      }
    }
  }

  /**
   * Show celebration for multiple unlocked themes sequentially.
   * Used during migration/retroactive XP calculation.
   */
  function celebrateUnlocks(themeIds: ThemeId[]): void {
    themeIds.forEach((themeId, i) => {
      const theme = THEMES.find(t => t.id === themeId)
      if (theme) {
        setTimeout(() => showUnlockCelebration(theme.id, theme.label), 500 + i * 2500)
      }
    })
  }

  return {
    logSetXPCeremony,
    logBodyweightXPCeremony,
    celebrateUnlocks,
  }
}
