/**
 * Native bridge for in-app purchases / the Supporter entitlement (LIFT-598).
 *
 * Uses Capacitor's `registerPlugin` so the web build has ZERO static dependency
 * on a native-only StoreKit/RevenueCat plugin — the proxy is only ever invoked
 * inside a real native shell. On web (and in tests) every call is a no-op that
 * fails closed to the free tier. The matching iOS `LiftPurchases` plugin delegates
 * to RevenueCat's StoreKit SDK and is wired up in the Capacitor iOS build (see
 * `docs/iap.md` for the native provisioning step). Mirrors the `nativeAppIcon`
 * seam so the app never hard-depends on a third-party purchase package here.
 */
import { registerPlugin } from '@capacitor/core'
import { isNative } from './platform'
import { logError } from './logger'

/**
 * Entitlement identifier that grants the Supporter tier. The native plugin maps
 * RevenueCat's set of active entitlements onto this string; the web build never
 * sees it (fails closed). Must match the entitlement configured in the RevenueCat
 * dashboard when native IAP is provisioned.
 */
export const SUPPORTER_ENTITLEMENT = 'supporter'

export interface PurchasesPlugin {
  /** Configure the underlying purchase SDK with the RevenueCat public key. */
  configure(options: { apiKey: string; appUserId?: string }): Promise<void>
  /** Return the identifiers of the currently active entitlements. */
  getActiveEntitlements(): Promise<{ entitlements: string[] }>
  /** Purchase a product; resolves with the post-purchase active entitlements. */
  purchaseProduct(options: { productId: string }): Promise<{ entitlements: string[] }>
  /** Restore prior purchases; resolves with the restored active entitlements. */
  restorePurchases(): Promise<{ entitlements: string[] }>
}

const Purchases = registerPlugin<PurchasesPlugin>('LiftPurchases')

/**
 * Configure the native purchase SDK. No-ops on web; returns whether the SDK was
 * configured (false on web or on failure), swallowing native errors.
 */
export async function configurePurchases(apiKey: string, appUserId?: string): Promise<boolean> {
  if (!isNative) return false
  try {
    await Purchases.configure({ apiKey, appUserId })
    return true
  } catch (e) {
    logError(e, { source: 'nativePurchases.configure' })
    return false
  }
}

/** Read the active entitlement identifiers. Returns `[]` on web or failure. */
export async function fetchActiveEntitlements(): Promise<string[]> {
  if (!isNative) return []
  try {
    const { entitlements } = await Purchases.getActiveEntitlements()
    return Array.isArray(entitlements) ? entitlements : []
  } catch (e) {
    logError(e, { source: 'nativePurchases.getActiveEntitlements' })
    return []
  }
}

/**
 * Purchase a product. Resolves with the post-purchase entitlement list, or
 * `null` when the purchase did not complete — web, user-cancel, or store
 * failure. A `null` result means "no change", so callers never downgrade an
 * existing entitlement on a cancelled purchase.
 */
export async function purchaseProduct(productId: string): Promise<string[] | null> {
  if (!isNative) return null
  try {
    const { entitlements } = await Purchases.purchaseProduct({ productId })
    return Array.isArray(entitlements) ? entitlements : []
  } catch (e) {
    logError(e, { source: 'nativePurchases.purchaseProduct', productId })
    return null
  }
}

/**
 * Restore prior purchases (an App Store requirement for non-consumable IAP).
 * Returns the restored entitlement list (`[]` on web or failure).
 */
export async function restorePurchases(): Promise<string[]> {
  if (!isNative) return []
  try {
    const { entitlements } = await Purchases.restorePurchases()
    return Array.isArray(entitlements) ? entitlements : []
  } catch (e) {
    logError(e, { source: 'nativePurchases.restorePurchases' })
    return []
  }
}
