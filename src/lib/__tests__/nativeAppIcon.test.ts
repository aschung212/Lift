import { describe, it, expect, vi, beforeEach } from 'vitest'

const setIcon = vi.fn()
const getIcon = vi.fn()

const logError = vi.fn()

async function loadModule(isNative: boolean, pluginRegistered = true) {
  vi.resetModules()
  setIcon.mockReset()
  getIcon.mockReset()
  logError.mockReset()
  vi.doMock('../platform', () => ({ isNative }))
  vi.doMock('@capacitor/core', () => ({
    registerPlugin: () => ({ setIcon, getIcon }),
    Capacitor: { isPluginAvailable: (name: string) => name === 'AppIcon' && pluginRegistered },
  }))
  vi.doMock('../logger', () => ({ logError }))
  return import('../nativeAppIcon')
}

describe('nativeAppIcon on web', () => {
  beforeEach(() => vi.resetModules())

  it('setNativeAppIcon is a no-op and never touches the plugin', async () => {
    const { setNativeAppIcon } = await loadModule(false)
    await expect(setNativeAppIcon('AppIcon-fire')).resolves.toBeUndefined()
    expect(setIcon).not.toHaveBeenCalled()
  })

  it('getNativeAppIcon returns null without touching the plugin', async () => {
    const { getNativeAppIcon } = await loadModule(false)
    await expect(getNativeAppIcon()).resolves.toBeNull()
    expect(getIcon).not.toHaveBeenCalled()
  })
})

describe('nativeAppIcon on native without the plugin registered (#1423)', () => {
  // The Swift half of the bridge ships with the committed iOS project (#531).
  // Until then a native launch must not call into a plugin Capacitor has never
  // heard of — that logged an error on every launch — and Settings must not
  // render a picker whose taps can do nothing.
  beforeEach(() => vi.resetModules())

  it('reports the plugin unavailable', async () => {
    const { isAppIconPluginAvailable } = await loadModule(true, false)
    expect(isAppIconPluginAvailable()).toBe(false)
  })

  it('setNativeAppIcon is a silent no-op — no plugin call, no error report', async () => {
    const { setNativeAppIcon } = await loadModule(true, false)
    await expect(setNativeAppIcon('AppIcon-fire')).resolves.toBeUndefined()
    expect(setIcon).not.toHaveBeenCalled()
    expect(logError).not.toHaveBeenCalled()
  })

  it('getNativeAppIcon returns null without touching the plugin', async () => {
    const { getNativeAppIcon } = await loadModule(true, false)
    await expect(getNativeAppIcon()).resolves.toBeNull()
    expect(getIcon).not.toHaveBeenCalled()
  })

  it('is never available on web, even if a plugin of that name were registered', async () => {
    const { isAppIconPluginAvailable } = await loadModule(false, true)
    expect(isAppIconPluginAvailable()).toBe(false)
  })
})

describe('nativeAppIcon on native', () => {
  beforeEach(() => vi.resetModules())

  it('reports the plugin available once it is registered', async () => {
    const { isAppIconPluginAvailable } = await loadModule(true)
    expect(isAppIconPluginAvailable()).toBe(true)
  })

  it('setNativeAppIcon forwards the name to the plugin', async () => {
    const { setNativeAppIcon } = await loadModule(true)
    setIcon.mockResolvedValue(undefined)
    await setNativeAppIcon('AppIcon-fire')
    expect(setIcon).toHaveBeenCalledWith({ name: 'AppIcon-fire' })
  })

  it('setNativeAppIcon passes null to restore the primary icon', async () => {
    const { setNativeAppIcon } = await loadModule(true)
    setIcon.mockResolvedValue(undefined)
    await setNativeAppIcon(null)
    expect(setIcon).toHaveBeenCalledWith({ name: null })
  })

  it('setNativeAppIcon swallows plugin errors', async () => {
    const { setNativeAppIcon } = await loadModule(true)
    setIcon.mockRejectedValue(new Error('not implemented'))
    await expect(setNativeAppIcon('AppIcon-fire')).resolves.toBeUndefined()
  })

  it('getNativeAppIcon returns the active icon name', async () => {
    const { getNativeAppIcon } = await loadModule(true)
    getIcon.mockResolvedValue({ name: 'AppIcon-water' })
    await expect(getNativeAppIcon()).resolves.toBe('AppIcon-water')
  })

  it('getNativeAppIcon returns null when the plugin throws', async () => {
    const { getNativeAppIcon } = await loadModule(true)
    getIcon.mockRejectedValue(new Error('boom'))
    await expect(getNativeAppIcon()).resolves.toBeNull()
  })
})
