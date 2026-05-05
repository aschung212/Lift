import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useInstallPrompt, _resetForTesting } from '../useInstallPrompt'

const STORAGE_KEY = 'pwa-install-prompt'

function fireBeforeInstallPrompt() {
  const promptMock = vi.fn().mockResolvedValue(undefined)
  const event = new Event('beforeinstallprompt', { cancelable: true })
  Object.assign(event, {
    prompt: promptMock,
    userChoice: Promise.resolve({ outcome: 'dismissed' as const }),
  })
  window.dispatchEvent(event)
  return promptMock
}

describe('useInstallPrompt', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
    _resetForTesting()
  })

  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  it('does not show banner initially (no sets logged)', () => {
    const { showBanner } = useInstallPrompt()
    expect(showBanner.value).toBe(false)
  })

  it('does not show banner until 3 sets are logged', () => {
    const { showBanner, trackSetLogged } = useInstallPrompt()
    fireBeforeInstallPrompt()
    trackSetLogged()
    trackSetLogged()
    expect(showBanner.value).toBe(false)
  })

  it('shows banner after 3 sets logged when beforeinstallprompt fires', () => {
    const { showBanner, trackSetLogged } = useInstallPrompt()
    fireBeforeInstallPrompt()
    trackSetLogged()
    trackSetLogged()
    trackSetLogged()
    expect(showBanner.value).toBe(true)
  })

  it('shows banner on iOS after 3 sets (no beforeinstallprompt needed)', () => {
    const originalUA = navigator.userAgent
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      configurable: true,
    })

    const { showBanner, trackSetLogged } = useInstallPrompt()
    trackSetLogged()
    trackSetLogged()
    trackSetLogged()
    expect(showBanner.value).toBe(true)

    Object.defineProperty(navigator, 'userAgent', {
      value: originalUA,
      configurable: true,
    })
  })

  it('hides banner after dismiss', () => {
    const { showBanner, trackSetLogged, dismissBanner } = useInstallPrompt()
    fireBeforeInstallPrompt()
    trackSetLogged()
    trackSetLogged()
    trackSetLogged()
    expect(showBanner.value).toBe(true)

    dismissBanner()
    expect(showBanner.value).toBe(false)
  })

  it('persists dismissed state to localStorage', () => {
    const { trackSetLogged, dismissBanner } = useInstallPrompt()
    fireBeforeInstallPrompt()
    trackSetLogged()
    trackSetLogged()
    trackSetLogged()
    dismissBanner()

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(stored.dismissed).toBe(true)
  })

  it('does not show banner when already in standalone mode', () => {
    const originalMatchMedia = window.matchMedia
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(display-mode: standalone)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))

    const { showBanner, trackSetLogged } = useInstallPrompt()
    fireBeforeInstallPrompt()
    trackSetLogged()
    trackSetLogged()
    trackSetLogged()
    expect(showBanner.value).toBe(false)

    window.matchMedia = originalMatchMedia
  })

  it('calls native prompt and hides banner on install', async () => {
    const { showBanner, trackSetLogged, installApp } = useInstallPrompt()
    const promptMock = vi.fn().mockResolvedValue(undefined)
    const event = new Event('beforeinstallprompt', { cancelable: true })
    Object.assign(event, {
      prompt: promptMock,
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    })
    window.dispatchEvent(event)

    trackSetLogged()
    trackSetLogged()
    trackSetLogged()
    expect(showBanner.value).toBe(true)

    await installApp()
    expect(promptMock).toHaveBeenCalledOnce()
    expect(showBanner.value).toBe(false)
  })

  it('restores setsLogged from localStorage', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ dismissed: false, installed: false, setsLogged: 2 }))
    _resetForTesting()

    const { showBanner, trackSetLogged } = useInstallPrompt()
    fireBeforeInstallPrompt()
    trackSetLogged() // 3rd set
    expect(showBanner.value).toBe(true)
  })
})
