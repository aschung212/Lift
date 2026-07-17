/**
 * Shared classification + telemetry for Supabase READ failures (LIFT-786).
 *
 * Every store's `_fetchFromSupabase` historically logged a single console
 * warning and fell back to local data on ANY error. That is correct for
 * genuine offline use, but it makes a misconfigured / accidentally-disabled
 * RLS policy — or an expired auth token — indistinguishable from being
 * offline: the app just quietly serves stale local data and never raises an
 * alarm. This helper separates the three cases so that only true offline
 * failures stay quiet, while auth and server/RLS regressions become
 * observable (Sentry) and visibly degrade the sync indicator.
 */

import { logError, logWarn } from './logger'
import { syncStatus } from './syncQueue'
import { broadcastSyncStatus } from './crossTabSync'

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
 * Centralized handling for a store read failure: classify, route telemetry,
 * and reflect a degraded sync state.
 *
 * - offline → console-only `logWarn` (expected; no Sentry, no status change).
 * - auth / server → error-level `logError` (Sentry) AND flips the shared
 *   `syncStatus` indicator to `error` so the failure is visible instead of
 *   masquerading as offline.
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

  // Reflect a degraded sync state in the existing indicator. A successful
  // write flush (syncStatus → 'synced') clears it. Guarded so the import is
  // robust if syncStatus is unavailable (e.g. in a mocked test module).
  if (syncStatus && syncStatus.value !== 'syncing') {
    syncStatus.value = 'error'
    broadcastSyncStatus('error')
  }

  return category
}
