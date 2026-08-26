/**
 * Supporter product catalog (LIFT-1205).
 *
 * Settles the product-model decision that shapes the entitlement schema BEFORE
 * the RevenueCat / Capacitor IAP purchase flow (LIFT-598) is wired: Lift leads
 * with a one-time LIFETIME unlock, with an optional recurring subscription as a
 * lower-commitment alternative. For a local-first utility logger a lifetime
 * unlock converts better than a subscription and matches Lift's "optional
 * support, no paywall" ethos far better than a monthly charge for a free app.
 *
 * This module is pure catalog + selection logic (no Vue, no IAP SDK) so the
 * schema is testable and stable regardless of how purchases are later wired.
 * Every product grants the SAME single entitlement (`SUPPORTER_ENTITLEMENT_ID`)
 * — the app never checks WHICH product a user bought, only whether they hold
 * the supporter entitlement, so a lifetime buyer and a subscriber get identical
 * perks (clean share cards LIFT-601, data export LIFT-603, deeper AI Coach
 * LIFT-904).
 *
 * `storeProductId` is the identifier that must be registered in App Store
 * Connect and mapped to the entitlement in RevenueCat; it is Lift's own product
 * SKU convention, not an external/third-party identifier.
 */

/**
 * The single entitlement every Supporter product grants. Perks gate on this,
 * never on the specific product purchased.
 */
export const SUPPORTER_ENTITLEMENT_ID = 'supporter' as const

/** Billing shape of a supporter product. */
export type SupporterBillingModel = 'lifetime' | 'subscription'

/** Renewal cadence for subscription products; `null` for a one-time lifetime unlock. */
export type SupporterBillingPeriod = 'monthly' | 'annual' | null

export interface SupporterProduct {
  /** Stable app-internal id (used for analytics + selection). */
  readonly id: string
  /**
   * Store SKU to register in App Store Connect and map to the supporter
   * entitlement in RevenueCat. Lift's own product identifier convention.
   */
  readonly storeProductId: string
  /** Whether this is a one-time unlock or a recurring subscription. */
  readonly model: SupporterBillingModel
  /** Renewal cadence for subscriptions; `null` for lifetime. */
  readonly period: SupporterBillingPeriod
  /** Short display label (e.g. "Lifetime"). */
  readonly label: string
  /** One-line value framing shown under the label. */
  readonly tagline: string
  /**
   * True for the option Lift leads with. Exactly one product is recommended
   * (the lifetime unlock) so the upsell surface has an unambiguous default.
   */
  readonly recommended: boolean
}

/**
 * The Supporter catalog, ordered for display: the recommended lifetime unlock
 * first, subscription alternative second. Prices are intentionally NOT hardcoded
 * here — they come from the store (RevenueCat `Package`) at runtime so they stay
 * correct across regions/currencies and never drift from App Store Connect.
 */
export const SUPPORTER_PRODUCTS: readonly SupporterProduct[] = [
  {
    id: 'lifetime',
    storeProductId: 'lift.supporter.lifetime',
    model: 'lifetime',
    period: null,
    label: 'Lifetime',
    tagline: 'Pay once, supporter forever',
    recommended: true,
  },
  {
    id: 'annual',
    storeProductId: 'lift.supporter.annual',
    model: 'subscription',
    period: 'annual',
    label: 'Yearly',
    tagline: 'Recurring support, cancel anytime',
    recommended: false,
  },
] as const

/** Look up a product by its app-internal id. */
export function getSupporterProduct(id: string): SupporterProduct | undefined {
  return SUPPORTER_PRODUCTS.find((p) => p.id === id)
}

/**
 * The option Lift leads with (the lifetime unlock). Falls back to the first
 * catalog entry if no product is flagged recommended, so callers always get a
 * default to preselect.
 */
export function getRecommendedSupporterProduct(): SupporterProduct {
  return SUPPORTER_PRODUCTS.find((p) => p.recommended) ?? SUPPORTER_PRODUCTS[0]
}

/** True when a product is the one-time lifetime unlock (non-consumable). */
export function isLifetimeProduct(product: SupporterProduct): boolean {
  return product.model === 'lifetime'
}
