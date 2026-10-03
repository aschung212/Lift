/**
 * LIFT-1511 — vite-plugin-pwa's own reload goes through the #1155 guard.
 *
 * In autoUpdate mode `registerSW` listens for workbox-window's `activated`
 * event and, when no `onNeedReload` is passed, runs a bare
 * `window.location.reload()` (dist/client/build/register.js). Logbook passed
 * none, so every service-worker update had a second, unguarded reload beside
 * the guarded `controllerchange` one, and a worker that re-activated on every
 * boot reloaded forever no matter what the guard decided.
 *
 * Nothing caught it for two reasons. useServiceWorker.test.ts replaces
 * `virtual:pwa-register` with a vi.fn stub, so the plugin's listeners never
 * ran. And the "no bare location.reload()" invariant scans src/ only, while
 * this reload lives in node_modules and runs only when an option is ABSENT,
 * which no scan of the app's source can see.
 *
 * So this file runs the plugin's installed client module itself: the same
 * file `generateRegisterSW` reads, with the same placeholder substitutions the
 * plugin applies for Logbook's config. Two lines are swapped for test hooks,
 * because neither can run under happy-dom: the `workbox-window` import becomes
 * a fake Workbox the test can fire events on, and the bare reload becomes a
 * spy (happy-dom's location.reload cannot be spied on).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

vi.mock('../../lib/platform', () => ({ isNative: false }))

type WorkboxListener = (event: Record<string, unknown>) => void

/** Stands in for workbox-window's Workbox: records listeners, fires events. */
class FakeWorkbox {
  static instances: FakeWorkbox[] = []
  readonly listeners = new Map<string, WorkboxListener[]>()

  constructor(readonly scriptURL: string, readonly options: unknown) {
    FakeWorkbox.instances.push(this)
  }

  addEventListener(type: string, listener: WorkboxListener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  // Never settles: these tests are about the listeners registerSW attaches
  // before it registers, and a settled registration would start the
  // composable's 10-minute update poll.
  register(): Promise<never> {
    return new Promise(() => {})
  }

  messageSkipWaiting(): void {}

  emit(type: string, event: Record<string, unknown>): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

/** navigator.serviceWorker — happy-dom ships none. */
class FakeServiceWorkerContainer extends EventTarget {
  controller: object | null = { scriptURL: '/sw.js' }
}

interface TestHooks {
  __liftTestWorkboxWindow?: () => Promise<{ Workbox: typeof FakeWorkbox }>
  __liftTestBareReload?: () => void
}
const hooks = globalThis as typeof globalThis & TestHooks

type RegisterSW = (options?: Record<string, unknown>) => unknown

/**
 * The installed plugin's client `registerSW`, as Logbook's build would emit
 * it. The values mirror vite-plugin-pwa's `generateRegisterSW` for this repo:
 * buildBase '/' + filename 'sw.js', scope '/', the registerType vite.config.js
 * sets, selfDestroying off, and a classic worker (devOptions are not enabled).
 */
async function loadInstalledRegisterSW(): Promise<RegisterSW> {
  const viteConfig = readFileSync(join(ROOT, 'vite.config.js'), 'utf-8')
  const registerType = viteConfig.match(/registerType:\s*'(\w+)'/)?.[1]
  // The rest of this file models autoUpdate. A different mode takes a
  // different branch of the plugin (`controlling` + onNeedRefresh), so it
  // needs these tests rewritten rather than quietly passing.
  expect(registerType, 'vite.config.js registerType').toBe('autoUpdate')

  const pluginDist = dirname(createRequire(import.meta.url).resolve('vite-plugin-pwa'))
  let source = readFileSync(join(pluginDist, 'client', 'build', 'register.js'), 'utf-8')
  source = source
    .replace(/__SW__/g, '/sw.js')
    .replace('__SCOPE__', '/')
    .replace('__SW_AUTO_UPDATE__', `${registerType === 'autoUpdate'}`)
    .replace('__SW_SELF_DESTROYING__', 'false')
    .replace('__TYPE__', 'classic')
  // A placeholder the plugin added after this was written would otherwise
  // stay a string literal and silently pick a branch.
  expect(source.match(/__[A-Z][A-Z_]*__/g), 'unsubstituted plugin placeholders').toBeNull()

  const swap = (from: string, to: string) => {
    // Pin that each hook still has something to replace, or a reshaped
    // library would leave the real import or reload in place.
    expect(source.includes(from), `register.js still contains ${from}`).toBe(true)
    source = source.split(from).join(to)
  }
  swap('import("workbox-window")', 'globalThis.__liftTestWorkboxWindow()')
  swap('window.location.reload()', 'globalThis.__liftTestBareReload()')

  const mod = (await import(
    /* @vite-ignore */ `data:text/javascript,${encodeURIComponent(source)}`
  )) as { registerSW: RegisterSW }
  return mod.registerSW
}

/** The Workbox registerSW built, once its async setup has attached listeners. */
async function workboxWithListeners(): Promise<FakeWorkbox> {
  await vi.waitFor(() => {
    expect(FakeWorkbox.instances.at(-1)?.listeners.has('activated')).toBe(true)
  })
  return FakeWorkbox.instances.at(-1)!
}

describe('vite-plugin-pwa reload is routed through the reload guard (LIFT-1511)', () => {
  let registerSW: RegisterSW
  let bareReload: Mock
  let guardedReload: Mock
  let container: FakeServiceWorkerContainer

  beforeEach(async () => {
    vi.resetModules()
    FakeWorkbox.instances = []
    bareReload = vi.fn()
    hooks.__liftTestWorkboxWindow = () => Promise.resolve({ Workbox: FakeWorkbox })
    hooks.__liftTestBareReload = bareReload
    container = new FakeServiceWorkerContainer()
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container })

    registerSW = await loadInstalledRegisterSW()
    vi.doMock('virtual:pwa-register', () => ({ registerSW }))
    vi.doMock('../../lib/reloadGuard', () => ({ guardedReload: vi.fn(() => true) }))
    guardedReload = vi.mocked((await import('../../lib/reloadGuard')).guardedReload) as unknown as Mock
  })

  afterEach(() => {
    vi.doUnmock('virtual:pwa-register')
    vi.doUnmock('../../lib/reloadGuard')
    delete (navigator as { serviceWorker?: unknown }).serviceWorker
    delete hooks.__liftTestWorkboxWindow
    delete hooks.__liftTestBareReload
  })

  it('the harness sees the plugin reload on its own when no onNeedReload is passed', async () => {
    // Non-vacuity: this is the defect, reproduced through the real module.
    // If it stopped reloading here, the assertions below would pass for the
    // wrong reason.
    registerSW({})
    const wb = await workboxWithListeners()

    wb.emit('activated', { isUpdate: true })
    wb.emit('activated', { isExternal: true })

    expect(bareReload).toHaveBeenCalledTimes(2)
  })

  it('an update found at registration reloads through the guard, never directly', async () => {
    const { useServiceWorker } = await import('../useServiceWorker')
    useServiceWorker()
    const wb = await workboxWithListeners()

    wb.emit('activated', { isUpdate: true })

    expect(bareReload).not.toHaveBeenCalled()
    expect(guardedReload).toHaveBeenCalledTimes(1)
    expect(guardedReload.mock.calls[0][0]).toMatch(/^sw-controllerchange/)
  })

  it('an update found later (a poll, a tab switch) reloads through the guard too', async () => {
    const { useServiceWorker } = await import('../useServiceWorker')
    useServiceWorker()
    const wb = await workboxWithListeners()

    wb.emit('activated', { isExternal: true })

    expect(bareReload).not.toHaveBeenCalled()
    expect(guardedReload).toHaveBeenCalledTimes(1)
  })

  it('the first install reloads nothing', async () => {
    container.controller = null
    const { useServiceWorker } = await import('../useServiceWorker')
    useServiceWorker()
    const wb = await workboxWithListeners()

    container.dispatchEvent(new Event('controllerchange'))
    wb.emit('activated', {})

    expect(bareReload).not.toHaveBeenCalled()
    expect(guardedReload).not.toHaveBeenCalled()
  })

  it('a normal update fires both signals and asks the guard once', async () => {
    // clients.claim() runs inside the worker's activate event, so the page
    // hears controllerchange first and `activated` once activation settles,
    // both before the reload has replaced this document. Asking twice would
    // find the reason spent and report a suppressed loop on every update.
    const { useServiceWorker } = await import('../useServiceWorker')
    useServiceWorker()
    const wb = await workboxWithListeners()

    container.dispatchEvent(new Event('controllerchange'))
    wb.emit('activated', { isUpdate: true })

    expect(guardedReload).toHaveBeenCalledTimes(1)
    expect(bareReload).not.toHaveBeenCalled()
  })
})
