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

// Bumped on every `resetPurchases()` (sign-out). An async purchase/restore/init
// captures the epoch at entry and only writes entitlement state if it still
// matches — so a call that resolves AFTER a sign-out can't leak the previous
// user's entitlement into the next user's session on a shared device.
let _epoch = 0

/** Shared source of truth for the supporter entitlement — read via `useSupporter`. */
export const supporterEntitlement: Readonly<Ref<boolean>> = readonly(_isSupporter)

function applyEntitlements(entitlements: string[]): void {
  _isSupporter.value = entitlements.includes(SUPPORTER_ENTITLEMENT)
}

/** True while any purchase/restore is in flight — a single busy gate so a
 * concurrent purchase and restore can't race to overwrite each other's result. */
function isBusy(): boolean {
  return _isPurchasing.value || _isRestoring.value
}

/**
 * Configure the purchase SDK and hydrate the current entitlement. Safe to call
 * on every launch: no-ops on web, configures at most once on native, and a
 * missing `apiKey` (an unprovisioned build) leaves the free tier intact. Pass
 * the signed-in user id as `appUserId` so RevenueCat associates entitlements
 * with a stable identity rather than an anonymous one.
 */
export async function initializePurchases(
  apiKey: string | undefined,
  appUserId?: string
): Promise<void> {
  if (!isNative || _isConfigured.value || !apiKey) return
  const epoch = _epoch
  if (!(await configurePurchases(apiKey, appUserId)) || epoch !== _epoch) return
  _isConfigured.value = true
  const entitlements = await fetchActiveEntitlements()
  if (epoch === _epoch) applyEntitlements(entitlements)
}

/**
 * Purchase the Supporter product. Resolves `true` once the entitlement is active.
 * No-ops while any purchase/restore is in flight; a cancelled purchase leaves
 * state unchanged.
 */
export async function purchaseSupporter(productId: string): Promise<boolean> {
  if (!isNative || isBusy()) return false
  const epoch = _epoch
  _isPurchasing.value = true
  try {
    const entitlements = await purchaseProduct(productId)
    if (epoch !== _epoch) return false
    if (entitlements) applyEntitlements(entitlements)
    return _isSupporter.value
  } finally {
    if (epoch === _epoch) _isPurchasing.value = false
  }
}

/**
 * Restore prior purchases (an App Store requirement). Resolves `true` if the
 * supporter entitlement is active afterwards. No-ops while any purchase/restore
 * is in flight.
 */
export async function restoreSupporterPurchases(): Promise<boolean> {
  if (!isNative || isBusy()) return false
  const epoch = _epoch
  _isRestoring.value = true
  try {
    const entitlements = await nativeRestorePurchases()
    if (epoch !== _epoch) return false
    if (entitlements) applyEntitlements(entitlements)
    return _isSupporter.value
  } finally {
    if (epoch === _epoch) _isRestoring.value = false
  }
}

/**
 * Clear all purchase state on sign-out (shared-device safety). Resets the
 * entitlement to the free tier and allows `initializePurchases` to re-configure
 * and re-hydrate for the next signed-in user — a supporter signing out must
 * never leave the next user with their entitlement. Bumping the epoch also
 * neutralizes any purchase/restore/init still in flight so it can't write the
 * old user's entitlement after the reset.
 */
export function resetPurchases(): void {
  _epoch++
  _isSupporter.value = false
  _isConfigured.value = false
  _isPurchasing.value = false
  _isRestoring.value = false
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
