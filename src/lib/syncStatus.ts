/**
 * Uniform sync-status contract for the four Pinia stores (LIFT-820).
 *
 * The app is local-first, so a failed background sync never blocks the UI — but
 * it also used to be completely invisible: every store swallowed fetch failures
 * into a log line and returned silently, leaving the UI with no way to surface
 * "couldn't sync" or distinguish an expired session from being offline. Each
 * store now carries a `syncing` flag and a typed `lastSyncError`, set through
 * this shared classifier so the contract is identical across stores and a single
 * sync-status indicator can read them.
 */
import { isAuthError } from './sessionHealth'

/**
 * Typed classification of a store sync failure.
 *
 * - `auth`    — an expired/invalid token (401 / PGRST301). Actionable: the user
 *               must re-sign-in (already surfaced via `authNeedsReauth`).
 * - `network` — an offline / fetch-layer failure. Transient; the local-first
 *               store keeps working and the next sync recovers.
 * - `unknown` — anything else (a server-side error, malformed response, etc.).
 */
export type SyncErrorKind = 'auth' | 'network' | 'unknown'

/**
 * Classify an error into a typed {@link SyncErrorKind}. Accepts either a thrown
 * rejection or a resolved Supabase `{ error }` object — both shapes flow through
 * `isAuthError`, so an expired token is reported as `auth` regardless of whether
 * it rejected or resolved. Non-auth failures are bucketed as `network` (the
 * common offline case) unless there is no signal of a transport failure at all.
 */
export function classifySyncError(err: unknown): SyncErrorKind {
  if (isAuthError(err)) return 'auth'
  // A fetch-layer throw (offline, DNS failure) surfaces as a TypeError in the
  // browser and as a generic Error('Network request failed') from supabase-js.
  if (err instanceof TypeError) return 'network'
  if (err && typeof err === 'object') {
    const message = typeof (err as { message?: unknown }).message === 'string'
      ? (err as { message: string }).message.toLowerCase()
      : ''
    if (message.includes('fetch') || message.includes('network') || message.includes('offline')) {
      return 'network'
    }
  }
  return 'unknown'
}
