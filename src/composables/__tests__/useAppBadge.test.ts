import { describe, it, expect, vi, afterEach } from 'vitest'
import { useAppBadge } from '../useAppBadge'

/** Install mock Badging API methods on navigator; returns the spies. */
function mockBadgingApi(overrides?: {
  setAppBadge?: () => Promise<void>
  clearAppBadge?: () => Promise<void>
}) {
  const setAppBadge = vi.fn(overrides?.setAppBadge ?? (() => Promise.resolve()))
  const clearAppBadge = vi.fn(overrides?.clearAppBadge ?? (() => Promise.resolve()))
  Object.defineProperty(navigator, 'setAppBadge', { value: setAppBadge, configurable: true })
  Object.defineProperty(navigator, 'clearAppBadge', { value: clearAppBadge, configurable: true })
  return { setAppBadge, clearAppBadge }
}

function removeBadgingApi() {
  // @ts-expect-error test cleanup
  delete navigator.setAppBadge
  // @ts-expect-error test cleanup
  delete navigator.clearAppBadge
}

describe('useAppBadge', () => {
  afterEach(() => {
    removeBadgingApi()
    vi.restoreAllMocks()
  })

  describe('isSupported', () => {
    it('returns true when setAppBadge exists on navigator', () => {
      mockBadgingApi()
      expect(useAppBadge().isSupported()).toBe(true)
    })

    it('returns false when the Badging API is absent', () => {
      removeBadgingApi()
      expect(useAppBadge().isSupported()).toBe(false)
    })
  })

  describe('setBadge', () => {
    it('passes a positive count through to navigator.setAppBadge', async () => {
      const { setAppBadge } = mockBadgingApi()
      const ok = await useAppBadge().setBadge(3)
      expect(ok).toBe(true)
      expect(setAppBadge).toHaveBeenCalledWith(3)
    })

    it('shows a generic dot (undefined) when count is 0 or omitted', async () => {
      const { setAppBadge } = mockBadgingApi()
      await useAppBadge().setBadge(0)
      await useAppBadge().setBadge()
      expect(setAppBadge).toHaveBeenNthCalledWith(1, undefined)
      expect(setAppBadge).toHaveBeenNthCalledWith(2, undefined)
    })

    it('returns false and does not throw when unsupported', async () => {
      removeBadgingApi()
      const ok = await useAppBadge().setBadge(2)
      expect(ok).toBe(false)
    })

    it('returns false when the platform rejects the request', async () => {
      const { setAppBadge } = mockBadgingApi({
        setAppBadge: () => Promise.reject(new Error('denied')),
      })
      const ok = await useAppBadge().setBadge(1)
      expect(ok).toBe(false)
      expect(setAppBadge).toHaveBeenCalled()
    })
  })

  describe('clearBadge', () => {
    it('calls navigator.clearAppBadge', async () => {
      const { clearAppBadge } = mockBadgingApi()
      const ok = await useAppBadge().clearBadge()
      expect(ok).toBe(true)
      expect(clearAppBadge).toHaveBeenCalled()
    })

    it('returns false and does not throw when unsupported', async () => {
      removeBadgingApi()
      const ok = await useAppBadge().clearBadge()
      expect(ok).toBe(false)
    })

    it('returns false when the platform rejects the request', async () => {
      mockBadgingApi({ clearAppBadge: () => Promise.reject(new Error('nope')) })
      const ok = await useAppBadge().clearBadge()
      expect(ok).toBe(false)
    })
  })
})
