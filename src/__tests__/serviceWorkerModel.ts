/**
 * A model of what the generated service worker does with a request, driven by
 * the route table the build ships (LIFT-1524).
 *
 * Store tests hand the store a Supabase double directly, so nothing in the
 * suite ever stood where the service worker stands in production: between a
 * store's read and the network. A route that answered a read from Cache
 * Storage was invisible to every test, which is how five of them shipped, each
 * handing the merge a past state of the server as if it were the present one.
 * `resolveWorkboxRoute` answers "which rule handles this request", and
 * `createServiceWorkerModel` answers "what does the page get back", so a test
 * can put the SAME `RUNTIME_CACHING` array that `vite.config.js` hands to
 * `generateSW` between the real supabase-js client and a server.
 *
 * Modelled on workbox-routing / workbox-strategies 7:
 *  - Routing: rules are tried in array order (generateSW registers them in that
 *    order) and the first match wins. A rule only sees its own `method`
 *    (default GET), so a write never reaches a caching strategy. A RegExp runs
 *    against the full URL and, for a cross-origin request (every Supabase
 *    request is one), only counts when it matches at index 0.
 *  - NetworkOnly: the network's answer, or a network error.
 *  - NetworkFirst: the network's answer, stored when its status is in
 *    `cacheableResponse.statuses` (default: 200 only). The cached answer
 *    instead when the request fails, or when `networkTimeoutSeconds` elapses
 *    first and an answer is cached; with nothing cached it keeps waiting.
 *  - StaleWhileRevalidate: the cached answer when there is one, with the
 *    network refreshing the cache behind it; otherwise the network's.
 * When a strategy has nothing to give, the page sees what a browser shows it:
 * a rejected request, `TypeError: Failed to fetch`.
 *
 * Not modelled: `expiration` (a test that needs an entry gone calls `clear`),
 * and `Vary`. A `urlPattern` that is not a RegExp and a handler not listed
 * above both THROW, so a rule the model cannot read fails the test instead of
 * silently never matching.
 */

/** The fields of a Workbox `runtimeCaching` entry this model reads. */
export interface RouteRule {
  urlPattern: unknown
  handler: unknown
  method?: string
  options?: {
    cacheName?: string
    networkTimeoutSeconds?: number
    cacheableResponse?: { statuses?: number[] }
  }
}

/**
 * The rule the service worker hands this request to, or `undefined` when none
 * matches (the browser then sends it itself, untouched).
 */
export function resolveWorkboxRoute<R extends RouteRule>(
  rules: readonly R[],
  url: string,
  method = 'GET',
): R | undefined {
  const target = new URL(url)
  const crossOrigin = target.origin !== globalThis.location?.origin
  for (const rule of rules) {
    if ((rule.method ?? 'GET').toUpperCase() !== method.toUpperCase()) continue
    if (!(rule.urlPattern instanceof RegExp)) {
      throw new Error(
        `serviceWorkerModel: cannot evaluate urlPattern ${String(rule.urlPattern)}; only RegExp routes are modelled`,
      )
    }
    const match = rule.urlPattern.exec(target.href)
    if (match && (!crossOrigin || match.index === 0)) return rule
  }
  return undefined
}

/** Whether a rule's handler can ever answer from Cache Storage. */
export function answersFromCache(rule: RouteRule): boolean {
  return rule.handler !== 'NetworkOnly'
}

interface StoredResponse {
  status: number
  statusText: string
  headers: [string, string][]
  body: string
}

async function snapshot(response: Response): Promise<StoredResponse> {
  const headers: [string, string][] = []
  response.headers.forEach((value, key) => { headers.push([key, value]) })
  return { status: response.status, statusText: response.statusText, headers, body: await response.text() }
}

function revive(stored: StoredResponse): Response {
  return new Response(stored.body, { status: stored.status, statusText: stored.statusText, headers: stored.headers })
}

function networkError(): TypeError {
  return new TypeError('Failed to fetch')
}

/** What the network layer looks like to the model: a URL and its request options in, a response out. */
export type Transport = (url: string, init: RequestInit) => Promise<Response>

export interface ServiceWorkerModel {
  /**
   * What a request from the page resolves to with the service worker in the
   * way. Hand it to a client as its `fetch` option.
   */
  respond: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  /** URLs holding an entry in any runtime cache. */
  cachedUrls: () => string[]
  /** Empty every runtime cache (a fresh install). */
  clear: () => void
}

export function createServiceWorkerModel(options: {
  /** Read on every request, so a test can swap the table (e.g. a pre-fix control). */
  rules: () => readonly RouteRule[]
  /** What the service worker's own requests, and unrouted page requests, reach. */
  network: Transport
}): ServiceWorkerModel {
  const caches = new Map<string, Map<string, StoredResponse>>()
  const cacheFor = (name: string) => {
    if (!caches.has(name)) caches.set(name, new Map())
    return caches.get(name)!
  }

  async function handle(rule: RouteRule, url: string, init: RequestInit): Promise<Response> {
    const cache = cacheFor(rule.options?.cacheName ?? 'workbox-runtime')
    const statuses = rule.options?.cacheableResponse?.statuses ?? [200]
    const cached = () => {
      const hit = cache.get(url)
      return hit ? revive(hit) : undefined
    }
    const requestAndStore = async () => {
      const response = await options.network(url, init)
      // A status-0 (opaque) response cannot be rebuilt with `new Response`, and
      // no Supabase read is opaque, so it is simply not stored here.
      if (response.status !== 0 && statuses.includes(response.status)) {
        cache.set(url, await snapshot(response.clone()))
      }
      return response
    }

    switch (rule.handler) {
      case 'NetworkOnly':
        return options.network(url, init)

      case 'NetworkFirst': {
        let timer: ReturnType<typeof setTimeout> | undefined
        const fromNetwork = requestAndStore().then(
          (response) => response,
          () => cached(),
        ).finally(() => clearTimeout(timer))
        const seconds = rule.options?.networkTimeoutSeconds
        const racers: Promise<Response | undefined>[] = [fromNetwork]
        if (seconds) {
          racers.push(new Promise<Response | undefined>((resolve) => {
            timer = setTimeout(() => resolve(cached()), seconds * 1000)
          }))
        }
        const response = (await Promise.race(racers)) ?? (await fromNetwork)
        if (!response) throw networkError()
        return response
      }

      case 'StaleWhileRevalidate': {
        const refresh = requestAndStore()
        refresh.catch(() => { /* a failed refresh leaves the cached answer in place */ })
        const hit = cached()
        if (hit) return hit
        const response = await refresh.catch(() => undefined)
        if (!response) throw networkError()
        return response
      }

      default:
        throw new Error(`serviceWorkerModel: handler ${String(rule.handler)} is not modelled`)
    }
  }

  return {
    async respond(input, init = {}) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const rule = resolveWorkboxRoute(options.rules(), url, init.method ?? 'GET')
      return rule ? handle(rule, url, init) : options.network(url, init)
    },
    cachedUrls: () => [...caches.values()].flatMap((cache) => [...cache.keys()]),
    clear: () => caches.clear(),
  }
}
