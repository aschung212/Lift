/**
 * useAppReview — decides when to ask for an App Store rating.
 *
 * Apple's HIG (and StoreKit itself) limit review prompts to 3 per 365-day
 * window and recommend only prompting at moments of genuine satisfaction —
 * never mid-task and never via a custom "please rate us" button. This
 * composable encodes that policy and is the single gate in front of the native
 * StoreKit call:
 *
 *   - prompt only at high-satisfaction moments (a new PR, a theme unlock, or a
 *     workout-count milestone)
 *   - at most 3 prompts per rolling 365 days
 *   - at least 14 days between prompts, so two unlocks in one session can't
 *     double-prompt
 *   - never on web (no review API exists) — `requestNativeReview` no-ops there
 *
 * The actual StoreKit bridge lives in `src/lib/appReview.ts`; wiring it into the
 * native build + on-device verification depends on the Capacitor iOS setup
 * (#531). The eligibility logic here is platform-independent and fully tested.
 */
import { requestNativeReview } from '../lib/appReview'
import { isNative } from '../lib/platform'
import { logError } from '../lib/logger'

/** The satisfaction moments at which a review may be requested. */
export type ReviewMoment = 'pr' | 'theme_unlock' | 'workout_milestone'

const STORAGE_KEY = 'app-review-history'
const MAX_PROMPTS_PER_YEAR = 3
const MIN_DAYS_BETWEEN_PROMPTS = 14
const DAY_MS = 24 * 60 * 60 * 1000
const YEAR_MS = 365 * DAY_MS

/** Read the recorded prompt timestamps (ms), pruning anything older than a year. */
function loadPrompts(now: number): number[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((t): t is number => typeof t === 'number' && now - t < YEAR_MS)
  } catch {
    return []
  }
}

function savePrompts(prompts: number[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prompts))
  } catch (e) {
    logError(e, { source: 'useAppReview.savePrompts' })
  }
}

/**
 * Whether a review prompt is allowed right now, given the recorded history.
 * Exported for direct testing of the policy.
 */
export function canRequestReview(now: number = Date.now()): boolean {
  const prompts = loadPrompts(now)
  if (prompts.length >= MAX_PROMPTS_PER_YEAR) return false
  const last = prompts.length > 0 ? Math.max(...prompts) : null
  if (last !== null && now - last < MIN_DAYS_BETWEEN_PROMPTS * DAY_MS) return false
  return true
}

export interface UseAppReviewReturn {
  /**
   * Request a native review prompt for the given satisfaction moment.
   * Returns `true` if the prompt was requested (and the attempt recorded),
   * `false` if it was suppressed by the rate-limit policy or the platform.
   */
  requestReviewAtMoment: (moment: ReviewMoment, now?: number) => boolean
  /** Current prompt history (ms timestamps within the last year). */
  getPromptHistory: (now?: number) => number[]
}

export function useAppReview(): UseAppReviewReturn {
  function requestReviewAtMoment(moment: ReviewMoment, now: number = Date.now()): boolean {
    // Web has no review API — never prompt and never spend the prompt budget.
    if (!isNative) return false
    if (!canRequestReview(now)) return false

    // Record the attempt before firing so a slow/failed native call can't lead
    // to a burst of retries from rapid successive moments.
    const prompts = loadPrompts(now)
    prompts.push(now)
    savePrompts(prompts)

    // Fire-and-forget: StoreKit owns the actual presentation + its own caps.
    void requestNativeReview().catch(() => { /* swallowed in wrapper */ })

    // `moment` is currently advisory (all moments share one policy) but is kept
    // in the signature so callers self-document the trigger and future tuning
    // can weight moments differently.
    void moment
    return true
  }

  function getPromptHistory(now: number = Date.now()): number[] {
    return loadPrompts(now)
  }

  return { requestReviewAtMoment, getPromptHistory }
}
