/**
 * Shared classification + telemetry for Supabase READ failures (LIFT-786).
 *
 * Every store's `_fetchFromSupabase` historically logged a single console
 * warning and fell back to local data on ANY error. That is correct for
 * genuine offline use, but it makes a misconfigured / accidentally-disabled
 * RLS policy — or an expired auth token — indistinguishable from being
 * offline: the app just quietly serves stale local data and never raises an
 * alarm. This helper separates the three cases so that only true offline
 * failures stay quiet in telemetry, while auth and server/RLS regressions
 * reach Sentry. What the user SEES is the store's `lastSyncError`, recorded
 * beside every call to this (LIFT-1179) — see `reportFetchError`.
 */

import { logError, logWarn } from './logger'

export type FetchErrorCategory = 'offline' | 'auth' | 'server'

/** Minimal shape covering both PostgrestError objects and thrown Errors. */
interface ErrorLike {
  message?: unknown
  code?: unknown
  status?: unknown
  details?: unknown
  hint?: unknown
}

// Network-layer failures never reach PostgREST. supabase-js / the fetch layer
// throw these across browsers (Chrome 'Failed to fetch', Firefox 'NetworkError',
// iOS Safari 'Load failed', node-undici 'fetch failed').
const OFFLINE_SIGNALS = [
  'failed to fetch',
  'network request failed',
  'networkerror',
  'load failed',
  'fetch failed',
  'network error',
]

/**
 * Classify a read error into offline vs auth vs server/RLS.
 *
 * - `offline`: request never reached the server (network layer). Expected
 *   during real offline use — safe to fall back to local data silently.
 * - `auth`:    token expired / invalid / 401. The session needs a refresh;
 *   reads will keep failing until then.
 * - `server`:  the request reached PostgREST and was refused — RLS denial
 *   (Postgres `42501`), 5xx, malformed query, etc. This is the dangerous
 *   case the issue targets: a silent RLS regression looks like "offline".
 *
 * Pure and side-effect free so it can be unit-tested in isolation.
 */
export function classifyFetchError(error: unknown): FetchErrorCategory {
  const e: ErrorLike = (error && typeof error === 'object') ? (error as ErrorLike) : {}
  const code = typeof e.code === 'string' ? e.code : ''
  const status = typeof e.status === 'number' ? e.status : undefined
  const rawMessage = typeof e.message === 'string' ? e.message : String(error ?? '')
  const msg = rawMessage.toLowerCase()

  // navigator.onLine === false is decisive — the device knows it has no link.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline'
  if (OFFLINE_SIGNALS.some(s => msg.includes(s))) return 'offline'

  // Auth failures — JWT expired/invalid or an explicit 401. PostgREST returns
  // PGRST301 (JWTExpired) / PGRST302 (JWTIssuedAtFuture); supabase-js auth
  // errors carry a 401 status.
  if (status === 401) return 'auth'
  if (code === 'PGRST301' || code === 'PGRST302') return 'auth'
  if (
    msg.includes('jwt') ||
    msg.includes('token is expired') ||
    msg.includes('unauthorized') ||
    msg.includes('not authorized')
  ) {
    return 'auth'
  }

  // Everything else reached the server and was refused — RLS denial, server
  // error, malformed query. The masked, must-be-observable case.
  return 'server'
}

/**
 * Centralized telemetry for a store read failure: classify it and route it.
 *
 * - offline → console-only `logWarn` (expected; no Sentry).
 * - auth / server → error-level `logError` (Sentry), so the failure is
 *   observable instead of masquerading as offline.
 *
 * It deliberately does NOT touch the sync indicator. Every caller records the
 * same failure in its store's `lastSyncError` (enforced by
 * architecturalInvariants.test.ts), `combineSyncStatus` shows that as "Sync
 * failed", and the store's next successful read clears it. This used to also
 * set the WRITE queue's shared `syncStatus` to 'error' (LIFT-786, written
 * before the `lastSyncError` fold existed), and nothing on the read path can
 * set that ref back — only a successful flush does. So a read that failed and
 * then recovered kept "Sync failed" up until some unrelated write happened to
 * flush (never, where writes are blocked: a preview deploy), and the 'error'
 * was broadcast to every other open tab, whose own reads were fine
 * (LIFT-1543).
 *
 * Returns the category so callers can branch further if needed.
 */
export function reportFetchError(
  storeName: string,
  error: unknown,
  context?: Record<string, unknown>,
): FetchErrorCategory {
  const category = classifyFetchError(error)
  const detail = { store: storeName, category, error: String(error), ...context }

  if (category === 'offline') {
    logWarn(`Supabase fetch failed in ${storeName} store — using local data (offline)`, detail)
    return category
  }

  // auth or server/RLS — observable and worth surfacing.
  logError(new Error(`Supabase ${category} read failure in ${storeName} store`), detail)
  return category
}
