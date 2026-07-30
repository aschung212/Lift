import { describe, it, expect, vi, beforeEach } from 'vitest'

const configure = vi.fn()
const getActiveEntitlements = vi.fn()
const purchaseProduct = vi.fn()
const restorePurchases = vi.fn()

async function loadModule(isNative: boolean) {
  vi.resetModules()
  configure.mockReset()
  getActiveEntitlements.mockReset()
  purchaseProduct.mockReset()
  restorePurchases.mockReset()
  vi.doMock('../platform', () => ({ isNative }))
  vi.doMock('@capacitor/core', () => ({
    registerPlugin: () => ({
      configure,
      getActiveEntitlements,
      purchaseProduct,
      restorePurchases,
    }),
  }))
  vi.doMock('../logger', () => ({ logError: vi.fn() }))
  return import('../nativePurchases')
}

describe('nativePurchases on web', () => {
  beforeEach(() => vi.resetModules())

  it('configurePurchases is a no-op returning false', async () => {
    const { configurePurchases } = await loadModule(false)
    await expect(configurePurchases('key')).resolves.toBe(false)
    expect(configure).not.toHaveBeenCalled()
  })

  it('fetchActiveEntitlements returns [] without touching the plugin', async () => {
    const { fetchActiveEntitlements } = await loadModule(false)
    await expect(fetchActiveEntitlements()).resolves.toEqual([])
    expect(getActiveEntitlements).not.toHaveBeenCalled()
  })

  it('purchaseProduct returns null without touching the plugin', async () => {
    const { purchaseProduct: purchase } = await loadModule(false)
    await expect(purchase('lift.supporter')).resolves.toBeNull()
    expect(purchaseProduct).not.toHaveBeenCalled()
  })

  it('restorePurchases returns [] without touching the plugin', async () => {
    const { restorePurchases: restore } = await loadModule(false)
    await expect(restore()).resolves.toEqual([])
    expect(restorePurchases).not.toHaveBeenCalled()
  })
})

describe('nativePurchases on native', () => {
  beforeEach(() => vi.resetModules())

  it('exposes the supporter entitlement id constant', async () => {
    const { SUPPORTER_ENTITLEMENT } = await loadModule(true)
    expect(SUPPORTER_ENTITLEMENT).toBe('supporter')
  })

  it('configurePurchases forwards the api key and returns true', async () => {
    const { configurePurchases } = await loadModule(true)
    configure.mockResolvedValue(undefined)
    await expect(configurePurchases('rc_key', 'user-1')).resolves.toBe(true)
    expect(configure).toHaveBeenCalledWith({ apiKey: 'rc_key', appUserId: 'user-1' })
  })

  it('configurePurchases returns false and swallows plugin errors', async () => {
    const { configurePurchases } = await loadModule(true)
    configure.mockRejectedValue(new Error('not implemented'))
    await expect(configurePurchases('rc_key')).resolves.toBe(false)
  })

  it('fetchActiveEntitlements maps the plugin entitlement list', async () => {
    const { fetchActiveEntitlements } = await loadModule(true)
    getActiveEntitlements.mockResolvedValue({ entitlements: ['supporter'] })
    await expect(fetchActiveEntitlements()).resolves.toEqual(['supporter'])
  })

  it('fetchActiveEntitlements returns [] when the plugin returns a non-array', async () => {
    const { fetchActiveEntitlements } = await loadModule(true)
    getActiveEntitlements.mockResolvedValue({ entitlements: undefined })
    await expect(fetchActiveEntitlements()).resolves.toEqual([])
  })

  it('fetchActiveEntitlements returns [] when the plugin throws', async () => {
    const { fetchActiveEntitlements } = await loadModule(true)
    getActiveEntitlements.mockRejectedValue(new Error('boom'))
    await expect(fetchActiveEntitlements()).resolves.toEqual([])
  })

  it('purchaseProduct forwards the product id and returns entitlements', async () => {
    const { purchaseProduct: purchase } = await loadModule(true)
    purchaseProduct.mockResolvedValue({ entitlements: ['supporter'] })
    await expect(purchase('lift.supporter')).resolves.toEqual(['supporter'])
    expect(purchaseProduct).toHaveBeenCalledWith({ productId: 'lift.supporter' })
  })

  it('purchaseProduct returns null when the plugin throws (cancel/failure)', async () => {
    const { purchaseProduct: purchase } = await loadModule(true)
    purchaseProduct.mockRejectedValue(new Error('cancelled'))
    await expect(purchase('lift.supporter')).resolves.toBeNull()
  })

  it('restorePurchases maps the restored entitlement list', async () => {
    const { restorePurchases: restore } = await loadModule(true)
    restorePurchases.mockResolvedValue({ entitlements: ['supporter'] })
    await expect(restore()).resolves.toEqual(['supporter'])
  })

  it('restorePurchases returns [] when the plugin throws', async () => {
    const { restorePurchases: restore } = await loadModule(true)
    restorePurchases.mockRejectedValue(new Error('boom'))
    await expect(restore()).resolves.toEqual([])
  })
})
