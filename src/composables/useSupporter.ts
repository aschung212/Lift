/**
 * Supporter (paid tier) entitlement — single source of truth (issue #601).
 *
 * Read this anywhere the free vs. paid experience diverges. Consumers today:
 *  - the share-card "Made with Lift" watermark (free users get it, supporters don't);
 *  - the AI Coach weekly-review allowance (`coachWeeklyLimit`, LIFT-904) — supporters
 *    get more-frequent coach runs so their revenue funds the recurring API cost.
 *
 * Module-level singleton ref so the value is global, not per-component.
 */

import { computed, readonly, ref, type ComputedRef, type Ref } from 'vue'
import { weeklyReviewLimit } from '../lib/coachTier'

// TODO(LIFT-598): wire this to the RevenueCat / Capacitor IAP entitlement
// (or the Supabase profile flag synced from it) once App Store purchases
// ship. Stubbed to `false` so the free tier — including the watermark — is
// the default for everyone until then.
const _isSupporter = ref(false)

export interface UseSupporterReturn {
  /** True when the user has an active supporter entitlement. */
  isSupporter: Readonly<Ref<boolean>>
  /**
   * AI Coach reviews allowed per rolling 7-day window for the current entitlement
   * (LIFT-904). Cosmetic on the client — the server is the real cap (it applies the
   * supporter allowance via the trusted `coach_usage.limit_override`, never a
   * client-sent value) — but it drives the "N reviews left this week" copy.
   */
  coachWeeklyLimit: ComputedRef<number>
}

export function useSupporter(): UseSupporterReturn {
  const coachWeeklyLimit = computed(() => weeklyReviewLimit(_isSupporter.value))
  return { isSupporter: readonly(_isSupporter), coachWeeklyLimit }
}
