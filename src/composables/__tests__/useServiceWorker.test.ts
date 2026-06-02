import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock } from 'vitest'

// Mutable platform mock — flipped per test via the `setNative` helper below.
let nativeFlag = false
vi.mock('../../lib/platform', () => ({
  get isNative() { return nativeFlag },
}))

function setNative(value: boolean) {
  nativeFlag = value
}

// vitest.config.js aliases `virtual:pwa-register` to a stub. The composable holds
// module-scoped singleton state (it registers the SW exactly once), so each test
// resets the module graph and re-grabs the freshly evaluated stub spik so the
// composable and the test share the same `registerSW` spy instance.
let useServiceWorker: typeof import('../useServiceWorker').useServiceWorker
let registerSWMock: Mock

describe('useServiceWorker', () => {
  beforeEach(async () => {
    setNative(false)
    vi.resetModules()
    const pwa = await import('virtual:pwa-register')
    registerSWMock = vi.mocked(pwa.registerSW) as unknown as Mock
    registerSWMock.mockReset()
    ;({ useServiceWorker } = await import('../useServiceWorker'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does NOT register the service worker on the native Capacitor build (#532)', () => {
    setNative(true)
    const addDocListener = vi.spyOn(document, 'addEventListener')

    const { checkForSWUpdate } = useServiceWorker()

    expect(registerSWMock).not.toHaveBeenCalled()
    // No visibilitychange listener wired on native.
    expect(addDocListener).not.toHaveBeenCalledWith('visibilitychange', expect.anything())
    // checkForSWUpdate is a safe no-op.
    expect(() => checkForSWUpdate()).not.toThrow()
  })

  it('registers the service worker on the web build', () => {
    setNative(false)
    const addDocListener = vi.spyOn(document, 'addEventListener')

    const { checkForSWUpdate } = useServiceWorker()

    expect(registerSWMock).toHaveBeenCalledTimes(1)
    // Update polling is wired through the onRegisteredSW callback.
    const opts = registerSWMock.mock.calls[0][0]
    expect(opts).toHaveProperty('onRegisteredSW')
    expect(opts).toHaveProperty('onOfflineReady')
    // visibilitychange listener is registered to poll for updates on resume.
    expect(addDocListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    expect(typeof checkForSWUpdate).toBe('function')
  })

  it('registers the SW only once even when called from multiple components (web)', () => {
    setNative(false)
    const addDocListener = vi.spyOn(document, 'addEventListener')

    useServiceWorker()
    useServiceWorker()
    useServiceWorker()

    // Singleton guard: registration + listeners are wired exactly once.
    expect(registerSWMock).toHaveBeenCalledTimes(1)
    const visibilityCalls = addDocListener.mock.calls.filter(
      ([event]) => event === 'visibilitychange'
    )
    expect(visibilityCalls).toHaveLength(1)
  })

  it('checkForSWUpdate triggers a registration update once the SW is registered (web)', () => {
    setNative(false)
    const update = vi.fn()

    useServiceWorker()

    // Simulate the PWA plugin invoking onRegisteredSW with a registration.
    const opts = registerSWMock.mock.calls[0][0] as {
      onRegisteredSW: (url: string, reg: { update: () => void }) => void
    }
    vi.useFakeTimers()
    opts.onRegisteredSW('/sw.js', { update })
    // The 10-minute polling interval fires an update.
    vi.advanceTimersByTime(10 * 60 * 1000)
    expect(update).toHaveBeenCalled()
    vi.useRealTimers()
  })
})
