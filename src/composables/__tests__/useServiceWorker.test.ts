import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock } from 'vitest'
import { shouldDeferReload } from '../useServiceWorker'

// Mutable platform mock — flipped per test via the `setNative` helper below.
let nativeFlag = false
vi.mock('../../lib/platform', () => ({
  get isNative() { return nativeFlag },
}))

function setNative(value: boolean) {
  nativeFlag = value
}

// Mutable syncQueue pending count so tests can simulate un-flushed writes
// blocking a service-worker-triggered reload (LIFT-1047).
let pendingWrites = 0
vi.mock('../../lib/syncQueue', () => ({
  syncQueue: {
    get pending() { return pendingWrites },
  },
}))

// vitest.config.js aliases `virtual:pwa-register` to a stub. The composable holds
// module-scoped singleton state (it registers the SW exactly once), so each test
// resets the module graph and re-grabs the freshly evaluated stub spik so the
// composable and the test share the same `registerSW` spy instance.
let useServiceWorker: typeof import('../useServiceWorker').useServiceWorker
let registerSWMock: Mock

describe('useServiceWorker', () => {
  beforeEach(async () => {
    setNative(false)
    pendingWrites = 0
    document.documentElement.classList.remove('modal-open')
    vi.resetModules()
    const pwa = await import('virtual:pwa-register')
    registerSWMock = vi.mocked(pwa.registerSW) as unknown as Mock
    registerSWMock.mockReset()
    ;({ useServiceWorker } = await import('../useServiceWorker'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.documentElement.classList.remove('modal-open')
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

  describe('shouldDeferReload (LIFT-1047 data-integrity gate)', () => {
    it('does not defer when no modal is open and no writes are pending', () => {
      expect(shouldDeferReload(false, 0)).toBe(false)
    })

    it('defers while a modal is open (unsaved set-logging input)', () => {
      expect(shouldDeferReload(true, 0)).toBe(true)
    })

    it('defers while writes are still pending (in-flight sync)', () => {
      expect(shouldDeferReload(false, 3)).toBe(true)
    })

    it('defers when both a modal is open and writes are pending', () => {
      expect(shouldDeferReload(true, 2)).toBe(true)
    })
  })

  describe('controllerchange reload deferral (web)', () => {
    let controllerChangeHandler: (() => void) | undefined
    let reloadSpy: Mock
    let originalReload: typeof window.location.reload
    let originalSW: PropertyDescriptor | undefined

    beforeEach(() => {
      controllerChangeHandler = undefined
      // Minimal navigator.serviceWorker double: a truthy controller (so the
      // first controllerchange is treated as a real update, not first-visit)
      // and an addEventListener that captures the controllerchange handler.
      originalSW = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker')
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: {
          controller: {},
          addEventListener: (event: string, handler: () => void) => {
            if (event === 'controllerchange') controllerChangeHandler = handler
          },
        },
      })
      originalReload = window.location.reload
      reloadSpy = vi.fn()
      Object.defineProperty(window.location, 'reload', {
        configurable: true,
        value: reloadSpy,
      })
    })

    afterEach(() => {
      if (originalSW) Object.defineProperty(navigator, 'serviceWorker', originalSW)
      else delete (navigator as { serviceWorker?: unknown }).serviceWorker
      Object.defineProperty(window.location, 'reload', {
        configurable: true,
        value: originalReload,
      })
    })

    it('reloads immediately on controllerchange when it is safe', () => {
      useServiceWorker()
      controllerChangeHandler?.()
      expect(reloadSpy).toHaveBeenCalledTimes(1)
    })

    it('does NOT reload on controllerchange while a modal is open', () => {
      document.documentElement.classList.add('modal-open')
      useServiceWorker()
      controllerChangeHandler?.()
      expect(reloadSpy).not.toHaveBeenCalled()
    })

    it('does NOT reload on controllerchange while writes are pending', () => {
      pendingWrites = 2
      useServiceWorker()
      controllerChangeHandler?.()
      expect(reloadSpy).not.toHaveBeenCalled()
    })

    it('reloads once the modal closes after a deferred controllerchange', () => {
      vi.useFakeTimers()
      document.documentElement.classList.add('modal-open')
      useServiceWorker()
      controllerChangeHandler?.()
      // Still open: the poll finds it unsafe and holds.
      vi.advanceTimersByTime(3 * 1000)
      expect(reloadSpy).not.toHaveBeenCalled()
      // User closes the modal; the next poll reloads.
      document.documentElement.classList.remove('modal-open')
      vi.advanceTimersByTime(3 * 1000)
      expect(reloadSpy).toHaveBeenCalledTimes(1)
      // The deferral timer stops once it has reloaded.
      vi.advanceTimersByTime(9 * 1000)
      expect(reloadSpy).toHaveBeenCalledTimes(1)
      vi.useRealTimers()
    })

    it('reloads once pending writes drain after a deferred controllerchange', () => {
      vi.useFakeTimers()
      pendingWrites = 1
      useServiceWorker()
      controllerChangeHandler?.()
      vi.advanceTimersByTime(3 * 1000)
      expect(reloadSpy).not.toHaveBeenCalled()
      pendingWrites = 0
      vi.advanceTimersByTime(3 * 1000)
      expect(reloadSpy).toHaveBeenCalledTimes(1)
      vi.useRealTimers()
    })
  })
})
