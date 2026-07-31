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
    it('hides banner and persists dismissal', () => {
      const state = useInstallPrompt(() => 5)
      const mockEvent = { preventDefault: vi.fn() }
      fireWindowEvent('beforeinstallprompt', mockEvent)

      expect(state.showBanner.value).toBe(true)

      state.dismiss()
      expect(state.showBanner.value).toBe(false)
      expect(localStorage.getItem('install-prompt-dismissed')).toBe('true')
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
      expect(localStorage.getItem('install-prompt-dismissed')).toBe('true')
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
      expect(localStorage.getItem('install-prompt-dismissed')).toBe('true')
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
  })

  describe('install funnel analytics (LIFT-1061)', () => {
    it('logs prompt_available (not deferred) and a single banner_shown impression on Chromium', () => {
      const logEvent = vi.fn()
      const state = useInstallPrompt(() => 5, logEvent)
      const mockEvent = { preventDefault: vi.fn() }
      fireWindowEvent('beforeinstallprompt', mockEvent)

      expect(state.showBanner.value).toBe(true)
      expect(logEvent).toHaveBeenCalledWith('install_prompt_available', { deferred: false })
      expect(logEvent).toHaveBeenCalledWith('install_banner_shown', { platform: 'chromium' })
      expect(logEvent.mock.calls.filter(([n]) => n === 'install_banner_shown')).toHaveLength(1)
    })

    it('marks prompt_available as deferred when the engagement threshold is not yet met', () => {
      const logEvent = vi.fn()
      useInstallPrompt(() => 1, logEvent)
      fireWindowEvent('beforeinstallprompt', { preventDefault: vi.fn() })

      expect(logEvent).toHaveBeenCalledWith('install_prompt_available', { deferred: true })
      expect(logEvent).not.toHaveBeenCalledWith('install_banner_shown', expect.anything())
    })

    it('logs a single banner_shown when a deferred prompt reveals after hydration', async () => {
      const logEvent = vi.fn()
      const dayCount = ref(0)
      useInstallPrompt(dayCount, logEvent)
      fireWindowEvent('beforeinstallprompt', { preventDefault: vi.fn() })

      dayCount.value = 5
      await nextTick()

      expect(logEvent.mock.calls.filter(([n]) => n === 'install_banner_shown')).toHaveLength(1)
      expect(logEvent).toHaveBeenCalledWith('install_banner_shown', { platform: 'chromium' })
    })

    it('logs prompt_result with the native outcome', async () => {
      const logEvent = vi.fn()
      const state = useInstallPrompt(() => 5, logEvent)
      fireWindowEvent('beforeinstallprompt', {
        preventDefault: vi.fn(),
        prompt: vi.fn(),
        userChoice: Promise.resolve({ outcome: 'accepted' }),
      })

      await state.install()
      expect(logEvent).toHaveBeenCalledWith('install_prompt_result', { outcome: 'accepted' })
    })

    it('logs banner_dismissed only when the banner was visible', () => {
      const logEvent = vi.fn()
      const state = useInstallPrompt(() => 5, logEvent)
      fireWindowEvent('beforeinstallprompt', { preventDefault: vi.fn() })

      state.dismiss()
      expect(logEvent).toHaveBeenCalledWith('install_banner_dismissed', { platform: 'chromium' })

      logEvent.mockClear()
      state.dismiss()
      expect(logEvent).not.toHaveBeenCalledWith('install_banner_dismissed', expect.anything())
    })

    it('logs app_installed on the appinstalled event', () => {
      const logEvent = vi.fn()
      useInstallPrompt(() => 5, logEvent)
      fireWindowEvent('appinstalled')
      expect(logEvent).toHaveBeenCalledWith('app_installed', undefined)
    })

    it('never lets a throwing logger break the banner', () => {
      const logEvent = vi.fn(() => { throw new Error('analytics down') })
      const state = useInstallPrompt(() => 5, logEvent)
      expect(() => fireWindowEvent('beforeinstallprompt', { preventDefault: vi.fn() })).not.toThrow()
      expect(state.showBanner.value).toBe(true)
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
