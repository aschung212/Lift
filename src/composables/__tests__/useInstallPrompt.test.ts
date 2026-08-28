import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, nextTick } from 'vue'

// Mock platform module before importing composable
vi.mock('../../lib/platform', () => ({
  isNative: false,
  isIOS: false,
  platform: 'web',
}))

let useInstallPrompt: typeof import('../useInstallPrompt').useInstallPrompt
let isStandalone: typeof import('../useInstallPrompt').isStandalone

// Track event listeners added to window
let windowListeners: Record<string, Array<(...args: unknown[]) => void>>

function addWindowListener(event: string, handler: (...args: unknown[]) => void) {
  if (!windowListeners[event]) windowListeners[event] = []
  windowListeners[event].push(handler)
}

function fireWindowEvent(event: string, detail?: unknown) {
  const handlers = windowListeners[event] || []
  for (const handler of handlers) {
    handler(detail ?? new Event(event))
  }
}

function mockMatchMedia(standalone = false) {
  vi.spyOn(window, 'matchMedia').mockReturnValue({
    matches: standalone,
    media: standalone ? '(display-mode: standalone)' : '',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })
}

describe('useInstallPrompt', () => {
  let addEventSpy: ReturnType<typeof vi.spyOn>
  let removeEventSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.resetModules()
    windowListeners = {}
    localStorage.clear()

    vi.doMock('../../lib/platform', () => ({
      isNative: false,
      isIOS: false,
      platform: 'web',
    }))

    addEventSpy = vi.spyOn(window, 'addEventListener').mockImplementation(
      (event: string, handler: unknown) => addWindowListener(event, handler as (...args: unknown[]) => void)
    )
    removeEventSpy = vi.spyOn(window, 'removeEventListener').mockImplementation(() => {})
    mockMatchMedia(false)

    const mod = await import('../useInstallPrompt')
    useInstallPrompt = mod.useInstallPrompt
    isStandalone = mod.isStandalone
  })

  afterEach(() => {
    addEventSpy.mockRestore()
    removeEventSpy.mockRestore()
    vi.restoreAllMocks()
  })

  describe('isStandalone', () => {
    it('returns false when display-mode is not standalone', () => {
      expect(isStandalone()).toBe(false)
    })

    it('returns true when display-mode matches standalone', () => {
      mockMatchMedia(true)
      expect(isStandalone()).toBe(true)
    })

    it('returns true when navigator.standalone is true (iOS Safari)', () => {
      Object.defineProperty(navigator, 'standalone', {
        value: true,
        configurable: true,
      })
      expect(isStandalone()).toBe(true)
      delete (navigator as unknown as { standalone?: boolean }).standalone
    })
  })

  describe('banner visibility', () => {
    it('does not show banner before engagement threshold', () => {
      const state = useInstallPrompt(() => 2)
      expect(state.showBanner.value).toBe(false)
    })

    it('shows banner when beforeinstallprompt fires and threshold met', async () => {
      const state = useInstallPrompt(() => 5)
      const mockEvent = { preventDefault: vi.fn() }
      fireWindowEvent('beforeinstallprompt', mockEvent)
      await nextTick()

      expect(mockEvent.preventDefault).toHaveBeenCalled()
      expect(state.showBanner.value).toBe(true)
      expect(state.isIOSPrompt.value).toBe(false)
    })

    it('does not show banner if user previously dismissed', () => {
      localStorage.setItem('install-prompt-dismissed', 'true')
      const state = useInstallPrompt(() => 10)

      const mockEvent = { preventDefault: vi.fn() }
      fireWindowEvent('beforeinstallprompt', mockEvent)

      expect(state.showBanner.value).toBe(false)
    })

    it('does not show banner when already in standalone mode', () => {
      mockMatchMedia(true)

      const state = useInstallPrompt(() => 10)
      const mockEvent = { preventDefault: vi.fn() }
      fireWindowEvent('beforeinstallprompt', mockEvent)

      expect(state.showBanner.value).toBe(false)
    })
  })

  describe('async store hydration (watch)', () => {
    it('shows banner after data hydrates past threshold (Chromium)', async () => {
      const dayCount = ref(0)
      const state = useInstallPrompt(dayCount)

      // beforeinstallprompt fires before store is hydrated
      const mockEvent = { preventDefault: vi.fn() }
      fireWindowEvent('beforeinstallprompt', mockEvent)
      expect(state.showBanner.value).toBe(false)

      // Simulate store hydration completing
      dayCount.value = 5
      await nextTick()

      expect(state.showBanner.value).toBe(true)
      expect(state.isIOSPrompt.value).toBe(false)
    })

    it('shows iOS prompt after data hydrates past threshold', async () => {
      vi.resetModules()
      vi.doMock('../../lib/platform', () => ({
        isNative: false,
        isIOS: true,
        platform: 'web',
      }))

      windowListeners = {}
      vi.spyOn(window, 'addEventListener').mockImplementation(
        (event: string, handler: unknown) => addWindowListener(event, handler as (...args: unknown[]) => void)
      )
      mockMatchMedia(false)

      const mod = await import('../useInstallPrompt')
      const dayCount = ref(0)
      const state = mod.useInstallPrompt(dayCount)

      expect(state.showBanner.value).toBe(false)

      // Simulate store hydration
      dayCount.value = 4
      await nextTick()

      expect(state.showBanner.value).toBe(true)
      expect(state.isIOSPrompt.value).toBe(true)
    })

    it('does not re-show banner after user dismissed', async () => {
      const dayCount = ref(0)
      const state = useInstallPrompt(dayCount)

      const mockEvent = { preventDefault: vi.fn() }
      fireWindowEvent('beforeinstallprompt', mockEvent)
      dayCount.value = 5
      await nextTick()

      expect(state.showBanner.value).toBe(true)
      state.dismiss()
      expect(state.showBanner.value).toBe(false)

      // Further changes to day count should not re-show
      dayCount.value = 10
      await nextTick()
      expect(state.showBanner.value).toBe(false)
    })
  })

  describe('dismiss', () => {
    it('hides banner and persists a dismissal timestamp (snooze, not forever)', () => {
      const now = 1_700_000_000_000
      vi.spyOn(Date, 'now').mockReturnValue(now)
      const state = useInstallPrompt(() => 5)
      const mockEvent = { preventDefault: vi.fn() }
      fireWindowEvent('beforeinstallprompt', mockEvent)

      expect(state.showBanner.value).toBe(true)

      state.dismiss()
      expect(state.showBanner.value).toBe(false)
      // A timestamp is stored so the prompt can re-surface after the snooze window.
      expect(localStorage.getItem('install-prompt-dismissed')).toBe(String(now))
    })

    it('keeps the prompt suppressed while the snooze window is active', () => {
      const now = 1_700_000_000_000
      vi.spyOn(Date, 'now').mockReturnValue(now)
      // Dismissed 10 days ago — still inside the 30-day snooze.
      localStorage.setItem('install-prompt-dismissed', String(now - 10 * 24 * 60 * 60 * 1000))

      const state = useInstallPrompt(() => 10)
      const mockEvent = { preventDefault: vi.fn() }
      fireWindowEvent('beforeinstallprompt', mockEvent)

      expect(state.showBanner.value).toBe(false)
    })

    it('re-surfaces the prompt once the snooze window has elapsed', () => {
      const now = 1_700_000_000_000
      vi.spyOn(Date, 'now').mockReturnValue(now)
      // Dismissed 31 days ago — snooze has expired.
      localStorage.setItem('install-prompt-dismissed', String(now - 31 * 24 * 60 * 60 * 1000))

      const state = useInstallPrompt(() => 10)
      const mockEvent = { preventDefault: vi.fn() }
      fireWindowEvent('beforeinstallprompt', mockEvent)

      expect(state.showBanner.value).toBe(true)
    })

    it('treats a legacy "true" dismissal flag as a permanent suppression', () => {
      localStorage.setItem('install-prompt-dismissed', 'true')
      const state = useInstallPrompt(() => 10)
      const mockEvent = { preventDefault: vi.fn() }
      fireWindowEvent('beforeinstallprompt', mockEvent)

      expect(state.showBanner.value).toBe(false)
    })
  })

  describe('surfaceAtPeakMoment', () => {
    it('re-surfaces the banner (bypassing the engagement gate) when a deferred prompt exists', () => {
      // Below MIN_WORKOUT_DAYS — the normal gate would keep the banner hidden.
      const state = useInstallPrompt(() => 1)
      const mockEvent = { preventDefault: vi.fn() }
      fireWindowEvent('beforeinstallprompt', mockEvent)
      expect(state.showBanner.value).toBe(false)

      state.surfaceAtPeakMoment()
      expect(state.showBanner.value).toBe(true)
      expect(state.isIOSPrompt.value).toBe(false)
    })

    it('does not re-surface while an install has been recorded', () => {
      localStorage.setItem('install-prompt-installed', '1')
      const state = useInstallPrompt(() => 5)
      const mockEvent = { preventDefault: vi.fn() }
      fireWindowEvent('beforeinstallprompt', mockEvent)

      state.surfaceAtPeakMoment()
      expect(state.showBanner.value).toBe(false)
    })

    it('does not re-surface while a dismissal snooze is active', () => {
      const now = 1_700_000_000_000
      vi.spyOn(Date, 'now').mockReturnValue(now)
      const state = useInstallPrompt(() => 5)
      const mockEvent = { preventDefault: vi.fn() }
      fireWindowEvent('beforeinstallprompt', mockEvent)
      state.dismiss()
      expect(state.showBanner.value).toBe(false)

      state.surfaceAtPeakMoment()
      expect(state.showBanner.value).toBe(false)
    })
  })

  describe('install', () => {
    it('calls prompt() on the deferred event and hides on accept', async () => {
      const state = useInstallPrompt(() => 5)
      const mockEvent = {
        preventDefault: vi.fn(),
        prompt: vi.fn(),
        userChoice: Promise.resolve({ outcome: 'accepted' }),
      }
      fireWindowEvent('beforeinstallprompt', mockEvent)

      await state.install()

      expect(mockEvent.prompt).toHaveBeenCalled()
      expect(state.showBanner.value).toBe(false)
      // Install acceptance is a permanent suppression, tracked separately from
      // the dismiss snooze.
      expect(localStorage.getItem('install-prompt-installed')).toBe('1')
    })

    it('hides banner when user declines native install dialog', async () => {
      const state = useInstallPrompt(() => 5)
      const mockEvent = {
        preventDefault: vi.fn(),
        prompt: vi.fn(),
        userChoice: Promise.resolve({ outcome: 'dismissed' }),
      }
      fireWindowEvent('beforeinstallprompt', mockEvent)
      expect(state.showBanner.value).toBe(true)

      await state.install()

      expect(mockEvent.prompt).toHaveBeenCalled()
      // Banner hides regardless — native prompt can only fire once
      expect(state.showBanner.value).toBe(false)
      // But dismissal is NOT persisted — user can see it again next session
      expect(localStorage.getItem('install-prompt-dismissed')).toBeNull()
    })

    it('no-ops when no deferred prompt exists', async () => {
      const state = useInstallPrompt(() => 5)
      await state.install()
      expect(state.showBanner.value).toBe(false)
    })
  })

  describe('appinstalled event', () => {
    it('hides banner when app is installed', () => {
      const state = useInstallPrompt(() => 5)
      const mockEvent = { preventDefault: vi.fn() }
      fireWindowEvent('beforeinstallprompt', mockEvent)
      expect(state.showBanner.value).toBe(true)

      fireWindowEvent('appinstalled')
      expect(state.showBanner.value).toBe(false)
      expect(localStorage.getItem('install-prompt-installed')).toBe('1')
    })
  })

  describe('iOS Safari', () => {
    it('shows iOS-specific prompt when on iOS and threshold met', async () => {
      vi.resetModules()
      vi.doMock('../../lib/platform', () => ({
        isNative: false,
        isIOS: true,
        platform: 'web',
      }))

      windowListeners = {}
      vi.spyOn(window, 'addEventListener').mockImplementation(
        (event: string, handler: unknown) => addWindowListener(event, handler as (...args: unknown[]) => void)
      )
      mockMatchMedia(false)

      const mod = await import('../useInstallPrompt')
      const state = mod.useInstallPrompt(() => 5)

      expect(state.showBanner.value).toBe(true)
      expect(state.isIOSPrompt.value).toBe(true)
    })

    it('does not show iOS prompt when already standalone', async () => {
      vi.resetModules()
      vi.doMock('../../lib/platform', () => ({
        isNative: false,
        isIOS: true,
        platform: 'web',
      }))

      windowListeners = {}
      vi.spyOn(window, 'addEventListener').mockImplementation(
        (event: string, handler: unknown) => addWindowListener(event, handler as (...args: unknown[]) => void)
      )
      mockMatchMedia(true)

      const mod = await import('../useInstallPrompt')
      const state = mod.useInstallPrompt(() => 5)

      expect(state.showBanner.value).toBe(false)
    })

    it('surfaceAtPeakMoment shows the iOS prompt below the engagement gate', async () => {
      vi.resetModules()
      vi.doMock('../../lib/platform', () => ({
        isNative: false,
        isIOS: true,
        platform: 'web',
      }))

      windowListeners = {}
      vi.spyOn(window, 'addEventListener').mockImplementation(
        (event: string, handler: unknown) => addWindowListener(event, handler as (...args: unknown[]) => void)
      )
      mockMatchMedia(false)

      const mod = await import('../useInstallPrompt')
      // Below MIN_WORKOUT_DAYS — normal gate keeps it hidden.
      const state = mod.useInstallPrompt(() => 0)
      expect(state.showBanner.value).toBe(false)

      state.surfaceAtPeakMoment()
      expect(state.showBanner.value).toBe(true)
      expect(state.isIOSPrompt.value).toBe(true)
    })
  })

  describe('event listener cleanup', () => {
    it('registers beforeinstallprompt and appinstalled listeners', () => {
      useInstallPrompt(() => 0)
      const events = Object.keys(windowListeners)
      expect(events).toContain('beforeinstallprompt')
      expect(events).toContain('appinstalled')
    })

    it('removes event listeners when destroy() is called', () => {
      const state = useInstallPrompt(() => 0)
      state.destroy()
      expect(removeEventSpy).toHaveBeenCalledWith('beforeinstallprompt', expect.any(Function))
      expect(removeEventSpy).toHaveBeenCalledWith('appinstalled', expect.any(Function))
    })
  })
})
