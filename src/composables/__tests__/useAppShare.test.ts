import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { APP_URL, APP_NAME, APP_TAGLINE } from '../../lib/appMeta'

// ── Mocks ──────────────────────────────────────────────────────────────
// useAppShare reads `isNative` from platform at module scope, so each test
// re-imports the composable after mocking platform to the desired value.

const mockCapacitorShare = vi.fn()
vi.mock('@capacitor/share', () => ({
  Share: { share: (...args: unknown[]) => mockCapacitorShare(...args) },
}))

async function getComposable(isNative: boolean) {
  vi.resetModules()
  vi.doMock('../../lib/platform', () => ({ isNative, isIOS: isNative, platform: isNative ? 'ios' : 'web' }))
  vi.doMock('@capacitor/share', () => ({
    Share: { share: (...args: unknown[]) => mockCapacitorShare(...args) },
  }))
  const { useAppShare } = await import('../useAppShare')
  return useAppShare()
}

describe('useAppShare', () => {
  beforeEach(() => {
    mockCapacitorShare.mockReset()
    // Default web environment: no Web Share API, no clipboard.
    Object.defineProperty(navigator, 'share', { value: undefined, writable: true, configurable: true })
    Object.defineProperty(navigator, 'clipboard', { value: undefined, writable: true, configurable: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.doUnmock('../../lib/platform')
  })

  it('isSharing starts as false', async () => {
    const { isSharing } = await getComposable(false)
    expect(isSharing.value).toBe(false)
  })

  // ── Native tier ──────────────────────────────────────────────────────

  describe('native (Capacitor)', () => {
    it('shares via the Capacitor Share plugin with the canonical payload', async () => {
      mockCapacitorShare.mockResolvedValue(undefined)
      const { shareApp } = await getComposable(true)
      const res = await shareApp()

      expect(res).toEqual({ kind: 'shared' })
      expect(mockCapacitorShare).toHaveBeenCalledWith(
        expect.objectContaining({ title: APP_NAME, text: APP_TAGLINE, url: APP_URL }),
      )
    })

    it('returns cancelled when the native sheet is dismissed', async () => {
      mockCapacitorShare.mockRejectedValue(new Error('Share canceled'))
      const { shareApp } = await getComposable(true)
      const res = await shareApp()
      expect(res).toEqual({ kind: 'cancelled' })
    })

    it('falls back to clipboard when the native plugin fails unexpectedly', async () => {
      mockCapacitorShare.mockRejectedValue(new Error('plugin not implemented'))
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, writable: true, configurable: true })

      const { shareApp } = await getComposable(true)
      const res = await shareApp()

      expect(res).toEqual({ kind: 'copied' })
      expect(writeText).toHaveBeenCalledWith(APP_URL)
    })
  })

  // ── Web Share tier ───────────────────────────────────────────────────

  describe('web (Web Share API)', () => {
    it('uses navigator.share when available', async () => {
      const shareFn = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'share', { value: shareFn, writable: true, configurable: true })

      const { shareApp } = await getComposable(false)
      const res = await shareApp()

      expect(res).toEqual({ kind: 'shared' })
      expect(shareFn).toHaveBeenCalledWith({ title: APP_NAME, text: APP_TAGLINE, url: APP_URL })
      expect(mockCapacitorShare).not.toHaveBeenCalled()
    })

    it('returns cancelled on AbortError', async () => {
      const shareFn = vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError'))
      Object.defineProperty(navigator, 'share', { value: shareFn, writable: true, configurable: true })

      const { shareApp } = await getComposable(false)
      const res = await shareApp()
      expect(res).toEqual({ kind: 'cancelled' })
    })

    it('falls back to clipboard when Web Share throws a non-cancel error', async () => {
      const shareFn = vi.fn().mockRejectedValue(new Error('NotAllowedError'))
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'share', { value: shareFn, writable: true, configurable: true })
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, writable: true, configurable: true })

      const { shareApp } = await getComposable(false)
      const res = await shareApp()

      expect(res).toEqual({ kind: 'copied' })
      expect(writeText).toHaveBeenCalledWith(APP_URL)
    })
  })

  // ── Clipboard fallback tier ──────────────────────────────────────────

  describe('clipboard fallback', () => {
    it('copies the URL when no share API exists', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, writable: true, configurable: true })

      const { shareApp } = await getComposable(false)
      const res = await shareApp()

      expect(res).toEqual({ kind: 'copied' })
      expect(writeText).toHaveBeenCalledWith(APP_URL)
    })

    it('returns unavailable when neither share nor clipboard works', async () => {
      const { shareApp } = await getComposable(false)
      const res = await shareApp()
      expect(res).toEqual({ kind: 'unavailable' })
    })

    it('returns unavailable when clipboard write rejects', async () => {
      const writeText = vi.fn().mockRejectedValue(new Error('blocked'))
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, writable: true, configurable: true })

      const { shareApp } = await getComposable(false)
      const res = await shareApp()
      expect(res).toEqual({ kind: 'unavailable' })
    })
  })

  // ── Reentrancy ───────────────────────────────────────────────────────

  it('guards against concurrent shares', async () => {
    let resolveShare!: () => void
    const shareFn = vi.fn().mockReturnValue(new Promise<void>((r) => { resolveShare = r }))
    Object.defineProperty(navigator, 'share', { value: shareFn, writable: true, configurable: true })

    const { shareApp, isSharing } = await getComposable(false)
    const first = shareApp()
    expect(isSharing.value).toBe(true)

    const second = await shareApp()
    expect(second).toEqual({ kind: 'cancelled' })
    expect(shareFn).toHaveBeenCalledTimes(1)

    resolveShare()
    expect(await first).toEqual({ kind: 'shared' })
  })
})
