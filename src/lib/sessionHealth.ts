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
 * Reactive flag — true when auth-js refused to refresh the session and the
 * user must sign in again. Surfaced non-blockingly in the UI (App.vue banner)
 * so silent sync divergence becomes visible. Cleared on a successful refresh or
 * a TOKEN_REFRESHED / SIGNED_IN auth event.
 *
 * A refresh that only failed for the network does NOT raise it (LIFT-1549).
 * The banner's button signs out, and sign-out clears the sync journal and
 * resets every store, so raising it for a session that only needed the
 * network told the lifter to throw away every change not yet synced.
 */
export const authNeedsReauth = ref(false)

/**
 * Monotonic counter bumped whenever a *broken* session becomes healthy again
 * (LIFT-1226) — either `ensureFreshSession()` successfully refreshed a token
 * that a read/write had just rejected as expired, or a TOKEN_REFRESHED /
 * SIGNED_IN event cleared a raised `authNeedsReauth` or settled a refresh that
 * a network failure had left owed (LIFT-1549).
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
 * True while the user is signed in from the session stored on this device,
 * but auth-js has not yet been able to refresh its expired access token
 * (LIFT-1545): an offline cold start, a dead uplink, or an auth outage. No
 * store is bound to the account until the refresh succeeds, so nothing is
 * read from it or written to it. The sync indicator reads this as offline,
 * because every other signal it folds is quiet and would report "synced".
 */
export const sessionAwaitingRefresh = ref(false)

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

/**
 * An auth-js error of the class `name`, matched the way auth-js's own
 * `isAuthRetryableFetchError` / `isAuthRefreshDiscardedError` match one: its
 * `__isAuthError` brand plus the class name. The classes can't be imported:
 * supabase-js is loaded lazily (initSupabase), and a value import would pull
 * the SDK into the startup bundle. `sessionHealth.test.ts` checks these agree
 * with auth-js's own predicates on the errors the real client produces.
 */
function isAuthJsError(err: unknown, name: string): boolean {
  return typeof err === 'object' && err !== null && '__isAuthError' in err &&
    (err as { name?: unknown }).name === name
}

/**
 * auth-js's AuthRetryableFetchError: a request to the auth server that never
 * got an answer (offline, a dead uplink, a timeout) or got a 5xx.
 */
export function isRetryableAuthFetchError(err: unknown): boolean {
  return isAuthJsError(err, 'AuthRetryableFetchError')
}

/**
 * Whether a failed refresh leaves the session alive, which is whether auth-js
 * itself keeps it (LIFT-1549). It does for two kinds of failure:
 *
 * - AuthRetryableFetchError: the refresh never reached the auth server, or got
 *   a 5xx back. auth-js keeps the session in storage, answers every refresh of
 *   the same token with that cached failure for the next 60 s without trying,
 *   and its auto-refresh tries again once the network is back.
 * - AuthRefreshDiscardedError: the refresh SUCCEEDED, but the stored session
 *   changed while it was out (another tab refreshed first, or a sign-out
 *   landed), so auth-js threw the rotated tokens away. Its docs call that a
 *   no-op for the caller; a sign-out reaches useAuth as SIGNED_OUT anyway.
 *
 * Anything else auth-js reports (a refresh token the server refused, or no
 * session on the device to refresh) means the user has to sign in again.
 */
export function refreshFailureKeepsSession(error: unknown): boolean {
  return isRetryableAuthFetchError(error) || isAuthJsError(error, 'AuthRefreshDiscardedError')
}

let _refreshInFlight: Promise<boolean> | null = null

/**
 * A refresh is owed: a read or write was rejected as unauthenticated, the
 * refresh it asked for failed without ending the session (LIFT-1549), and none
 * has succeeded since. auth-js's auto-refresh gets one through once the
 * network is back, and the TOKEN_REFRESHED it emits is then the recovery that
 * re-runs those reads and writes. Before LIFT-1549 the raised `authNeedsReauth`
 * carried that memory, but only by showing the "sign in again" banner.
 */
let _refreshOwed = false

/**
 * Attempt to refresh the Supabase session exactly once, even under concurrent
 * callers (single-flight) — a wave of queued writes all hitting a stale token
 * must trigger ONE refresh, not one per write. Returns true when a valid
 * session is in hand afterward.
 *
 * Only a refresh auth-js REFUSES flips `authNeedsReauth`, so the UI prompts a
 * re-sign-in instead of silently diverging. A refresh that failed for the
 * network leaves the session as it is (LIFT-1549): see
 * `refreshFailureKeepsSession`. That includes auth-js's 60 s cooldown after a
 * failed refresh, during which every refresh of the token answers the cached
 * failure without trying, so a 401 landing just after the network returns
 * (a write sent under the anon key while the token could not be refreshed)
 * still finds the refresh failing.
 */
export function ensureFreshSession(): Promise<boolean> {
  if (!supabase) return Promise.resolve(false)
  if (_refreshInFlight) return _refreshInFlight
  const client = supabase
  _refreshInFlight = (async () => {
    try {
      const { data, error } = await client.auth.refreshSession()
      if (!error && data?.session) {
        authNeedsReauth.value = false
        _refreshOwed = false
        // Every caller reaches here because a read or write was just rejected
        // as unauthenticated, so a successful refresh IS a recovery — announce
        // it so the stale reads that provoked the refresh get re-run (LIFT-1226).
        sessionRecoveryTick.value++
        return true
      }
      if (refreshFailureKeepsSession(error)) {
        // Leaves the flag as it was: an earlier refusal still stands.
        _refreshOwed = true
        logWarn('Session refresh could not get through — keeping the session', { error: String(error) })
        return false
      }
      authNeedsReauth.value = true
      logWarn('Session refresh refused — re-sign-in required', { error: String(error) })
      return false
    } catch (err) {
      // auth-js RETURNS every auth failure as an error result, so a throw is
      // not its answer about the session (a storage failure, a bug) and proves
      // nothing either way. The next 401 asks again.
      _refreshOwed = true
      logWarn('Session refresh threw — keeping the session', { error: String(err) })
      return false
    } finally {
      _refreshInFlight = null
    }
  })()
  return _refreshInFlight
}

/** Clear the re-auth flag (e.g. after TOKEN_REFRESHED / SIGNED_IN). */
export function clearReauthFlag(): void {
  // Only a session that was actually broken represents a recovery: a RAISED
  // flag, or a refresh a network failure left owed (LIFT-1549). TOKEN_REFRESHED
  // fires routinely on a healthy session, and treating those as recoveries would
  // schedule a pointless refetch every refresh cycle (LIFT-1226).
  if (authNeedsReauth.value || _refreshOwed) sessionRecoveryTick.value++
  authNeedsReauth.value = false
  _refreshOwed = false
}

/** Reset module state (tests only). */
export function _resetSessionHealth(): void {
  _refreshInFlight = null
  _refreshOwed = false
  authNeedsReauth.value = false
  sessionRecoveryTick.value = 0
  sessionAwaitingRefresh.value = false
}
