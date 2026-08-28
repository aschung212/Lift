/**
 * Session-health utilities for surviving mid-session token expiry (LIFT-784).
 *
 * The app is local-first: the UI never waits on the network, so an expired
 * access token used to fail silently — every sync (read and write) would
 * quietly fall back to local data and never recover until a manual reload.
 * This is especially likely in WKWebView/Capacitor (the App Store target),
 * where supabase-js's visibility-driven auto-refresh is unreliable when the
 * app resumes from the background.
 *
 * This module distinguishes auth/401 failures from ordinary offline errors,
 * refreshes the session exactly once under concurrent callers (single-flight),
 * and exposes a reactive `authNeedsReauth` flag so the UI can prompt a
 * re-sign-in instead of diverging in silence.
 */
import { ref } from 'vue'
import { supabase } from './supabase'
import { logWarn } from './logger'

/**
 * Reactive flag — true when the session could not be refreshed and the user
 * must sign in again. Surfaced non-blockingly in the UI (App.vue banner) so
 * silent sync divergence becomes visible. Cleared on a successful refresh or a
 * TOKEN_REFRESHED / SIGNED_IN auth event.
 */
export const authNeedsReauth = ref(false)

/**
 * Monotonic counter bumped whenever a *broken* session becomes healthy again
 * (LIFT-1226) — either `ensureFreshSession()` successfully refreshed a token
 * that a read/write had just rejected as expired, or a TOKEN_REFRESHED /
 * SIGNED_IN event cleared a raised `authNeedsReauth`.
 *
 * A plain watcher on `authNeedsReauth` cannot observe the first case: the
 * common recovery is a 401 → refresh → success sequence in which the flag was
 * never raised, so there is no true→false edge to watch. Recovery consumers
 * (useSyncRecovery) watch this tick instead, so a token that heals mid-session
 * immediately re-reconciles rather than leaving the app on stale local data
 * until the next full relaunch.
 */
export const sessionRecoveryTick = ref(0)

/**
 * Heuristically detect an authentication / 401 error from a Supabase response.
 *
 * Supabase REST ops resolve `{ data, error }` rather than rejecting, and a JWT
 * expiry surfaces as a PostgrestError (`code: 'PGRST301'` / a 401-ish message)
 * — but a network-layer throw carries a numeric `status` instead. This
 * normalizes both shapes so callers can branch on "auth" vs "offline".
 */
export function isAuthError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as Record<string, unknown>
  const status = e.status ?? e.statusCode
  if (status === 401 || status === '401') return true
  // PostgREST JWT errors: PGRST301 (expired/invalid JWT), PGRST303 (JWT issued
  // in the future / clock skew). Both mean "the token is no good".
  if (typeof e.code === 'string' && /^PGRST30[13]$/.test(e.code)) return true
  if (e.code === 401 || e.code === '401') return true
  const message = typeof e.message === 'string' ? e.message.toLowerCase() : ''
  return (
    message.includes('jwt expired') ||
    message.includes('jwt is expired') ||
    message.includes('token is expired') ||
    message.includes('token has expired') ||
    message.includes('invalid jwt') ||
    message.includes('not authenticated') ||
    message.includes('unauthorized')
  )
}

let _refreshInFlight: Promise<boolean> | null = null

/**
 * Attempt to refresh the Supabase session exactly once, even under concurrent
 * callers (single-flight) — a wave of queued writes all hitting a stale token
 * must trigger ONE refresh, not one per write. Returns true when a valid
 * session is in hand afterward. On failure it flips `authNeedsReauth` so the UI
 * can prompt a re-sign-in instead of silently diverging.
 */
export function ensureFreshSession(): Promise<boolean> {
  if (!supabase) return Promise.resolve(false)
  if (_refreshInFlight) return _refreshInFlight
  const client = supabase
  _refreshInFlight = (async () => {
    try {
      const { data, error } = await client.auth.refreshSession()
      const ok = !error && !!data?.session
      authNeedsReauth.value = !ok
      if (!ok) logWarn('Session refresh failed — re-sign-in required', { error: String(error) })
      // Every caller reaches here because a read or write was just rejected as
      // unauthenticated, so a successful refresh IS a recovery — announce it so
      // the stale reads that provoked the refresh get re-run (LIFT-1226).
      else sessionRecoveryTick.value++
      return ok
    } catch (err) {
      authNeedsReauth.value = true
      logWarn('Session refresh threw — re-sign-in required', { error: String(err) })
      return false
    } finally {
      _refreshInFlight = null
    }
  })()
  return _refreshInFlight
}

/** Clear the re-auth flag (e.g. after TOKEN_REFRESHED / SIGNED_IN). */
export function clearReauthFlag(): void {
  // Only a flag that was actually RAISED represents a recovery. TOKEN_REFRESHED
  // fires routinely on a healthy session, and treating those as recoveries would
  // schedule a pointless refetch every refresh cycle (LIFT-1226).
  if (authNeedsReauth.value) sessionRecoveryTick.value++
  authNeedsReauth.value = false
}

/** Reset module state (tests only). */
export function _resetSessionHealth(): void {
  _refreshInFlight = null
  authNeedsReauth.value = false
  sessionRecoveryTick.value = 0
}
