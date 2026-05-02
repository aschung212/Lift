/**
 * PR burst composable — singleton reactive state for the full-bleed PR
 * celebration overlay described in `design_handoff_lift_ios_pwa/screens/08-pr-burst.png`.
 *
 * Usage:
 *   // From a log-set handler, after the set has been persisted:
 *   const { presentPRBurst } = usePRBurst()
 *   presentPRBurst({ exerciseName, oldE1RM, newE1RM, setWeight, setReps })
 *
 * Respects the user's `experience.prCelebrations` preference (no-ops when
 * the toggle is off, even if presentPRBurst is called). Also fires a
 * success haptic via useHaptics, which itself honors the haptics toggle.
 *
 * PR baseline: callers are expected to compare new vs. previous e1RM using
 * `workoutStore.getExercisePR(id, prBaselineDate)` so the burst respects
 * the user's selected baseline. This composable does not itself perform
 * the comparison — it only decides whether to render once the caller has
 * determined a true PR occurred.
 */

import { ref, type Ref } from 'vue'
import { usePreferencesStore } from '../stores/preferences'
import { useHaptics } from './useHaptics'

export interface PRBurstPayload {
  exerciseName: string
  /** Previous best e1RM for this exercise, relative to the PR baseline. */
  oldE1RM: number
  /** New best e1RM after the current set. */
  newE1RM: number
  /** Weight (in lbs) of the set that triggered the PR. */
  setWeight: number
  /** Reps of the set that triggered the PR. */
  setReps: number
  /** True when this is the user's very first PR ever — triggers enhanced celebration. */
  isFirstPR?: boolean
}

const visible: Ref<boolean> = ref(false)
const payload: Ref<PRBurstPayload | null> = ref(null)

function presentPRBurst(p: PRBurstPayload): void {
  // Skip if the user opted out of PR celebrations (Settings → Experience).
  try {
    const prefs = usePreferencesStore()
    if (prefs.experience?.prCelebrations === false) return
  } catch {
    // Pinia unavailable (e.g. in certain test setups) — proceed.
  }

  // Guard against malformed payloads — a "PR" where new <= old is a bug.
  if (p.newE1RM <= p.oldE1RM) return

  payload.value = p
  visible.value = true

  // Haptic on present — heavier for the user's very first PR.
  // useHaptics short-circuits if the user disabled haptics.
  try {
    const haptics = useHaptics()
    if (p.isFirstPR) {
      haptics.impactHeavy()
    } else {
      haptics.notifySuccess()
    }
  } catch {
    /* silent — haptics are best-effort */
  }
}

function dismissPRBurst(): void {
  visible.value = false
  // Clear payload slightly after the fade-out so the component can animate
  // with the final values; a CSS transition handles opacity.
  setTimeout(() => {
    if (!visible.value) payload.value = null
  }, 200)
}

export function usePRBurst() {
  return {
    visible,
    payload,
    presentPRBurst,
    dismissPRBurst,
  }
}
