/**
 * Restore-purchases flow for the Settings → Support surface (LIFT-1201).
 *
 * App Store Review Guideline 3.1.1 requires any app selling IAP to expose a
 * user-visible "Restore Purchases" control so a user who reinstalls or switches
 * devices can recover their entitlement without repaying. This composable owns
 * the small flow behind that control: the in-flight guard, the analytics
 * `restore` funnel stage (LIFT-906), and the auto-clearing status message. It
 * delegates the actual entitlement recovery to `useSupporter.restorePurchases`.
 */

import { readonly, ref, type Ref } from 'vue'
import { useSupporter, type RestoreResult } from './useSupporter'
import { useAnalytics } from './useAnalytics'

const MESSAGES: Record<RestoreResult, string> = {
  restored: 'Purchases restored',
  none: 'No purchases to restore',
  unavailable: 'Purchases can only be restored in the App Store version',
  error: 'Could not restore — try again',
}

// How long the status line stays up before clearing itself.
const FEEDBACK_MS = 4000

export interface UseRestorePurchasesReturn {
  /** True while a restore attempt is in flight (drives the disabled state). */
  isRestoring: Readonly<Ref<boolean>>
  /** Transient status line for the last attempt, or null. */
  feedback: Readonly<Ref<string | null>>
  /** Run a restore attempt; safe to bind directly to a click handler. */
  restore: () => Promise<RestoreResult>
}

export function useRestorePurchases(): UseRestorePurchasesReturn {
  const { restorePurchases } = useSupporter()
  const { supportFunnel } = useAnalytics()

  const isRestoring = ref(false)
  const feedback = ref<string | null>(null)
  let clearTimer: ReturnType<typeof setTimeout> | null = null

  function showFeedback(message: string): void {
    feedback.value = message
    if (clearTimer) clearTimeout(clearTimer)
    clearTimer = setTimeout(() => { feedback.value = null }, FEEDBACK_MS)
  }

  async function restore(): Promise<RestoreResult> {
    // The button is disabled while restoring, but guard re-entry defensively so
    // a double-tap can't fire two funnel events or two overlapping requests.
    if (isRestoring.value) return 'error'
    isRestoring.value = true
    feedback.value = null
    supportFunnel('restore')
    let result: RestoreResult
    try {
      result = await restorePurchases()
    } catch {
      result = 'error'
    } finally {
      isRestoring.value = false
    }
    showFeedback(MESSAGES[result])
    return result
  }

  return {
    isRestoring: readonly(isRestoring),
    feedback: readonly(feedback),
    restore,
  }
}
