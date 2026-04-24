import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// Must set up Pinia before importing the composable (it calls usePreferencesStore)
beforeEach(() => {
  setActivePinia(createPinia())
})

import { useWakeLock } from '../useWakeLock'

describe('useWakeLock', () => {
  let releaseMock: ReturnType<typeof vi.fn>
  let requestMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    releaseMock = vi.fn().mockResolvedValue(undefined)
    requestMock = vi.fn().mockResolvedValue({
      released: false,
      release: releaseMock,
      type: 'screen' as WakeLockType,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      onrelease: null,
      dispatchEvent: vi.fn(),
    } satisfies WakeLockSentinel)

    Object.defineProperty(navigator, 'wakeLock', {
      value: { request: requestMock },
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns all expected fields', () => {
    const wl = useWakeLock()
    expect(typeof wl.startHolding).toBe('function')
    expect(typeof wl.stopHolding).toBe('function')
    expect(typeof wl.supported).toBe('boolean')
    expect(wl.active).toBeDefined()
  })

  it('reports supported when Wake Lock API is present', () => {
    const { supported } = useWakeLock()
    expect(supported).toBe(true)
  })

  it('acquires wake lock on startHolding', async () => {
    const { startHolding, active } = useWakeLock()
    await startHolding()
    expect(requestMock).toHaveBeenCalledWith('screen')
    expect(active.value).toBe(true)
  })

  it('releases wake lock on stopHolding', async () => {
    const { startHolding, stopHolding, active } = useWakeLock()
    await startHolding()
    await stopHolding()
    expect(releaseMock).toHaveBeenCalled()
    expect(active.value).toBe(false)
  })

  it('stopHolding is safe to call without startHolding', async () => {
    const { stopHolding } = useWakeLock()
    await expect(stopHolding()).resolves.toBeUndefined()
  })

  it('does not acquire when screenWakeLock preference is off', async () => {
    const { usePreferencesStore } = await import('../../stores/preferences')
    const prefs = usePreferencesStore()
    prefs.experience.screenWakeLock = false

    const { startHolding } = useWakeLock()
    await startHolding()
    expect(requestMock).not.toHaveBeenCalled()
  })
})

describe('useWakeLock without API support', () => {
  let savedWakeLock: unknown

  beforeEach(() => {
    savedWakeLock = Object.getOwnPropertyDescriptor(navigator, 'wakeLock')
    // Actually delete the property so 'wakeLock' in navigator returns false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (navigator as any).wakeLock
    setActivePinia(createPinia())
  })

  afterEach(() => {
    // Restore
    if (savedWakeLock) {
      Object.defineProperty(navigator, 'wakeLock', savedWakeLock)
    }
  })

  it('reports not supported', () => {
    const wl = useWakeLock()
    expect(wl.supported).toBe(false)
  })

  it('startHolding is a no-op without errors', async () => {
    const { startHolding, active } = useWakeLock()
    await expect(startHolding()).resolves.toBeUndefined()
    expect(active.value).toBe(false)
  })
})
