/**
 * Shared Workbox configuration for the PWA service worker.
 *
 * Extracted from `vite.config.js` so it is a single source of truth that both
 * the build (VitePWA) and the test suite consume. Previously the SW config
 * lived inline in `vite.config.js` and the only "tests" for it string-sliced
 * the config file's source text (`workboxCacheRegression.test.ts`) — they
 * asserted the *shape of the source*, never that the config actually produces a
 * working service worker. Exporting the real object lets tests assert against
 * the config directly and feed it through `workbox-build` to verify the
 * *generated* SW output (see `swBuildOutput.test.ts`).
 *
 * Keep this a plain, side-effect-free data module: `vite.config.js` imports it
 * at config-eval time and the test imports it in Node, so it must not touch the
 * DOM, Vite internals, or any build-only globals.
 */

/** Workbox `runtimeCaching` rule (subset of the fields this app uses). */
export interface RuntimeCachingRule {
  urlPattern: RegExp
  handler:
    | 'StaleWhileRevalidate'
    | 'NetworkFirst'
    | 'NetworkOnly'
    | 'CacheFirst'
    | 'CacheOnly'
  options?: {
    cacheName?: string
    networkTimeoutSeconds?: number
    expiration?: { maxEntries?: number; maxAgeSeconds?: number }
    cacheableResponse?: { statuses: number[] }
  }
}

/**
 * Endpoint-specific runtime caches, ordered specific-first so Workbox matches
 * the narrow patterns (sets/exercises/…) before the catch-all `supabase-api`.
 * The order is load-bearing and asserted in the regression tests.
 */
export const runtimeCaching: RuntimeCachingRule[] = [
  {
    // Sets collection grows as new sets are logged — StaleWhileRevalidate
    // serves cached response instantly for offline/fast load while updating
    // the cache in the background so new sets from other devices appear next load
    urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/sets\b/i,
    handler: 'StaleWhileRevalidate',
    options: {
      cacheName: 'supabase-sets',
      expiration: {
        maxEntries: 500,
        maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
      },
      cacheableResponse: {
        statuses: [0, 200],
      },
    },
  },
  {
    // Exercises change infrequently (renames, tag edits) — NetworkFirst with generous capacity
    urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/exercises\b/i,
    handler: 'NetworkFirst',
    options: {
      cacheName: 'supabase-exercises',
      expiration: {
        maxEntries: 200,
        maxAgeSeconds: 60 * 60 * 12, // 12 hours
      },
      networkTimeoutSeconds: 3,
      cacheableResponse: {
        statuses: [0, 200],
      },
    },
  },
  {
    // Bodyweight entries — moderate churn, NetworkFirst
    urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/bodyweight_entries\b/i,
    handler: 'NetworkFirst',
    options: {
      cacheName: 'supabase-bodyweight',
      expiration: {
        maxEntries: 200,
        maxAgeSeconds: 60 * 60 * 12, // 12 hours
      },
      networkTimeoutSeconds: 3,
      cacheableResponse: {
        statuses: [0, 200],
      },
    },
  },
  {
    // Progression/XP data — small payload, short TTL
    urlPattern:
      /^https:\/\/.*\.supabase\.co\/rest\/v1\/(user_progression|xp_events|progression_snapshots)\b/i,
    handler: 'NetworkFirst',
    options: {
      cacheName: 'supabase-progression',
      expiration: {
        maxEntries: 50,
        maxAgeSeconds: 60 * 60 * 6, // 6 hours
      },
      networkTimeoutSeconds: 3,
      cacheableResponse: {
        statuses: [0, 200],
      },
    },
  },
  {
    // Catch-all for any other Supabase REST endpoints
    urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/.*/i,
    handler: 'NetworkFirst',
    options: {
      cacheName: 'supabase-api',
      expiration: {
        maxEntries: 50,
        maxAgeSeconds: 60 * 60 * 24, // 24 hours
      },
      networkTimeoutSeconds: 3,
      cacheableResponse: {
        statuses: [0, 200],
      },
    },
  },
  {
    urlPattern: /^https:\/\/.*\.supabase\.co\/auth\/v1\/.*/i,
    handler: 'NetworkOnly',
    options: {
      cacheName: 'supabase-auth',
    },
  },
]

/**
 * The full `workbox` option object passed to VitePWA. Typed loosely as a record
 * so it can be spread into VitePWA's config and into `workbox-build.generateSW`
 * without dragging either package's types into this shared module.
 */
export const workboxOptions = {
  globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
  globIgnores: [
    'screenshot-*.png',
    'og-image.png',
    'icon-source.png',
    'og-preview.html',
    // iOS launch screens are loaded by Safari at cold launch via <link>
    // tags, not fetched by the app — precaching them only bloats the SW.
    'launch/*.png',
  ],
  navigateFallback: 'index.html',
  navigateFallbackDenylist: [/^\/api\//],
  navigationPreload: true,
  clientsClaim: true,
  skipWaiting: true,
  runtimeCaching,
}
