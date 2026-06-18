/**
 * Weekly-goal celebration composable (LIFT-764) — singleton reactive state for
 * the lightweight celebration shown the first time the weekly training goal is
 * met each week (with extra emphasis on streak-multiplier milestones).
 *
 * Distinct from usePRBurst: a PR is the big full-bleed takeover; hitting the
 * weekly goal is the quieter, recurring habit-loop reward, so this renders as a
 * compact auto-dismissing banner. It shares the `experience.prCelebrations`
 * opt-out (the app's single "celebrations" switch) and fires a success haptic.
 */

import { ref, type Ref } from 'vue'
import { usePreferencesStore } from '../stores/preferences'
import { useHaptics } from './useHaptics'

export interface GoalCelebrationPayload {
  /** Projected consecutive-week streak after meeting this week's goal. */
  streak: number
  /** True when meeting the goal this week bumps the streak-duration multiplier. */
  milestone: boolean
  /** The user's weekly training-days target. */
  target: number
}

/** How long the banner stays up before auto-dismissing (ms). */
const AUTO_DISMISS_MS = 4500

const visible: Ref<boolean> = ref(false)
const payload: Ref<GoalCelebrationPayload | null> = ref(null)
let autoDismissId: ReturnType<typeof setTimeout> | null = null
let clearPayloadId: ReturnType<typeof setTimeout> | null = null

/**
 * Present the banner and fire its celebration haptic. Returns `true` when the
 * celebration was actually presented (and thus a success / milestone haptic was
 * fired), `false` when it was suppressed by the celebrations opt-out. Callers
 * use the return value to avoid firing a second, colliding haptic: two native
 * haptics fired back-to-back collapse into a muddy/truncated buzz on
 * Capacitor/iOS (see WorkoutTracker.saveSet).
 */
function presentGoalCelebration(p: GoalCelebrationPayload): boolean {
  // Honor the celebrations opt-out (Settings → Experience).
  try {
    const prefs = usePreferencesStore()
    if (prefs.experience?.prCelebrations === false) return false
  } catch {
    // Pinia unavailable (e.g. some test setups) — proceed.
  }

  payload.value = p
  visible.value = true

  if (clearPayloadId !== null) { clearTimeout(clearPayloadId); clearPayloadId = null }

  // Success haptic — heavier when a multiplier milestone is reached. useHaptics
  // short-circuits if the user disabled haptics.
  try {
    const haptics = useHaptics()
    if (p.milestone) haptics.impactHeavy()
    haptics.notifySuccess()
  } catch {
    /* silent — haptics are best-effort */
  }

  // Auto-dismiss — celebrations should never block the next set.
  if (autoDismissId !== null) clearTimeout(autoDismissId)
  autoDismissId = setTimeout(dismissGoalCelebration, AUTO_DISMISS_MS)
  return true
}

function dismissGoalCelebration(): void {
  visible.value = false
  if (autoDismissId !== null) { clearTimeout(autoDismissId); autoDismissId = null }
  // Clear payload after the fade-out so the banner animates with final values.
  if (clearPayloadId !== null) clearTimeout(clearPayloadId)
  clearPayloadId = setTimeout(() => {
    if (!visible.value) payload.value = null
    clearPayloadId = null
  }, 220)
}

export interface UseGoalCelebrationReturn {
  visible: Ref<boolean>
  payload: Ref<GoalCelebrationPayload | null>
  presentGoalCelebration: (p: GoalCelebrationPayload) => boolean
  dismissGoalCelebration: () => void
}

export function useGoalCelebration(): UseGoalCelebrationReturn {
  return {
    visible,
    payload,
    presentGoalCelebration,
    dismissGoalCelebration,
  }
}
