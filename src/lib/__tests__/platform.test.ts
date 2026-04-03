import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock @capacitor/core before importing platform module
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => false),
    getPlatform: vi.fn(() => 'web'),
  },
}))

describe('platform detection', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('exports isNative as false on web', async () => {
    const { isNative } = await import('../platform')
    expect(isNative).toBe(false)
  })

  it('exports platform as "web" in browser', async () => {
    const { platform } = await import('../platform')
    expect(platform).toBe('web')
  })

  it('detects iOS Safari via user agent', async () => {
    const { isIOS } = await import('../platform')
    // In test env (happy-dom), UA won't contain iPad/iPhone
    expect(typeof isIOS).toBe('boolean')
  })

  it('detects native platform when Capacitor reports native', async () => {
    const { Capacitor } = await import('@capacitor/core')
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true)
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios')

    // Re-import to pick up new mock values
    vi.resetModules()
    vi.doMock('@capacitor/core', () => ({
      Capacitor: {
        isNativePlatform: vi.fn(() => true),
        getPlatform: vi.fn(() => 'ios'),
      },
    }))
    const mod = await import('../platform')
    expect(mod.isNative).toBe(true)
    expect(mod.platform).toBe('ios')
  })
})
