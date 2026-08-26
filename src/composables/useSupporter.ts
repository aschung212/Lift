/**
 * Supporter (paid tier) entitlement — single source of truth (issue #601).
 *
 * Read this anywhere the free vs. paid experience diverges. Today the only
 * consumer is the share-card "Made with Lift" watermark: free users get the
 * watermark, supporters get clean cards.
 *
 * Module-level singleton ref so the value is global, not per-component.
 */

import { readonly, ref, type Ref } from 'vue'
import { isNative } from '../lib/platform'

// TODO(LIFT-598): wire this to the RevenueCat / Capacitor IAP entitlement
// (or the Supabase profile flag synced from it) once App Store purchases
// ship. Stubbed to `false` so the free tier — including the watermark — is
// the default for everyone until then.
const _isSupporter = ref(false)

/**
 * Outcome of a restore-purchases attempt.
 * - `restored`: a prior entitlement was recovered and applied.
 * - `none`: the restore succeeded but found no purchases to recover.
 * - `unavailable`: restoring is not supported on this build (web has no IAP).
 * - `error`: the restore failed and can be retried.
 */
export type RestoreResult = 'restored' | 'none' | 'unavailable' | 'error'

/**
 * Restore a previously-purchased Supporter entitlement (App Store Guideline
 * 3.1.1, LIFT-1201). Restoring only means something on the native IAP build —
 * the web support channel is GitHub Sponsors / Buy Me a Coffee, which grants no
 * restorable entitlement — so the web build reports `unavailable`.
 */
async function restorePurchases(): Promise<RestoreResult> {
  if (!isNative) return 'unavailable'
  // TODO(LIFT-598): call the RevenueCat / Capacitor IAP restore API and set
  // `_isSupporter` from the recovered entitlement. Until purchases ship there
  // is nothing to restore, so report `none` truthfully rather than faking a
  // successful restore.
  return 'none'
}

export interface UseSupporterReturn {
  /** True when the user has an active supporter entitlement. */
  isSupporter: Readonly<Ref<boolean>>
  /** Attempt to recover a previously-purchased entitlement (native IAP). */
  restorePurchases: () => Promise<RestoreResult>
}

export function useSupporter(): UseSupporterReturn {
  return { isSupporter: readonly(_isSupporter), restorePurchases }
}
