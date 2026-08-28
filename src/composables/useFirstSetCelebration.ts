/**
 * First-set celebration composable — singleton reactive state for a lightweight
 * activation moment shown the first time a brand-new user logs a set (#762).
 *
 * Distinct from the full-bleed PR burst (usePRBurst): a new user often won't hit
 * a PR for weeks, so their true "aha" moment is logging their first set. This is
 * a gentle, auto-dismissing card — not a takeover — and fires exactly once ever,
 * gated by the caller via a localStorage flag.
 *
 * Respects the user's `experience.prCelebrations` preference (no-ops when the
 * toggle is off, matching the PR burst). Fires a success haptic via useHaptics,
 * which itself honors the haptics toggle.
 */

import { ref, type Ref } from 'vue'
import { usePreferencesStore } from '../stores/preferences'
import { useHaptics } from './useHaptics'

/** How long the card stays up before auto-dismissing (ms). */
export const FIRST_SET_AUTO_DISMISS_MS = 4200

const visible: Ref<boolean> = ref(false)
let dismissTimeoutId: ReturnType<typeof setTimeout> | null = null

function presentFirstSetCelebration(): void {
  // Skip if the user opted out of celebrations (Settings → Experience).
  try {
    const prefs = usePreferencesStore()
    if (prefs.experience?.prCelebrations === false) return
  } catch {
    // Pinia unavailable (e.g. in certain test setups) — proceed.
  }

  visible.value = true

  // Celebratory success haptic — useHaptics short-circuits if disabled.
  try {
    useHaptics().notifySuccess()
  } catch {
    /* silent — haptics are best-effort */
  }

  // Auto-dismiss so the new user isn't left to figure out how to clear it.
  if (dismissTimeoutId !== null) clearTimeout(dismissTimeoutId)
  dismissTimeoutId = setTimeout(() => {
    visible.value = false
    dismissTimeoutId = null
  }, FIRST_SET_AUTO_DISMISS_MS)
}

function dismissFirstSetCelebration(): void {
  visible.value = false
  if (dismissTimeoutId !== null) {
    clearTimeout(dismissTimeoutId)
    dismissTimeoutId = null
  }
}

export interface UseFirstSetCelebrationReturn {
  visible: Ref<boolean>
  presentFirstSetCelebration: () => void
  dismissFirstSetCelebration: () => void
}

export function useFirstSetCelebration(): UseFirstSetCelebrationReturn {
  return {
    visible,
    presentFirstSetCelebration,
    dismissFirstSetCelebration,
  }
}
