/// <reference types="node" />
/**
 * Navigation preload stays off, and the service worker switches it off (LIFT-1512).
 *
 * #443 turned `navigationPreload` on "for faster navigations", and the test that
 * shipped with it asserted the line `navigationPreload: true` verbatim. A preload
 * is only faster if the worker answers WITH it, and Logbook's never did. Every
 * navigation the app makes is taken by the navigateFallback route, which
 * generateSW registers ahead of every runtimeCaching route and which answers
 * from the precache. Workbox reads `event.preloadResponse` in exactly one place,
 * `StrategyHandler.fetch`, and only for a navigate-mode request, while
 * `createHandlerBoundToURL` rebinds the request to a plain
 * `new Request('index.html')` before its strategy runs. So every launch also
 * fetched the page over the network, and the worker threw the response away.
 *
 * A guard that allowed the preload whenever some runtimeCaching rule matches
 * navigations would not be enough. The fallback route is registered first, so
 * such a rule only ever sees the navigations the fallback declines, and the
 * app makes none of those.
 *
 * vite.config.js is EVALUATED here, not text-scanned: VitePWA is replaced by a
 * stub that records the options the config hands it, the way
 * capacitorConfigRegression.test.ts evaluates capacitor.config.ts. The
 * premises are read off those options and off workbox-build's own template,
 * so a change to either fails here, where the reason for the rule is written
 * down, instead of the rule being restated as a bare `false`.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import type { VitePWAOptions } from 'vite-plugin-pwa'

const ROOT = resolve(__dirname, '../../..')
const DISABLE_SCRIPT = 'sw-disable-navigation-preload.js'

type PwaOptions = Partial<VitePWAOptions>
type WorkboxOptions = NonNullable<VitePWAOptions['workbox']>

const recorded = vi.hoisted(() => ({ options: undefined as PwaOptions | undefined }))

vi.mock('vite-plugin-pwa', () => ({
  // Records the options vite.config.js passes instead of building a plugin from them.
  VitePWA: (options: PwaOptions) => {
    recorded.options = options
    return []
  },
}))

/** The template workbox-build renders into dist/sw.js; vite-plugin-pwa uses this copy. */
const swTemplate = readFileSync(
  resolve(ROOT, 'node_modules/workbox-build/build/templates/sw-template.js'),
  'utf-8',
)

let pwa: PwaOptions
let workbox: WorkboxOptions

beforeAll(async () => {
  // Evaluate it as a plain build. With a token set, the config would also
  // construct the Sentry upload plugin, which has nothing to do with this file.
  vi.stubEnv('SENTRY_AUTH_TOKEN', '')
  try {
    // @ts-expect-error vite.config.js is untyped JavaScript
    await import('../../../vite.config.js')
  } finally {
    vi.unstubAllEnvs()
  }
  if (!recorded.options) throw new Error('vite.config.js never called VitePWA. Has the PWA plugin moved?')
  pwa = recorded.options
  if (!pwa.workbox) throw new Error('vite.config.js passes VitePWA no workbox options')
  workbox = pwa.workbox
})

/** Every navigation the installed app starts with: its start URL and each shortcut. */
function appNavigations(): string[] {
  const manifest = pwa.manifest
  if (!manifest || !manifest.start_url) throw new Error('vite.config.js declares no manifest start_url')
  return [manifest.start_url, ...(manifest.shortcuts ?? []).map(shortcut => shortcut.url)]
}

/**
 * Whether generateSW's navigateFallback route takes a navigation to `url`.
 * This is NavigationRoute._match: the URL's pathname + search is tested
 * against the denylist first, then the allowlist (default `[/./]`, i.e. every
 * navigation). Only an explicit `navigateFallback` is modelled. If the key
 * ever goes, the first test below fails: work out what answers navigations
 * then (vite-plugin-pwa defaults the key to 'index.html') before trusting the
 * rest of this file.
 */
function navigateFallbackTakes(url: string): boolean {
  if (!workbox.navigateFallback) return false
  const { pathname, search } = new URL(url, location.href)
  const target = pathname + search
  const allowlist = workbox.navigateFallbackAllowlist ?? [/./]
  const denylist = workbox.navigateFallbackDenylist ?? []
  return !denylist.some(re => re.test(target)) && allowlist.some(re => re.test(target))
}

describe('navigation preload (LIFT-1512)', () => {
  describe('nothing in the generated worker can use a preload', () => {
    it('every navigation the installed app makes is taken by the navigateFallback route', () => {
      const navigations = appNavigations()
      // start_url plus at least one shortcut; an empty list would pass vacuously.
      expect(navigations.length).toBeGreaterThan(1)
      for (const url of navigations) expect(navigateFallbackTakes(url), url).toBe(true)
    })

    it('generateSW registers that route ahead of every runtimeCaching route', () => {
      // workbox-routing answers a request from the FIRST matching route, so no
      // runtime rule, network-first or not, ever sees what the fallback takes.
      const fallbackRoute = swTemplate.indexOf("use('workbox-routing', 'NavigationRoute')")
      const runtimeRoutes = swTemplate.indexOf('runtimeCaching.forEach')
      expect(fallbackRoute).toBeGreaterThan(-1)
      expect(runtimeRoutes).toBeGreaterThan(fallbackRoute)
    })

    it('so navigation preload is off', () => {
      // Turning it on first needs a navigation route that reads the preloaded
      // response (network-first navigations), which costs the instant offline
      // launch the precached app shell exists for, and fails the tests above.
      expect(workbox.navigationPreload ?? false).toBe(false)
    })
  })

  describe('registrations an older build enabled it on', () => {
    it('generateSW can emit navigationPreload.enable() but has no way to emit disable()', () => {
      // The flag lives on the registration and outlives the worker that set it,
      // so `navigationPreload: false` only stops a new worker turning it ON.
      expect(swTemplate).toContain("use('workbox-navigation-preload', 'enable')")
      expect(swTemplate).not.toContain("use('workbox-navigation-preload', 'disable')")
    })

    it('so the generated worker imports the script that turns it off', () => {
      expect(workbox.importScripts).toContain(DISABLE_SCRIPT)
      // public/ is copied to the build root, where importScripts resolves it next to sw.js.
      expect(existsSync(resolve(ROOT, 'public', DISABLE_SCRIPT))).toBe(true)
    })
  })

  describe(DISABLE_SCRIPT, () => {
    const originalRegistration = Object.getOwnPropertyDescriptor(self, 'registration')

    beforeAll(async () => {
      // The script registers its listener on `self` at import time, as
      // importScripts runs it inside the generated worker.
      // @ts-expect-error classic service-worker script, shipped from public/ untyped
      await import('../../../public/sw-disable-navigation-preload.js')
    })

    afterEach(() => {
      if (originalRegistration) Object.defineProperty(self, 'registration', originalRegistration)
      else Reflect.deleteProperty(self, 'registration')
    })

    function setRegistration(registration: object): void {
      Object.defineProperty(self, 'registration', { value: registration, configurable: true, writable: true })
    }

    /** A NavigationPreloadManager over a registration's flag, which outlives every worker. */
    function registrationWithPreload(enabled: boolean) {
      let flag = enabled
      const navigationPreload = {
        enable: vi.fn(async () => { flag = true }),
        disable: vi.fn(async () => { flag = false }),
        getState: async () => ({ enabled: flag, headerValue: 'true' }),
      }
      setRegistration({ navigationPreload })
      return navigationPreload
    }

    /** Dispatch `activate` and return the promises handed to waitUntil. */
    function activate(): Promise<unknown>[] {
      const handed: Promise<unknown>[] = []
      const event = new Event('activate') as Event & { waitUntil?: (promise: Promise<unknown>) => void }
      event.waitUntil = promise => { handed.push(promise) }
      self.dispatchEvent(event)
      return handed
    }

    it('turns off a preload an older worker left enabled on the registration', async () => {
      const preload = registrationWithPreload(true)

      await Promise.all(activate())

      expect((await preload.getState()).enabled).toBe(false)
      expect(preload.enable).not.toHaveBeenCalled()
    })

    it('hands the call to waitUntil rather than firing and forgetting it', () => {
      const preload = registrationWithPreload(true)

      const handed = activate()

      expect(preload.disable).toHaveBeenCalledOnce()
      expect(handed).toHaveLength(1)
      // Identity, not toEqual: any two promises are structurally equal.
      expect(handed[0]).toBe(preload.disable.mock.results[0].value)
    })

    it('does nothing in a browser without navigation preload', () => {
      // Safari before 15.4: the registration has no navigationPreload at all.
      setRegistration({})

      expect(activate()).toEqual([])
    })
  })
})
