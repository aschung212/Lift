import { describe, it, expect } from 'vitest'
import {
  SUPPORTER_ENTITLEMENT_ID,
  SUPPORTER_PRODUCTS,
  getSupporterProduct,
  getRecommendedSupporterProduct,
  isLifetimeProduct,
} from '../supporterProducts'

describe('supporter product catalog (LIFT-1205)', () => {
  it('offers a one-time lifetime unlock, not only a subscription', () => {
    const lifetime = SUPPORTER_PRODUCTS.filter((p) => p.model === 'lifetime')
    const subscriptions = SUPPORTER_PRODUCTS.filter((p) => p.model === 'subscription')
    expect(lifetime.length).toBeGreaterThanOrEqual(1)
    expect(subscriptions.length).toBeGreaterThanOrEqual(1)
  })

  it('leads with the lifetime unlock as the single recommended option', () => {
    const recommended = SUPPORTER_PRODUCTS.filter((p) => p.recommended)
    expect(recommended).toHaveLength(1)
    expect(recommended[0].model).toBe('lifetime')
    expect(getRecommendedSupporterProduct()).toBe(recommended[0])
  })

  it('orders the recommended lifetime unlock first for display', () => {
    expect(SUPPORTER_PRODUCTS[0].id).toBe('lifetime')
  })

  it('gives lifetime a null billing period and subscriptions a cadence', () => {
    for (const product of SUPPORTER_PRODUCTS) {
      if (product.model === 'lifetime') {
        expect(product.period).toBeNull()
      } else {
        expect(product.period).not.toBeNull()
      }
    }
  })

  it('uses unique app ids and unique store SKUs across the catalog', () => {
    const ids = SUPPORTER_PRODUCTS.map((p) => p.id)
    const skus = SUPPORTER_PRODUCTS.map((p) => p.storeProductId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(skus).size).toBe(skus.length)
  })

  it('does not hardcode prices — the store supplies them at runtime', () => {
    for (const product of SUPPORTER_PRODUCTS) {
      expect(product).not.toHaveProperty('price')
    }
  })

  it('looks a product up by id and returns undefined for unknown ids', () => {
    expect(getSupporterProduct('lifetime')?.model).toBe('lifetime')
    expect(getSupporterProduct('nope')).toBeUndefined()
  })

  it('detects the lifetime (non-consumable) product', () => {
    expect(isLifetimeProduct(getRecommendedSupporterProduct())).toBe(true)
    const annual = getSupporterProduct('annual')
    expect(annual && isLifetimeProduct(annual)).toBe(false)
  })

  it('keeps a single shared entitlement id so all products grant the same perks', () => {
    expect(SUPPORTER_ENTITLEMENT_ID).toBe('supporter')
  })
})
