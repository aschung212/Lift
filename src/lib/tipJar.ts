/**
 * Native in-app-purchase "tip jar" bridge — issue LIFT-910.
 *
 * Wraps a StoreKit *consumable* purchase, exposed on iOS via the RevenueCat
 * Capacitor plugin (`@revenuecat/purchases-capacitor`, the plugin adopted in
 * LIFT-598). A tip moves money and says thank you — it does NOT grant the
 * supporter entitlement (that is LIFT-598 / `useSupporter`'s job), so the tip
 * jar is deliberately independent of the entitlement flow and can ship ahead of
 * it. This is the App-Store-compliant replacement for the external
 * "Buy Me a Coffee" / GitHub Sponsors links (which guideline 3.1.1 forbids in a
 * native build — see LIFT-909).
 *
 * On web there is no StoreKit, so every export here no-ops. The plugin is loaded
 * through a runtime-constructed dynamic import so the web bundle never statically
 * depends on it; it is installed + configured as part of the native IAP setup
 * (LIFT-598). Until then these resolve to `unavailable` / `[]` on every platform.
 * The decision + analytics logic lives in `useTipJar` and is fully unit-tested
 * independent of this native bridge.
 */
import { isNative } from './platform'
import { logWarn } from './logger'

// Constructed at runtime so the bundler does not attempt to resolve the
// native-only plugin during the web build (mirrors `appReview.ts`).
const IAP_PLUGIN = ['@revenuecat', 'purchases-capacitor'].join('/')

/** The tip amounts offered in the jar, smallest to largest. */
export type TipTierId = 'small' | 'medium' | 'large'

export interface TipTier {
  id: TipTierId
  /**
   * App Store Connect product identifier. These follow the app's reverse-DNS
   * bundle id (`com.aschung212.lift`, read from `capacitor.config.ts`) and MUST
   * be created as **consumable** in-app-purchase products in App Store Connect
   * with these exact identifiers before the native build can transact them.
   */
  productId: string
  /** Short human label shown on the tip row. */
  label: string
}

export const TIP_TIERS: readonly TipTier[] = [
  { id: 'small', productId: 'com.aschung212.lift.tip.small', label: 'Small tip' },
  { id: 'medium', productId: 'com.aschung212.lift.tip.medium', label: 'Medium tip' },
  { id: 'large', productId: 'com.aschung212.lift.tip.large', label: 'Large tip' },
] as const

/** Outcome of a tip purchase attempt. */
export type TipPurchaseStatus = 'completed' | 'cancelled' | 'error' | 'unavailable'

export interface TipPurchaseResult {
  status: TipPurchaseStatus
}

// Minimal structural views of the RevenueCat Capacitor API surface we touch.
// Kept intentionally narrow + optional so a plugin-shape mismatch degrades to
// `error`/`unavailable` rather than throwing into the caller.
interface StoreProduct {
  identifier: string
  priceString?: string
}
interface PurchasesPlugin {
  getProducts?: (opts: {
    productIdentifiers: string[]
    type?: string
  }) => Promise<{ products?: StoreProduct[] }>
  purchaseStoreProduct?: (opts: { product: StoreProduct }) => Promise<unknown>
}

async function loadPlugin(): Promise<PurchasesPlugin | null> {
  if (!isNative) return null
  try {
    const mod = (await import(/* @vite-ignore */ IAP_PLUGIN)) as {
      Purchases?: PurchasesPlugin
    }
    return mod.Purchases ?? null
  } catch (e) {
    // Plugin not installed yet (pending native IAP setup, LIFT-598).
    logWarn('Tip jar IAP plugin unavailable', { error: String(e) })
    return null
  }
}

/**
 * Fetch localized StoreKit prices for every tip tier, keyed by product id.
 *
 * Returns `{}` on web or when the plugin/products are unavailable, so callers
 * render tier labels without a price rather than a fabricated one — the real
 * price always comes from StoreKit, never a hardcoded string.
 */
export async function getTipPrices(): Promise<Record<string, string>> {
  const plugin = await loadPlugin()
  if (!plugin?.getProducts) return {}
  try {
    const { products } = await plugin.getProducts({
      productIdentifiers: TIP_TIERS.map(t => t.productId),
      type: 'INAPP',
    })
    const prices: Record<string, string> = {}
    for (const p of products ?? []) {
      if (p?.identifier && typeof p.priceString === 'string') prices[p.identifier] = p.priceString
    }
    return prices
  } catch (e) {
    logWarn('Tip jar price fetch failed', { error: String(e) })
    return {}
  }
}

/**
 * Present the StoreKit purchase sheet for a tip product.
 *
 * Resolves to `unavailable` on web / when the plugin is not installed,
 * `cancelled` when the user dismisses the sheet, `completed` on a successful
 * transaction, and `error` for any other failure. Never throws — a failed tip
 * must not break the settings screen.
 */
export async function purchaseTip(productId: string): Promise<TipPurchaseResult> {
  const plugin = await loadPlugin()
  if (!plugin?.getProducts || !plugin.purchaseStoreProduct) return { status: 'unavailable' }
  try {
    const { products } = await plugin.getProducts({ productIdentifiers: [productId], type: 'INAPP' })
    const product = (products ?? []).find(p => p?.identifier === productId)
    if (!product) return { status: 'unavailable' }
    await plugin.purchaseStoreProduct({ product })
    return { status: 'completed' }
  } catch (e) {
    // RevenueCat surfaces a user-initiated dismissal as `userCancelled: true`.
    if (e && typeof e === 'object' && (e as { userCancelled?: boolean }).userCancelled) {
      return { status: 'cancelled' }
    }
    logWarn('Tip jar purchase failed', { error: String(e) })
    return { status: 'error' }
  }
}
