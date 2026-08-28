import { describe, it, expect, vi, beforeEach } from 'vitest'

const setIcon = vi.fn()
const getIcon = vi.fn()

async function loadModule(isNative: boolean) {
  vi.resetModules()
  setIcon.mockReset()
  getIcon.mockReset()
  vi.doMock('../platform', () => ({ isNative }))
  vi.doMock('@capacitor/core', () => ({
    registerPlugin: () => ({ setIcon, getIcon }),
  }))
  vi.doMock('../logger', () => ({ logError: vi.fn() }))
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

describe('nativeAppIcon on native', () => {
  beforeEach(() => vi.resetModules())

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
