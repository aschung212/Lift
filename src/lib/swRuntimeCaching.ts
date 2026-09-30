import type { VitePWAOptions } from 'vite-plugin-pwa'

/** One entry of Workbox's `runtimeCaching`, exactly as `generateSW` takes it. */
export type RuntimeCachingRule =
  NonNullable<NonNullable<VitePWAOptions['workbox']>['runtimeCaching']>[number]

/**
 * The service worker's runtime routes, handed to `generateSW` by
 * `vite.config.js` (LIFT-1510). They live here rather than inline in the config
 * so the table the build ships is the table the tests evaluate. Workbox tries
 * them in this order and the FIRST match answers the request.
 *
 * The rule: a Supabase read is answered from Cache Storage only by a rule that
 * names its table on purpose. Everything else under `/rest/v1`, including the
 * one-row-per-user tables `user_preferences` and `user_progression`, is
 * NetworkOnly and behaves exactly as if there were no service worker.
 *
 * Why the default has to be the network: every store treats a read that
 * resolves `{ data, error: null }` as the server's CURRENT state, and a cached
 * response is indistinguishable from a fresh one. The catch-all used to be
 * NetworkFirst (24 h), which is how `user_preferences` came to be cached without
 * anyone deciding it should be, and `user_progression` had a NetworkFirst rule
 * of its own (6 h). On any launch within those windows that was offline, or
 * slower than the 3-second network timeout, the SW answered both reads with the
 * row from the last good launch, and both stores adopt that row remote-wins.
 * Preferences reverted every setting changed since then and re-persisted the
 * revert (FOUC mirror keys included), so the next settings change pushed it
 * over the account's blob.
 * Progression adopted the stale staged goal / visibility / starter / epoch and
 * `_syncToSupabase` pushed them straight back. Without the SW the same read
 * would simply have failed, and local state, which was newer, would have stood.
 * Both stores keep their own copy in localStorage and IndexedDB, so the HTTP
 * cache bought them nothing.
 *
 * The price is an honest failure: an offline launch now waits for these two
 * reads to fail (postgrest-js retries a GET three times, 1 s / 2 s / 4 s) where
 * a fresh cache used to answer at once. That is the wait an expired cache
 * already cost; keeping the splash off the network reads is LIFT-1516. The old
 * 3-second bound cannot be carried over: workbox-build 7 rejects
 * `networkTimeoutSeconds` on any handler but NetworkFirst, whatever its types
 * say, so NetworkOnly here runs to the browser's own timeout.
 *
 * `sets`, `exercises` and `bodyweight_entries` keep their caches. Their stores
 * merge row by row (last-write-wins on the trigger-maintained `updated_at`,
 * sets unioned by id) instead of adopting one whole row, so a stale answer
 * cannot revert them wholesale. That is a narrower claim than "safe": a stale
 * row that TIES its local copy is still re-upserted as a local win (LIFT-1399),
 * and it is a separate change from this one.
 */
export const RUNTIME_CACHING: RuntimeCachingRule[] = [
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
    // Every other REST read, including user_preferences and user_progression:
    // the network, and nothing else. This is the default a new table gets, so
    // caching one has to be decided by adding a rule above, never inherited.
    urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/.*/i,
    handler: 'NetworkOnly',
  },
  {
    urlPattern: /^https:\/\/.*\.supabase\.co\/auth\/v1\/.*/i,
    handler: 'NetworkOnly',
    options: {
      cacheName: 'supabase-auth',
    },
  },
]
