/**
 * Supporter (paid tier) entitlement — single read-side source of truth (issue #601).
 *
 * Read this anywhere the free vs. paid experience diverges. Today the only
 * consumer is the share-card "Made with Lift" watermark: free users get the
 * watermark, supporters get clean cards.
 *
 * The entitlement itself is owned and driven by `usePurchases` (LIFT-598), which
 * wires it to native App Store IAP; this composable is the stable, read-only
 * accessor so gated surfaces don't couple to the purchase machinery.
 */

import { type Ref } from 'vue'
import { supporterEntitlement } from './usePurchases'

export interface UseSupporterReturn {
  /** True when the user has an active supporter entitlement. */
  isSupporter: Readonly<Ref<boolean>>
}

export function useSupporter(): UseSupporterReturn {
  return { isSupporter: supporterEntitlement }
}
