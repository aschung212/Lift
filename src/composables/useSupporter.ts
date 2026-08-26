/**
 * Supporter (paid tier) entitlement — single source of truth (issue #601).
 *
 * Read this anywhere the free vs. paid experience diverges. Today the consumer
 * is the share-card "Made with Lift" watermark: free users get the watermark,
 * supporters get clean cards.
 *
 * The entitlement is backed by the preferences store's synced `isSupporter`
 * flag (LIFT-1204), so it is grantable and rides the existing per-user,
 * RLS-protected `user_preferences` row across devices. The web-sponsor grant
 * path is `redeem()` (a redeemed sponsor code); the native App Store path
 * (LIFT-598) will set the same flag from a RevenueCat/IAP entitlement.
 */

import { computed, type ComputedRef } from 'vue'
import { usePreferencesStore } from '../stores/preferences'
import { isSupporterCodeConfigured } from '../lib/supporterCode'

export interface UseSupporterReturn {
  /** True when the user has an active supporter entitlement. */
  isSupporter: ComputedRef<boolean>
  /**
   * True when this build has a redemption code configured, so the web-sponsor
   * redeem path can be offered. False → hide the redeem UI (no dead input).
   */
  canRedeem: boolean
  /** Redeem a sponsor code; returns true when valid (entitlement granted). */
  redeem: (code: string) => boolean
}

export function useSupporter(): UseSupporterReturn {
  const prefs = usePreferencesStore()
  return {
    isSupporter: computed(() => prefs.isSupporter),
    canRedeem: isSupporterCodeConfigured(),
    redeem: (code: string) => prefs.redeemSupporterCode(code),
  }
}
