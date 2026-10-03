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

  it('hands registerSW an onNeedReload, which is what stops the plugin reloading on its own (LIFT-1511)', () => {
    // Without the callback vite-plugin-pwa runs a bare window.location.reload()
    // when a new worker activates. serviceWorkerPluginReload.test.ts runs the
    // installed plugin to prove the callback replaces it; this pins the option.
    useServiceWorker()

    const opts = registerSWMock.mock.calls[0][0]
    expect(typeof opts.onNeedReload).toBe('function')
  })
})

/** navigator.serviceWorker — happy-dom ships none. */
class FakeServiceWorkerContainer extends EventTarget {
  controller: object | null = { scriptURL: '/sw.js' }
}

/** happy-dom's runtime-mutable browser settings. */
interface HappyDOMWindow {
  happyDOM: { settings: { disableCSSFileLoading: boolean; handleDisabledFileLoadingAsSuccess: boolean } }
}

// LIFT-1511. These run the REAL guardedReload with its reload and its
// sessionStorage injected, across several documents of one session: each
// `bootDocument` is a fresh module graph (what a reload gives) over the same
// storage (what a reload keeps).
describe('a new service worker reloads at most once per build per session (LIFT-1511)', () => {
  const sessionStore = new Map<string, string>()
  const storage = {
    getItem: (key: string) => sessionStore.get(key) ?? null,
    setItem: (key: string, value: string) => { sessionStore.set(key, value) },
  }
  const reload = vi.fn()
  const logError = vi.fn()
  let container: FakeServiceWorkerContainer
  // happy-dom would otherwise try to load the two tags bootDocument writes,
  // and log each failure against its localhost:3000 origin.
  const happyDOMSettings = (window as unknown as HappyDOMWindow).happyDOM.settings
  const savedSettings = { ...happyDOMSettings }

  beforeEach(() => {
    setNative(false)
    happyDOMSettings.disableCSSFileLoading = true
    happyDOMSettings.handleDisabledFileLoadingAsSuccess = true
    sessionStore.clear()
    container = new FakeServiceWorkerContainer()
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container })
    vi.doMock('../../lib/logger', () => ({ logError }))
    vi.doMock('../../lib/reloadGuard', async (importOriginal) => {
      const real = await importOriginal<typeof import('../../lib/reloadGuard')>()
      return {
        guardedReload: (reason: string) => real.guardedReload(reason, { reload, storage }),
      }
    })
  })

  afterEach(() => {
    vi.doUnmock('../../lib/logger')
    vi.doUnmock('../../lib/reloadGuard')
    delete (navigator as { serviceWorker?: unknown }).serviceWorker
    document.head.innerHTML = ''
    happyDOMSettings.disableCSSFileLoading = savedSettings.disableCSSFileLoading
    happyDOMSettings.handleDisabledFileLoadingAsSuccess = savedSettings.handleDisabledFileLoadingAsSuccess
  })

  /**
   * Boot one document of the session on `build`, with the two tags a built
   * index.html carries for it (`null` = neither, as in dev and in tests), and
   * return the plugin's reload callback for it.
   */
  async function bootDocument(build: string | null): Promise<() => void> {
    document.head.innerHTML = build === null
      ? ''
      : `<script type="module" crossorigin src="/assets/index-${build}.js"></script>` +
        `<link rel="stylesheet" crossorigin href="/assets/index-${build}.css">`
    vi.resetModules()
    const pwa = await import('virtual:pwa-register')
    const { useServiceWorker: boot } = await import('../useServiceWorker')
    boot()
    const opts = vi.mocked(pwa.registerSW).mock.calls[0][0] as { onNeedReload: () => void }
    return opts.onNeedReload
  }

  it('keys the reload to the entry script and stylesheet this document booted', async () => {
    const onNeedReload = await bootDocument('A1b2C3d4')

    onNeedReload()

    expect(reload).toHaveBeenCalledTimes(1)
    expect([...sessionStore.keys()]).toEqual([
      'auto-reload-guard:sw-controllerchange /assets/index-A1b2C3d4.js /assets/index-A1b2C3d4.css',
    ])
  })

  it('falls back to the bare trigger name when index.html named no build', async () => {
    const onNeedReload = await bootDocument(null)

    onNeedReload()

    expect(reload).toHaveBeenCalledTimes(1)
    expect([...sessionStore.keys()]).toEqual(['auto-reload-guard:sw-controllerchange'])
  })

  it('a session that outlives two deploys reloads for each', async () => {
    // vite-plugin-pwa's unguarded reload used to cover the second deploy. One
    // session-wide reason would suppress it instead, stranding the document
    // on chunk hashes the new worker no longer precaches.
    ;(await bootDocument('build1'))()
    ;(await bootDocument('build2'))()

    expect(reload).toHaveBeenCalledTimes(2)
    expect(logError).not.toHaveBeenCalled()
  })

  it('a worker that re-activates on every boot is stopped at the second reload from the same build', async () => {
    // The reload lands on the new build, and a loop keeps booting that build,
    // so the next attempt from it finds its reason spent.
    ;(await bootDocument('old'))()
    ;(await bootDocument('new'))()
    ;(await bootDocument('new'))()

    expect(reload).toHaveBeenCalledTimes(2)
    expect(logError).toHaveBeenCalledTimes(1)
    expect(String(logError.mock.calls[0][0])).toContain('Automatic reload suppressed')
  })

  it('one update, heard as controllerchange and then activated, reloads once and reports nothing', async () => {
    const onNeedReload = await bootDocument('A1b2C3d4')

    container.dispatchEvent(new Event('controllerchange'))
    onNeedReload()

    expect(reload).toHaveBeenCalledTimes(1)
    expect(logError).not.toHaveBeenCalled()
  })

  it('heard in the other order, the update still reloads once', async () => {
    const onNeedReload = await bootDocument('A1b2C3d4')

    onNeedReload()
    container.dispatchEvent(new Event('controllerchange'))

    expect(reload).toHaveBeenCalledTimes(1)
    expect(logError).not.toHaveBeenCalled()
  })

  it('a document whose reload was suppressed does not report again for the next signal', async () => {
    ;(await bootDocument('A1b2C3d4'))()
    const onNeedReload = await bootDocument('A1b2C3d4')

    container.dispatchEvent(new Event('controllerchange'))
    onNeedReload()

    expect(reload).toHaveBeenCalledTimes(1)
    expect(logError).toHaveBeenCalledTimes(1)
  })

  it('the first claim of an uncontrolled page reloads nothing, and the next new worker does', async () => {
    container.controller = null
    await bootDocument('A1b2C3d4')

    container.controller = { scriptURL: '/sw.js' }
    container.dispatchEvent(new Event('controllerchange'))
    expect(reload).not.toHaveBeenCalled()

    container.dispatchEvent(new Event('controllerchange'))
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
