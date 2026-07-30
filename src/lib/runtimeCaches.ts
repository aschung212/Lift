/**
 * Workbox runtime cache teardown (LIFT-1048).
 *
 * signOut()/deleteAccount() wipe localStorage, IndexedDB and the sync journal,
 * but the Workbox runtime caches — which hold the user's actual sets, exercises
 * and bodyweight with TTLs up to 7 days — live in a separate Cache Storage layer
 * that was never cleared. On a shared device the previous user's training data
 * stayed readable after sign-out, and deleteAccount()'s promise to erase all
 * local data left cached copies behind. This module is the single teardown point
 * for that layer.
 */

import { logError } from './logger'

/**
 * Prefix shared by every Workbox runtime cache this app creates.
 *
 * The `runtimeCaching` config in `vite.config.js` names every cache `supabase-*`
 * (supabase-sets, supabase-exercises, supabase-bodyweight, supabase-progression,
 * supabase-api, supabase-auth). Deleting by prefix — rather than by a
 * hand-maintained copy of each name — means a new runtime cache added to the
 * Workbox config is purged automatically, so the two lists cannot silently drift.
 */
export const RUNTIME_CACHE_PREFIX = 'supabase-'

/**
 * The runtime caches known at build time. Kept as an explicit source of truth
 * for the regression test that pins them against `vite.config.js`; deletion uses
 * {@link RUNTIME_CACHE_PREFIX}, not this list, so drift can never leave a cache
 * behind.
 */
export const RUNTIME_CACHE_NAMES = [
  'supabase-sets',
  'supabase-exercises',
  'supabase-bodyweight',
  'supabase-progression',
  'supabase-api',
  'supabase-auth',
] as const

/**
 * Purge the app's Workbox runtime caches from Cache Storage.
 *
 * Guarded behind a Cache Storage capability check so native/Capacitor (SW
 * disabled, #532) and SSR/test contexts no-op safely. Never throws — a failed
 * cache purge must not block the sign-out/delete flow.
 */
export async function clearRuntimeCaches(): Promise<void> {
  if (typeof caches === 'undefined') return
  try {
    const keys = await caches.keys()
    await Promise.all(
      keys
        .filter((name) => name.startsWith(RUNTIME_CACHE_PREFIX))
        .map((name) => caches.delete(name)),
    )
  } catch (err) {
    logError(err, { source: 'runtimeCaches', action: 'clearRuntimeCaches' })
  }
}
