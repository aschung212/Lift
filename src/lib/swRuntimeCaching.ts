import type { VitePWAOptions } from 'vite-plugin-pwa'

/** One entry of Workbox's `runtimeCaching`, exactly as `generateSW` takes it. */
export type RuntimeCachingRule =
  NonNullable<NonNullable<VitePWAOptions['workbox']>['runtimeCaching']>[number]

/** Every request to the Supabase project: REST reads, auth, and whatever comes next. */
export const SUPABASE_ORIGIN_PATTERN = /^https:\/\/[^/]+\.supabase\.co\//i

/**
 * The service worker's runtime routes, handed to `generateSW` by
 * `vite.config.js`. They live here rather than inline in the config so the
 * table the build ships is the table the tests evaluate (LIFT-1524). Workbox
 * registers them in this order and the FIRST match handles a request.
 *
 * **Nothing from the Supabase project is ever answered from Cache Storage.**
 * Every store treats a read that resolves `{ data, error: null }` as the
 * server's CURRENT state, and a cached response looks exactly like a fresh one.
 * So the cache never made a read degrade gracefully; it made it lie, and the
 * merges then pushed the lie back to the server:
 *
 *  - `exercises` and `bodyweight_entries` were NetworkFirst (12 h, 3 s
 *    timeout). On a launch that was offline, or slower than 3 s, the read
 *    resolved with the rows the last good launch saw. A row another device had
 *    edited since then TIED this device's copy, the merge scores a tie as a
 *    local win, and the local-wins loop re-upserted the stale row over the
 *    edit. The trigger then stamped the revert newest, so the device that made
 *    the edit adopted the revert on its next sync.
 *  - `sets` was StaleWhileRevalidate (7 d), so EVERY read got the previous
 *    read's snapshot, online included. A set this device logged after that
 *    snapshot looked missing from the server, and the reconciliation pass
 *    re-pushed this device's copy of it over any correction another device had
 *    made in between.
 *  - The `/rest/v1` catch-all (24 h) and `user_progression` (6 h) did the same
 *    to the two one-row-per-user stores, which adopt their row remote-wins.
 *
 * The stores keep their own copy in localStorage and IndexedDB, so a read that
 * fails costs nothing: local state stands and `useSyncRecovery` reads again on
 * reconnect or resume. All the cache ever bought was a read that resolved
 * sooner, with rows that might be days old.
 *
 * The route is explicit rather than absent so that it claims the origin FIRST.
 * A caching rule added below it can never capture a Supabase request, and one
 * placed above it fails `architecturalInvariants.test.ts`, which resolves a
 * read of every table the migrations create against this array.
 *
 * The price is an honest failure. An offline launch now waits for its reads to
 * fail (postgrest-js retries a GET three times, 1 s / 2 s / 4 s) where a fresh
 * cache used to answer at once; that is the wait an expired cache already
 * cost, and keeping the splash off network reads is LIFT-1516. The 3 s bound
 * cannot carry over, because workbox-build rejects `networkTimeoutSeconds` on
 * any handler but NetworkFirst.
 *
 * Existing installs keep the retired `supabase-*` caches' last entries on disk.
 * Nothing reads them any more; deleting them is LIFT-1525.
 */
export const RUNTIME_CACHING: RuntimeCachingRule[] = [
  {
    urlPattern: SUPABASE_ORIGIN_PATTERN,
    // A NetworkOnly route stores nothing, so it names no cache.
    handler: 'NetworkOnly',
  },
]
