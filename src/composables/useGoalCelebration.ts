/**
 * Weekly-goal celebration composable (LIFT-764) — singleton reactive state for
 * the lightweight celebration shown the first time the weekly training goal is
 * met each week (with extra emphasis on streak-multiplier milestones).
 *
 * Distinct from usePRBurst: a PR is the big full-bleed takeover; hitting the
 * weekly goal is the quieter, recurring habit-loop reward, so this renders as a
 * compact auto-dismissing banner. It shares the `experience.prCelebrations`
 * opt-out (the app's single "celebrations" switch).
 *
 * Presentation only — it does NOT fire a haptic. A save earns exactly one,
 * decided with the celebration in `src/lib/setCeremony.ts` and fired once by
 * `useSetLogCeremony` (LIFT-1448); this used to return a boolean so the caller
 * could decide whether to add its own, which is the arrangement that let two
 * haptics collide on iOS.
 */

import { ref, type Ref } from 'vue'
import { usePreferencesStore } from '../stores/preferences'

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

/** Present the banner. No-ops under the celebrations opt-out. */
function presentGoalCelebration(p: GoalCelebrationPayload): void {
  // Honor the celebrations opt-out (Settings → Experience).
  try {
    const prefs = usePreferencesStore()
    if (prefs.experience?.prCelebrations === false) return
  } catch {
    // Pinia unavailable (e.g. some test setups) — proceed.
  }

  payload.value = p
  visible.value = true

  if (clearPayloadId !== null) { clearTimeout(clearPayloadId); clearPayloadId = null }

  // Auto-dismiss — celebrations should never block the next set.
  if (autoDismissId !== null) clearTimeout(autoDismissId)
  autoDismissId = setTimeout(dismissGoalCelebration, AUTO_DISMISS_MS)
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
  presentGoalCelebration: (p: GoalCelebrationPayload) => void
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
