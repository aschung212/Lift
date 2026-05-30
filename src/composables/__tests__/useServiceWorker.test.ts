import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// vitest.config.js aliases `virtual:pwa-register` to a stub, so the composable
// and this test share the same `registerSW` spy instance.
import { registerSW } from 'virtual:pwa-register'

const registerSWMock = vi.mocked(registerSW)

// Mutable platform mock — flipped per test via the `setNative` helper below.
let nativeFlag = false
vi.mock('../../lib/platform', () => ({
  get isNative() { return nativeFlag },
}))

function setNative(value: boolean) {
  nativeFlag = value
}

// `isNative` is read through the mocked getter on each access (ESM live binding),
// so no module reset is needed — flipping `nativeFlag` is enough between tests.
import { useServiceWorker } from '../useServiceWorker'

describe('useServiceWorker', () => {
  beforeEach(() => {
    registerSWMock.mockReset()
    setNative(false)
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
