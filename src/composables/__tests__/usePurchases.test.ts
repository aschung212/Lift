import { describe, it, expect, vi, beforeEach } from 'vitest'

const configurePurchases = vi.fn()
const fetchActiveEntitlements = vi.fn()
const purchaseProduct = vi.fn()
const restorePurchases = vi.fn()

async function loadModule(isNative: boolean) {
  vi.resetModules()
  configurePurchases.mockReset()
  fetchActiveEntitlements.mockReset()
  purchaseProduct.mockReset()
  restorePurchases.mockReset()
  vi.doMock('../../lib/platform', () => ({ isNative }))
  vi.doMock('../../lib/nativePurchases', () => ({
    SUPPORTER_ENTITLEMENT: 'supporter',
    configurePurchases,
    fetchActiveEntitlements,
    purchaseProduct,
    restorePurchases,
  }))
  return import('../usePurchases')
}

describe('usePurchases on web', () => {
  beforeEach(() => vi.resetModules())

  it('starts as a non-supporter (fails closed)', async () => {
    const { usePurchases } = await loadModule(false)
    expect(usePurchases().isSupporter.value).toBe(false)
  })

  it('initializePurchases no-ops on web', async () => {
    const mod = await loadModule(false)
    await mod.initializePurchases('rc_key')
    expect(configurePurchases).not.toHaveBeenCalled()
    expect(mod.usePurchases().isConfigured.value).toBe(false)
  })

  it('purchaseSupporter no-ops on web and returns false', async () => {
    const mod = await loadModule(false)
    await expect(mod.purchaseSupporter('lift.supporter')).resolves.toBe(false)
    expect(purchaseProduct).not.toHaveBeenCalled()
  })

  it('restoreSupporterPurchases no-ops on web and returns false', async () => {
    const mod = await loadModule(false)
    await expect(mod.restoreSupporterPurchases()).resolves.toBe(false)
    expect(restorePurchases).not.toHaveBeenCalled()
  })
})

describe('usePurchases on native', () => {
  beforeEach(() => vi.resetModules())

  it('initializePurchases configures and hydrates the entitlement', async () => {
    const mod = await loadModule(true)
    configurePurchases.mockResolvedValue(true)
    fetchActiveEntitlements.mockResolvedValue(['supporter'])
    await mod.initializePurchases('rc_key')
    expect(configurePurchases).toHaveBeenCalledWith('rc_key')
    expect(mod.usePurchases().isConfigured.value).toBe(true)
    expect(mod.usePurchases().isSupporter.value).toBe(true)
  })

  it('initializePurchases with no key leaves the free tier intact', async () => {
    const mod = await loadModule(true)
    await mod.initializePurchases(undefined)
    expect(configurePurchases).not.toHaveBeenCalled()
    expect(mod.usePurchases().isSupporter.value).toBe(false)
  })

  it('initializePurchases does not hydrate when configure fails', async () => {
    const mod = await loadModule(true)
    configurePurchases.mockResolvedValue(false)
    await mod.initializePurchases('rc_key')
    expect(fetchActiveEntitlements).not.toHaveBeenCalled()
    expect(mod.usePurchases().isConfigured.value).toBe(false)
  })

  it('initializePurchases configures at most once', async () => {
    const mod = await loadModule(true)
    configurePurchases.mockResolvedValue(true)
    fetchActiveEntitlements.mockResolvedValue([])
    await mod.initializePurchases('rc_key')
    await mod.initializePurchases('rc_key')
    expect(configurePurchases).toHaveBeenCalledTimes(1)
  })

  it('purchaseSupporter grants the entitlement on success', async () => {
    const mod = await loadModule(true)
    purchaseProduct.mockResolvedValue(['supporter'])
    await expect(mod.purchaseSupporter('lift.supporter')).resolves.toBe(true)
    expect(purchaseProduct).toHaveBeenCalledWith('lift.supporter')
    expect(mod.usePurchases().isSupporter.value).toBe(true)
  })

  it('purchaseSupporter leaves state unchanged on cancel (null result)', async () => {
    const mod = await loadModule(true)
    purchaseProduct.mockResolvedValue(null)
    await expect(mod.purchaseSupporter('lift.supporter')).resolves.toBe(false)
    expect(mod.usePurchases().isSupporter.value).toBe(false)
  })

  it('purchaseSupporter clears the in-flight flag after completing', async () => {
    const mod = await loadModule(true)
    purchaseProduct.mockResolvedValue(['supporter'])
    await mod.purchaseSupporter('lift.supporter')
    expect(mod.usePurchases().isPurchasing.value).toBe(false)
  })

  it('restoreSupporterPurchases grants the entitlement when restored', async () => {
    const mod = await loadModule(true)
    restorePurchases.mockResolvedValue(['supporter'])
    await expect(mod.restoreSupporterPurchases()).resolves.toBe(true)
    expect(mod.usePurchases().isSupporter.value).toBe(true)
  })

  it('restoreSupporterPurchases stays false when nothing to restore', async () => {
    const mod = await loadModule(true)
    restorePurchases.mockResolvedValue([])
    await expect(mod.restoreSupporterPurchases()).resolves.toBe(false)
    expect(mod.usePurchases().isSupporter.value).toBe(false)
  })
})

describe('useSupporter reads the purchase entitlement', () => {
  beforeEach(() => vi.resetModules())

  it('reflects a native purchase through useSupporter', async () => {
    vi.resetModules()
    vi.doMock('../../lib/platform', () => ({ isNative: true }))
    vi.doMock('../../lib/nativePurchases', () => ({
      SUPPORTER_ENTITLEMENT: 'supporter',
      configurePurchases,
      fetchActiveEntitlements,
      purchaseProduct: vi.fn().mockResolvedValue(['supporter']),
      restorePurchases,
    }))
    const { purchaseSupporter } = await import('../usePurchases')
    const { useSupporter } = await import('../useSupporter')
    const { isSupporter } = useSupporter()
    expect(isSupporter.value).toBe(false)
    await purchaseSupporter('lift.supporter')
    expect(isSupporter.value).toBe(true)
  })
})
