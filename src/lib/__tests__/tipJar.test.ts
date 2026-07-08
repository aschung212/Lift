import { describe, it, expect, vi, beforeEach } from 'vitest'

// The native bridge branches entirely on `isNative`; individual tests re-mock it.
vi.mock('../platform', () => ({ isNative: true, isIOS: true, platform: 'ios' }))

// A settable fake for the runtime-imported RevenueCat plugin. `purchaseTip` /
// `getTipPrices` build the module specifier at runtime (`@revenuecat` +
// `purchases-capacitor`), so we intercept that exact specifier.
let pluginModule: unknown = null
vi.mock('@revenuecat/purchases-capacitor', () => pluginModule as object, { virtual: true } as never)

let tipJar: typeof import('../tipJar')

async function load(opts: { native?: boolean; plugin?: unknown } = {}) {
  const { native = true, plugin = null } = opts
  vi.resetModules()
  vi.doMock('../platform', () => ({ isNative: native, isIOS: native, platform: native ? 'ios' : 'web' }))
  pluginModule = plugin
  vi.doMock('@revenuecat/purchases-capacitor', () => plugin as object)
  tipJar = await import('../tipJar')
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('tipJar catalog', () => {
  it('exposes three reverse-DNS consumable product ids', async () => {
    await load()
    expect(tipJar.TIP_TIERS.map(t => t.id)).toEqual(['small', 'medium', 'large'])
    for (const tier of tipJar.TIP_TIERS) {
      expect(tier.productId).toMatch(/^com\.aschung212\.lift\.tip\.[a-z]+$/)
      expect(tier.label.length).toBeGreaterThan(0)
    }
  })

  it('uses distinct product ids per tier', async () => {
    await load()
    const ids = tipJar.TIP_TIERS.map(t => t.productId)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('purchaseTip', () => {
  const productId = 'com.aschung212.lift.tip.small'

  it('is unavailable on web (no StoreKit)', async () => {
    await load({ native: false })
    expect(await tipJar.purchaseTip(productId)).toEqual({ status: 'unavailable' })
  })

  it('is unavailable when the plugin is not installed', async () => {
    await load({ native: true, plugin: null })
    expect(await tipJar.purchaseTip(productId)).toEqual({ status: 'unavailable' })
  })

  it('is unavailable when the product cannot be fetched from StoreKit', async () => {
    const Purchases = {
      getProducts: vi.fn(() => Promise.resolve({ products: [] })),
      purchaseStoreProduct: vi.fn(),
    }
    await load({ plugin: { Purchases } })
    expect(await tipJar.purchaseTip(productId)).toEqual({ status: 'unavailable' })
    expect(Purchases.purchaseStoreProduct).not.toHaveBeenCalled()
  })

  it('completes a successful purchase', async () => {
    const product = { identifier: productId, priceString: '$1.99' }
    const Purchases = {
      getProducts: vi.fn(() => Promise.resolve({ products: [product] })),
      purchaseStoreProduct: vi.fn(() => Promise.resolve({ transaction: {} })),
    }
    await load({ plugin: { Purchases } })
    expect(await tipJar.purchaseTip(productId)).toEqual({ status: 'completed' })
    expect(Purchases.purchaseStoreProduct).toHaveBeenCalledWith({ product })
  })

  it('maps a user cancellation to cancelled', async () => {
    const product = { identifier: productId, priceString: '$1.99' }
    const Purchases = {
      getProducts: vi.fn(() => Promise.resolve({ products: [product] })),
      purchaseStoreProduct: vi.fn(() => Promise.reject({ userCancelled: true })),
    }
    await load({ plugin: { Purchases } })
    expect(await tipJar.purchaseTip(productId)).toEqual({ status: 'cancelled' })
  })

  it('maps any other failure to error', async () => {
    const product = { identifier: productId, priceString: '$1.99' }
    const Purchases = {
      getProducts: vi.fn(() => Promise.resolve({ products: [product] })),
      purchaseStoreProduct: vi.fn(() => Promise.reject(new Error('network'))),
    }
    await load({ plugin: { Purchases } })
    expect(await tipJar.purchaseTip(productId)).toEqual({ status: 'error' })
  })
})

describe('getTipPrices', () => {
  it('returns an empty map on web', async () => {
    await load({ native: false })
    expect(await tipJar.getTipPrices()).toEqual({})
  })

  it('returns an empty map when the plugin is absent', async () => {
    await load({ native: true, plugin: null })
    expect(await tipJar.getTipPrices()).toEqual({})
  })

  it('maps StoreKit localized prices by product id', async () => {
    const Purchases = {
      getProducts: vi.fn(() =>
        Promise.resolve({
          products: [
            { identifier: 'com.aschung212.lift.tip.small', priceString: '$1.99' },
            { identifier: 'com.aschung212.lift.tip.medium', priceString: '$4.99' },
          ],
        }),
      ),
    }
    await load({ plugin: { Purchases } })
    expect(await tipJar.getTipPrices()).toEqual({
      'com.aschung212.lift.tip.small': '$1.99',
      'com.aschung212.lift.tip.medium': '$4.99',
    })
  })

  it('returns an empty map when the price fetch throws', async () => {
    const Purchases = { getProducts: vi.fn(() => Promise.reject(new Error('boom'))) }
    await load({ plugin: { Purchases } })
    expect(await tipJar.getTipPrices()).toEqual({})
  })
})
