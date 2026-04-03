import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock @capacitor/haptics — simulates the module not being installed
vi.mock('@capacitor/haptics', () => {
  throw new Error('Module not found')
})

import { useHaptics } from '../useHaptics'

describe('useHaptics', () => {
  let vibrateSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vibrateSpy = vi.fn()
    Object.defineProperty(navigator, 'vibrate', {
      value: vibrateSpy,
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns all haptic methods', () => {
    const haptics = useHaptics()
    expect(typeof haptics.impactLight).toBe('function')
    expect(typeof haptics.impactMedium).toBe('function')
    expect(typeof haptics.impactHeavy).toBe('function')
    expect(typeof haptics.notifySuccess).toBe('function')
    expect(typeof haptics.notifyWarning).toBe('function')
    expect(typeof haptics.notifyError).toBe('function')
  })

  it('impactLight calls navigator.vibrate with short duration', async () => {
    const { impactLight } = useHaptics()
    await impactLight()
    expect(vibrateSpy).toHaveBeenCalledWith(10)
  })

  it('impactMedium calls navigator.vibrate with medium duration', async () => {
    const { impactMedium } = useHaptics()
    await impactMedium()
    expect(vibrateSpy).toHaveBeenCalledWith(25)
  })

  it('impactHeavy calls navigator.vibrate with long duration', async () => {
    const { impactHeavy } = useHaptics()
    await impactHeavy()
    expect(vibrateSpy).toHaveBeenCalledWith(40)
  })

  it('notifySuccess calls navigator.vibrate with success pattern', async () => {
    const { notifySuccess } = useHaptics()
    await notifySuccess()
    expect(vibrateSpy).toHaveBeenCalledWith([15, 50, 15])
  })

  it('notifyWarning calls navigator.vibrate with warning pattern', async () => {
    const { notifyWarning } = useHaptics()
    await notifyWarning()
    expect(vibrateSpy).toHaveBeenCalledWith([30, 50, 30])
  })

  it('notifyError calls navigator.vibrate with error pattern', async () => {
    const { notifyError } = useHaptics()
    await notifyError()
    expect(vibrateSpy).toHaveBeenCalledWith([50, 30, 50, 30, 50])
  })
})

describe('useHaptics without Vibration API', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'vibrate', {
      value: undefined,
      writable: true,
      configurable: true,
    })
  })

  it('does not throw when navigator.vibrate is unavailable', async () => {
    const { impactLight, notifySuccess } = useHaptics()
    await expect(impactLight()).resolves.toBeUndefined()
    await expect(notifySuccess()).resolves.toBeUndefined()
  })
})
