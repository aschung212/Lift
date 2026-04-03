import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../platform', () => ({
  isNative: false,
  platform: 'web',
}))

describe('initNativePlugins', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('no-ops on web', async () => {
    const { initNativePlugins } = await import('../native')
    // Should not throw and should not import native plugins
    await expect(initNativePlugins()).resolves.toBeUndefined()
  })

  it('initializes StatusBar and Keyboard on iOS', async () => {
    vi.resetModules()

    const mockSetStyle = vi.fn()
    const mockSetOverlays = vi.fn()
    const mockAddListener = vi.fn()

    vi.doMock('../platform', () => ({
      isNative: true,
      platform: 'ios',
    }))
    vi.doMock('@capacitor/status-bar', () => ({
      StatusBar: {
        setStyle: mockSetStyle,
        setOverlaysWebView: mockSetOverlays,
      },
      Style: { Dark: 'DARK' },
    }))
    vi.doMock('@capacitor/keyboard', () => ({
      Keyboard: {
        addListener: mockAddListener,
      },
    }))

    const { initNativePlugins } = await import('../native')
    await initNativePlugins()

    expect(mockSetStyle).toHaveBeenCalledWith({ style: 'DARK' })
    expect(mockSetOverlays).toHaveBeenCalledWith({ overlay: true })
    expect(mockAddListener).toHaveBeenCalledTimes(2)
    expect(mockAddListener).toHaveBeenCalledWith('keyboardWillShow', expect.any(Function))
    expect(mockAddListener).toHaveBeenCalledWith('keyboardWillHide', expect.any(Function))
  })

  it('sets --keyboard-height CSS variable on keyboard show', async () => {
    vi.resetModules()

    let showCallback: ((info: { keyboardHeight: number }) => void) | null = null

    vi.doMock('../platform', () => ({
      isNative: true,
      platform: 'android',
    }))
    vi.doMock('@capacitor/keyboard', () => ({
      Keyboard: {
        addListener: vi.fn((event: string, cb: (info: { keyboardHeight: number }) => void) => {
          if (event === 'keyboardWillShow') showCallback = cb
        }),
      },
    }))

    const { initNativePlugins } = await import('../native')
    await initNativePlugins()

    // Simulate keyboard showing
    expect(showCallback).not.toBeNull()
    showCallback!({ keyboardHeight: 300 })
    expect(document.documentElement.style.getPropertyValue('--keyboard-height')).toBe('300px')
  })
})
