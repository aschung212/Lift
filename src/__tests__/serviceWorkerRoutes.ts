/**
 * The service worker's runtime routing, evaluated from `vite.config.js` and
 * applied with Workbox's own matching rules (LIFT-1510).
 *
 * The routes used to be pinned by slicing the config's source text around a
 * cache name, which can say that a rule EXISTS but not which rule a real
 * request lands on — first-match order, a regex that also catches a
 * neighbouring table, a catch-all underneath. That is exactly how
 * `user_preferences` came to be cached: no rule named it, so it fell into the
 * NetworkFirst catch-all, and nothing looked at where a request for it went.
 *
 * So the config is EVALUATED rather than read (the `capacitorConfigRegression`
 * precedent): vite-plugin-pwa keeps its options in a closure, so its factory is
 * swapped for one that records them, and everything else in the config runs
 * for real. `routeFor` then answers "which rule serves this URL" the way
 * workbox-routing does, and `emulateServiceWorker` wraps a fake network in
 * those routes so a store can be driven through them end to end.
 */
import { vi } from 'vitest'

/** One `workbox.runtimeCaching` entry, as `vite.config.js` passes it to VitePWA. */
export interface RuntimeCachingRule {
  urlPattern: unknown
  handler: unknown
  method?: string
  options?: {
    cacheName?: string
    networkTimeoutSeconds?: number
    expiration?: { maxEntries?: number; maxAgeSeconds?: number }
    cacheableResponse?: { statuses?: number[] }
  }
}

/** The slice of the `workbox` (generateSW) options these tests read. */
export interface WorkboxOptions {
  runtimeCaching?: RuntimeCachingRule[]
  importScripts?: string[]
}

/**
 * Evaluate `vite.config.js` and return the `workbox` options it hands to
 * vite-plugin-pwa. Throws when the config never calls the plugin with any, so a
 * refactor that moves the options somewhere this can't see fails loudly instead
 * of leaving every assertion built on it to pass over an empty rule list.
 */
export async function loadWorkboxOptions(): Promise<WorkboxOptions> {
  let captured: { workbox?: WorkboxOptions } | undefined
  vi.doMock('vite-plugin-pwa', () => ({
    VitePWA: (options: { workbox?: WorkboxOptions }) => {
      captured = options
      return []
    },
  }))
  // Only ever called when SENTRY_AUTH_TOKEN is set; stubbed so evaluating the
  // config never loads the source-map uploader.
  vi.doMock('@sentry/vite-plugin', () => ({ sentryVitePlugin: () => null }))
  try {
    await import('../../vite.config.js')
  } finally {
    vi.doUnmock('vite-plugin-pwa')
    vi.doUnmock('@sentry/vite-plugin')
  }
  if (!captured?.workbox) {
    throw new Error('vite.config.js did not call VitePWA with a `workbox` option')
  }
  return captured.workbox
}

/**
 * The rule the service worker hands this request to, or `undefined` when no
 * route claims it and it goes to the network untouched.
 *
 * Mirrors workbox-routing: routes are tried in registration order and the
 * FIRST match wins; a route only sees requests of its own method (generateSW
 * defaults it to GET); and a RegExp route claims a CROSS-origin URL only when
 * its match starts at index 0. Supabase is always cross-origin to the app, so
 * that last rule applies to every URL routed here.
 */
export function routeFor(
  rules: RuntimeCachingRule[],
  url: string,
  method = 'GET',
): RuntimeCachingRule | undefined {
  const href = new URL(url).href
  for (const rule of rules) {
    if ((rule.method ?? 'GET') !== method) continue
    if (!(rule.urlPattern instanceof RegExp)) {
      // A string pattern is an exact-URL match and a function one runs code
      // this helper can't reason about — model it before relying on it.
      throw new Error(`routeFor only models RegExp url patterns; got ${typeof rule.urlPattern}`)
    }
    const match = rule.urlPattern.exec(href)
    if (match && match.index === 0) return rule
  }
  return undefined
}

/**
 * Can this route answer with a response that did not just come from the
 * network? Every Workbox strategy except NetworkOnly can — NetworkFirst on a
 * failure or timeout, StaleWhileRevalidate always, CacheFirst/CacheOnly by
 * design. A custom handler function is assumed to, since nothing here can prove
 * it doesn't.
 */
export function servesFromCache(rule: RuntimeCachingRule | undefined): boolean {
  return rule !== undefined && rule.handler !== 'NetworkOnly'
}

export interface EmulatedServiceWorker {
  /** Drop-in `fetch` for a Supabase client, routed through the config's rules. */
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  /** Every request that went on to the network, as `METHOD url`, in order. */
  networkRequests: string[]
  /** Flip to false to make the network fail the way a dead radio does. */
  online: boolean
}

/**
 * Put a fake network behind the service worker's routes, with a Cache Storage
 * that persists across "launches" for as long as this object lives.
 *
 * Each strategy is reduced to the one behaviour these tests depend on — what
 * the page receives, and what gets stored — rather than re-implemented:
 * NetworkOnly never touches the cache; NetworkFirst stores what the network
 * returns and falls back to that copy when the network fails; the cache-first
 * family answers from the copy when there is one. Offline is a `TypeError`,
 * which is what a page's `fetch` rejects with when the network (or the service
 * worker in front of it) cannot produce a response.
 */
export function emulateServiceWorker(
  rules: RuntimeCachingRule[],
  network: (request: Request) => Promise<Response>,
): EmulatedServiceWorker {
  const cache = new Map<string, Response>()

  const sw: EmulatedServiceWorker = {
    online: true,
    networkRequests: [],
    async fetch(input, init) {
      const request = new Request(input, init)

      const fromNetwork = async (): Promise<Response> => {
        sw.networkRequests.push(`${request.method} ${request.url}`)
        if (!sw.online) throw new TypeError('Failed to fetch')
        return network(request)
      }
      const fromNetworkAndStore = async (rule: RuntimeCachingRule): Promise<Response> => {
        const response = await fromNetwork()
        const statuses = rule.options?.cacheableResponse?.statuses ?? [200]
        if (statuses.includes(response.status)) cache.set(request.url, response.clone())
        return response
      }

      const rule = routeFor(rules, request.url, request.method)
      if (!rule || rule.handler === 'NetworkOnly') return fromNetwork()

      const cached = cache.get(request.url)
      switch (rule.handler) {
        case 'NetworkFirst':
          try {
            return await fromNetworkAndStore(rule)
          } catch (err) {
            if (cached) return cached.clone()
            throw err
          }
        case 'StaleWhileRevalidate': {
          const revalidate = fromNetworkAndStore(rule)
          if (!cached) return revalidate
          revalidate.catch(() => {})
          return cached.clone()
        }
        case 'CacheFirst':
          return cached ? cached.clone() : fromNetworkAndStore(rule)
        case 'CacheOnly':
          if (cached) return cached.clone()
          throw new TypeError('Failed to fetch')
        default:
          throw new Error(`emulateServiceWorker does not model handler ${String(rule.handler)}`)
      }
    },
  }
  return sw
}
