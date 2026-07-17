/**
 * xpCeremonyUI — transient, non-persisted UI state for the XP ceremony.
 *
 * Holds the global XP toast and theme-unlock celebration singletons that App.vue
 * renders and the ceremony pipeline (useXPCeremony, SettingsSheet) drives.
 *
 * This state is deliberately NOT part of the Pinia progression store: it is
 * ephemeral presentation state — not persisted, not synced, and not owned by the
 * store's $reset contract. Keeping it here (rather than co-located in the store
 * module, LIFT-823) makes the store's boundary unambiguous and gives sign-out and
 * test isolation an explicit `resetXPCeremony()` hook. That reset also clears the
 * toast's auto-dismiss timer, so a leaked setTimeout can't fire after a session
 * ends or bleed across test cases.
 */

import { reactive } from 'vue'
import type { ThemeId } from '../lib/themes'

const TOAST_DURATION_MS = 4000

// Transient toast state (not persisted, reactive for template binding)
export const xpToast = reactive({
  visible: false,
  text: '',
  progressPercent: 0,
  totalXP: 0,
  nextThresholdXP: null as number | null,
  _timer: null as ReturnType<typeof setTimeout> | null,
})

export function showXPToast(text: string, progressPercent: number, totalXP: number, nextThresholdXP: number | null): void {
  xpToast.text = text
  xpToast.progressPercent = progressPercent
  xpToast.totalXP = totalXP
  xpToast.nextThresholdXP = nextThresholdXP
  xpToast.visible = true
  if (xpToast._timer) clearTimeout(xpToast._timer)
  xpToast._timer = setTimeout(() => {
    xpToast.visible = false
    xpToast._timer = null
  }, TOAST_DURATION_MS)
}

// Unlock celebration state (not persisted, reactive)
export const unlockCelebration = reactive({
  visible: false,
  themeId: null as ThemeId | null,
  themeName: '',
})

export function showUnlockCelebration(themeId: ThemeId, themeName: string): void {
  unlockCelebration.themeId = themeId
  unlockCelebration.themeName = themeName
  unlockCelebration.visible = true
}

export function dismissUnlockCelebration(): void {
  unlockCelebration.visible = false
}

/**
 * Clear all transient ceremony UI state and cancel any in-flight toast timer.
 *
 * Called from resetStores() on sign-out so a shared device never shows the
 * previous user's toast/celebration, and from test beforeEach for isolation so a
 * pending timer can't fire across test cases.
 */
export function resetXPCeremony(): void {
  if (xpToast._timer) {
    clearTimeout(xpToast._timer)
    xpToast._timer = null
  }
  xpToast.visible = false
  xpToast.text = ''
  xpToast.progressPercent = 0
  xpToast.totalXP = 0
  xpToast.nextThresholdXP = null
  unlockCelebration.visible = false
  unlockCelebration.themeId = null
  unlockCelebration.themeName = ''
}
