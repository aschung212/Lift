import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock Vue lifecycle hooks since we're testing outside a component
vi.mock('vue', async () => {
  const actual = await vi.importActual<typeof import('vue')>('vue')
  return {
    ...actual,
    onUnmounted: vi.fn(),
  }
})

describe('useInstallPrompt', () => {
  let addEventSpy: ReturnType<typeof vi.spyOn>
  let matchMediaSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    localStorage.clear()
    addEventSpy = vi.spyOn(window, 'addEventListener')
    matchMediaSpy = vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
    } as MediaQueryList)

    // Default: not iOS, not standalone
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0',
      configurable: true,
    })
    Object.defineProperty(navigator, 'platform', {
      value: 'Linux armv81',
      configurable: true,
    })
    Object.defineProperty(navigator, 'maxTouchPoints', {
      value: 5,
      configurable: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  async function loadComposable() {
    const mod = await import('../useInstallPrompt')
    return mod.useInstallPrompt()
  }

  it('starts with banner hidden', async () => {
    const { showBanner } = await loadComposable()
    expect(showBanner.value).toBe(false)
  })

  it('registers beforeinstallprompt listener', async () => {
    await loadComposable()
    expect(addEventSpy).toHaveBeenCalledWith('beforeinstallprompt', expect.any(Function))
  })

  it('does not register listener if already in standalone mode', async () => {
    matchMediaSpy.mockReturnValue({ matches: true } as MediaQueryList)
    await loadComposable()
    expect(addEventSpy).not.toHaveBeenCalledWith('beforeinstallprompt', expect.any(Function))
  })

  it('does not register listener if previously dismissed', async () => {
    localStorage.setItem('pwa-install-dismissed', 'true')
    await loadComposable()
    expect(addEventSpy).not.toHaveBeenCalledWith('beforeinstallprompt', expect.any(Function))
  })

  it('shows banner after engagement threshold with deferred prompt', async () => {
    const { showBanner, checkEngagement } = await loadComposable()

    // Simulate beforeinstallprompt event
    const handler = addEventSpy.mock.calls.find(c => c[0] === 'beforeinstallprompt')?.[1] as EventListener
    const fakeEvent = { preventDefault: vi.fn(), prompt: vi.fn(), userChoice: Promise.resolve({ outcome: 'accepted' }) }
    handler(fakeEvent as unknown as Event)

    // Not enough training days
    checkEngagement!(2)
    expect(showBanner.value).toBe(false)

    // Meets threshold
    checkEngagement!(3)
    expect(showBanner.value).toBe(true)
  })

  it('does not show banner without deferred prompt on non-iOS', async () => {
    const { showBanner, checkEngagement } = await loadComposable()

    // No beforeinstallprompt fired, not iOS
    checkEngagement!(5)
    expect(showBanner.value).toBe(false)
  })

  it('shows iOS instructions on iOS Safari', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      configurable: true,
    })
    Object.defineProperty(navigator, 'platform', {
      value: 'iPhone',
      configurable: true,
    })

    const { showBanner, isIOS, checkEngagement } = await loadComposable()
    expect(isIOS.value).toBe(true)

    checkEngagement!(3)
    expect(showBanner.value).toBe(true)
  })

  it('does not show iOS banner for Chrome on iOS', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1',
      configurable: true,
    })
    Object.defineProperty(navigator, 'platform', {
      value: 'iPhone',
      configurable: true,
    })

    const { isIOS } = await loadComposable()
    expect(isIOS.value).toBe(false)
  })

  it('dismiss hides banner and persists to localStorage', async () => {
    const { showBanner, checkEngagement, dismiss } = await loadComposable()

    // Simulate deferred prompt
    const handler = addEventSpy.mock.calls.find(c => c[0] === 'beforeinstallprompt')?.[1] as EventListener
    handler({ preventDefault: vi.fn(), prompt: vi.fn(), userChoice: Promise.resolve({ outcome: 'dismissed' }) } as unknown as Event)

    checkEngagement!(3)
    expect(showBanner.value).toBe(true)

    dismiss()
    expect(showBanner.value).toBe(false)
    expect(localStorage.getItem('pwa-install-dismissed')).toBe('true')
  })

  it('triggerInstall calls prompt on deferred event', async () => {
    const { triggerInstall, checkEngagement } = await loadComposable()

    const promptFn = vi.fn()
    const fakeEvent = {
      preventDefault: vi.fn(),
      prompt: promptFn,
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    }

    const handler = addEventSpy.mock.calls.find(c => c[0] === 'beforeinstallprompt')?.[1] as EventListener
    handler(fakeEvent as unknown as Event)

    checkEngagement!(3)
    await triggerInstall()

    expect(promptFn).toHaveBeenCalledOnce()
  })

  it('hides banner after successful install', async () => {
    const { showBanner, triggerInstall, checkEngagement } = await loadComposable()

    const fakeEvent = {
      preventDefault: vi.fn(),
      prompt: vi.fn(),
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    }

    const handler = addEventSpy.mock.calls.find(c => c[0] === 'beforeinstallprompt')?.[1] as EventListener
    handler(fakeEvent as unknown as Event)

    checkEngagement!(3)
    expect(showBanner.value).toBe(true)

    await triggerInstall()
    expect(showBanner.value).toBe(false)
  })

  it('prevents default on beforeinstallprompt to suppress native banner', async () => {
    await loadComposable()

    const preventDefault = vi.fn()
    const handler = addEventSpy.mock.calls.find(c => c[0] === 'beforeinstallprompt')?.[1] as EventListener
    handler({ preventDefault, prompt: vi.fn(), userChoice: Promise.resolve({ outcome: 'dismissed' }) } as unknown as Event)

    expect(preventDefault).toHaveBeenCalledOnce()
  })
})
