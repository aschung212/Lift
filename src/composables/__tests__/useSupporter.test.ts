import { describe, it, expect, vi } from 'vitest'
import { useSupporter } from '../useSupporter'

// `isNative` is read live from ../lib/platform via a getter so each test can
// flip the platform without re-importing the module under test.
const platform = vi.hoisted(() => ({ native: false }))
vi.mock('../../lib/platform', () => ({
  get isNative() { return platform.native },
}))

describe('useSupporter', () => {
  it('defaults isSupporter to false (free tier for everyone until IAP ships)', () => {
    const { isSupporter } = useSupporter()
    expect(isSupporter.value).toBe(false)
  })

  describe('restorePurchases (LIFT-1201)', () => {
    it('reports "unavailable" on the web build (no restorable IAP entitlement)', async () => {
      platform.native = false
      const { restorePurchases } = useSupporter()
      await expect(restorePurchases()).resolves.toBe('unavailable')
    })

    it('reports "none" on native until purchases are wired (no faked success)', async () => {
      platform.native = true
      const { restorePurchases } = useSupporter()
      await expect(restorePurchases()).resolves.toBe('none')
    })

    it('never flips a non-supporter to supporter (nothing to restore yet)', async () => {
      platform.native = true
      const { isSupporter, restorePurchases } = useSupporter()
      await restorePurchases()
      expect(isSupporter.value).toBe(false)
    })
  })
})
