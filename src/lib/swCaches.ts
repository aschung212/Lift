/**
 * Names of the Workbox runtime caches that hold authenticated Supabase REST
 * responses — the user's workouts, bodyweight, and progression. These mirror
 * the `cacheName` values in the `runtimeCaching` config in `vite.config.js`;
 * `swCachesRegression.test.ts` pins them in sync so the two never drift.
 *
 * `supabase-auth` is intentionally excluded: that route is NetworkOnly and
 * never stores a response, so there is nothing to purge (and no token at rest).
 */
export const SUPABASE_RUNTIME_CACHES = [
  'supabase-sets',
  'supabase-exercises',
  'supabase-bodyweight',
  'supabase-progression',
  'supabase-api',
] as const

/**
 * Delete the Workbox runtime caches that contain the signed-in user's personal
 * Supabase data. Called on sign-out and account deletion so no workout,
 * bodyweight, or progression data is left at rest in Cache Storage on a shared
 * device — mirroring the existing localStorage and IndexedDB cleanup.
 *
 * Degrades gracefully where the Cache Storage API is unavailable (Capacitor
 * WKWebView, SSR, test environments) or throws (private browsing, restricted
 * contexts): the failure is swallowed so it never blocks sign-out.
 */
export async function purgeSupabaseRuntimeCaches(): Promise<void> {
  if (typeof caches === 'undefined') return
  try {
    const names = await caches.keys()
    await Promise.all(
      names
        .filter((name) => (SUPABASE_RUNTIME_CACHES as readonly string[]).includes(name))
        .map((name) => caches.delete(name)),
    )
  } catch {
    // Cache Storage can be unavailable or throw in restricted environments —
    // cleanup is best-effort and must never block the sign-out flow.
  }
}
