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
import {
  SUPPORTER_PRODUCTS,
  getRecommendedSupporterProduct,
  type SupporterProduct,
} from '../lib/supporterProducts'

// TODO(LIFT-598): wire this to the RevenueCat / Capacitor IAP entitlement
// (or the Supabase profile flag synced from it) once App Store purchases
// ship. Stubbed to `false` so the free tier — including the watermark — is
// the default for everyone until then.
const _isSupporter = ref(false)

export interface UseSupporterReturn {
  /** True when the user has an active supporter entitlement. */
  isSupporter: Readonly<Ref<boolean>>
  /**
   * The Supporter product catalog (LIFT-1205), ordered for display: the
   * one-time lifetime unlock first, subscription alternative second. Prices come
   * from the store at purchase time, not from here.
   */
  products: readonly SupporterProduct[]
  /** The option to preselect / lead with — the lifetime unlock. */
  recommendedProduct: SupporterProduct
}

export function useSupporter(): UseSupporterReturn {
  return {
    isSupporter: readonly(_isSupporter),
    products: SUPPORTER_PRODUCTS,
    recommendedProduct: getRecommendedSupporterProduct(),
  }
}
