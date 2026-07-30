/**
 * Supporter purchase orchestration (LIFT-598) — the app-side seam over native IAP.
 *
 * Owns the reactive supporter-entitlement state and the purchase/restore flows,
 * delegating the actual StoreKit/RevenueCat calls to `nativePurchases`. On web
 * everything fails closed to the free tier. `useSupporter` reads the entitlement
 * this module owns, so wiring a real purchase here lights up every gated surface
 * (today: the share-card watermark) with no further changes.
 *
 * Module-level singletons so entitlement state is global, not per-component.
 */
import { readonly, ref, type Ref } from 'vue'
import {
  SUPPORTER_ENTITLEMENT,
  configurePurchases,
  fetchActiveEntitlements,
  purchaseProduct,
  restorePurchases as nativeRestorePurchases,
} from '../lib/nativePurchases'
import { isNative } from '../lib/platform'

const _isSupporter = ref(false)
const _isConfigured = ref(false)
const _isPurchasing = ref(false)
const _isRestoring = ref(false)

/** Shared source of truth for the supporter entitlement — read via `useSupporter`. */
export const supporterEntitlement: Readonly<Ref<boolean>> = readonly(_isSupporter)

function applyEntitlements(entitlements: string[]): void {
  _isSupporter.value = entitlements.includes(SUPPORTER_ENTITLEMENT)
}

/**
 * Configure the purchase SDK and hydrate the current entitlement. Safe to call
 * on every launch: no-ops on web, configures at most once on native, and a
 * missing `apiKey` (an unprovisioned build) leaves the free tier intact.
 */
export async function initializePurchases(apiKey: string | undefined): Promise<void> {
  if (!isNative || _isConfigured.value || !apiKey) return
  if (await configurePurchases(apiKey)) {
    _isConfigured.value = true
    applyEntitlements(await fetchActiveEntitlements())
  }
}

/**
 * Purchase the Supporter product. Resolves `true` once the entitlement is active.
 * Guards against concurrent taps; a cancelled purchase leaves state unchanged.
 */
export async function purchaseSupporter(productId: string): Promise<boolean> {
  if (!isNative || _isPurchasing.value) return false
  _isPurchasing.value = true
  try {
    const entitlements = await purchaseProduct(productId)
    if (entitlements) applyEntitlements(entitlements)
    return _isSupporter.value
  } finally {
    _isPurchasing.value = false
  }
}

/**
 * Restore prior purchases (an App Store requirement). Resolves `true` if the
 * supporter entitlement is active afterwards. Guards against concurrent taps.
 */
export async function restoreSupporterPurchases(): Promise<boolean> {
  if (!isNative || _isRestoring.value) return false
  _isRestoring.value = true
  try {
    const entitlements = await nativeRestorePurchases()
    if (entitlements) applyEntitlements(entitlements)
    return _isSupporter.value
  } finally {
    _isRestoring.value = false
  }
}

export interface UsePurchasesReturn {
  /** True when the user has an active supporter entitlement. */
  isSupporter: Readonly<Ref<boolean>>
  /** True once the native purchase SDK has been configured this session. */
  isConfigured: Readonly<Ref<boolean>>
  /** True while a purchase is in flight (drive button spinners / disabled state). */
  isPurchasing: Readonly<Ref<boolean>>
  /** True while a restore is in flight. */
  isRestoring: Readonly<Ref<boolean>>
  purchaseSupporter: (productId: string) => Promise<boolean>
  restoreSupporterPurchases: () => Promise<boolean>
}

export function usePurchases(): UsePurchasesReturn {
  return {
    isSupporter: supporterEntitlement,
    isConfigured: readonly(_isConfigured),
    isPurchasing: readonly(_isPurchasing),
    isRestoring: readonly(_isRestoring),
    purchaseSupporter,
    restoreSupporterPurchases,
  }
}
