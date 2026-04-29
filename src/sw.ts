/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching'
import { clientsClaim } from 'workbox-core'
import { registerRoute, NavigationRoute, setCatchHandler } from 'workbox-routing'
import { NetworkFirst, NetworkOnly } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'

declare let self: ServiceWorkerGlobalScope

// Take control immediately on install/activate
self.skipWaiting()
clientsClaim()

// Clean up old precache versions on activate
cleanupOutdatedCaches()

// Precache all build assets (VitePWA injects the manifest here)
precacheAndRoute(self.__WB_MANIFEST)

// SPA navigation: serve precached index.html for all navigation requests
const navigationHandler = createHandlerBoundToURL('/index.html')
registerRoute(new NavigationRoute(navigationHandler))

// Runtime cache: Supabase REST API — NetworkFirst with 24h cache
registerRoute(
  /^https:\/\/.*\.supabase\.co\/rest\/v1\/.*/i,
  new NetworkFirst({
    cacheName: 'supabase-api',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 60 * 60 * 24, // 24 hours
      }),
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
    ],
    networkTimeoutSeconds: 3,
  })
)

// Runtime cache: Supabase Auth — NetworkOnly (never cache auth responses)
registerRoute(
  /^https:\/\/.*\.supabase\.co\/auth\/v1\/.*/i,
  new NetworkOnly({
    cacheName: 'supabase-auth',
  })
)

// Offline fallback: serve offline.html when a navigation request fails
// and the precached index.html is also unavailable (e.g. corrupted cache,
// first visit without connectivity after SW install).
setCatchHandler(async ({ request }) => {
  if (request.destination === 'document') {
    const cache = await caches.open('workbox-precache-v2-' + self.registration.scope)
    const fallback = await cache.match('/offline.html')
    if (fallback) return fallback

    // Try alternate key format (workbox adds revision hashes to precache keys)
    for (const key of await cache.keys()) {
      if (key.url.endsWith('/offline.html')) {
        const response = await cache.match(key)
        if (response) return response
      }
    }
  }
  return Response.error()
})
