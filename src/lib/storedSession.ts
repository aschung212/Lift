/**
 * The session auth-js has stored on this device, read without asking auth-js
 * (LIFT-1545).
 *
 * `getSession()` cannot answer for a session whose access token has expired
 * until it has refreshed that token, and on an offline cold start the refresh
 * fails. auth-js retries for about 25 s (one browser network timeout on a dead
 * uplink), keeps the session in storage because the failure is retryable, and
 * then answers `session: null`: the same answer it gives a device that was
 * never signed in. The user's identity is still on the device, in the slot
 * auth-js will refresh from once the network is back. This module reads it
 * from there, so the app can keep that user signed in locally in the meantime.
 *
 * Only what the app shows of a user (id and email) and the access token's
 * expiry are read, through a guard. The blob is auth-js's format, not ours, so
 * anything this code does not recognise reads as "nothing stored", which puts
 * the user on the sign-in screen as every offline cold start did before.
 *
 * The key lives here rather than beside the client in `supabase.ts`, which
 * imports it: this module must keep working wherever that one is mocked.
 */

/**
 * The localStorage key auth-js keeps the session under, for a project URL.
 * Null when the URL does not parse.
 *
 * supabase-js derives this key itself when none is given, by this exact rule
 * (`sb-<first label of the hostname>-auth-token`). `initSupabase` passes it
 * explicitly, so the slot this module reads is the slot the client writes.
 * Using the same rule means every session already persisted under the default
 * is found: a different key would sign every user out on update, and so would
 * a future supabase-js release that changed its default if the key were left
 * implicit. `storedSession.test.ts` checks both derivations agree, against
 * the real SDK.
 */
export function authStorageKey(url: string): string | null {
  try {
    return `sb-${new URL(url.trim()).hostname.split('.')[0]}-auth-token`
  } catch {
    return null
  }
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined

/** Where this build's auth session lives, or null when Supabase isn't configured. */
export const AUTH_STORAGE_KEY: string | null = supabaseUrl ? authStorageKey(supabaseUrl) : null

export interface StoredSession {
  user: { id: string; email: string }
  /** When the stored access token expires, in ms since the epoch. */
  expiresAt: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The session stored under `key`, if it is one auth-js would load and could
 * refresh: an access token, a refresh token and an expiry (the fields auth-js
 * checks before it trusts a stored session), plus a user with an id. Null for
 * anything else.
 */
export function readStoredSession(key: string | null = AUTH_STORAGE_KEY): StoredSession | null {
  if (!key) return null
  let parsed: unknown
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const { access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAt, user } = parsed
  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string' || refreshToken === '') return null
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return null
  if (!isRecord(user) || typeof user.id !== 'string' || user.id === '') return null
  return {
    user: { id: user.id, email: typeof user.email === 'string' ? user.email : '' },
    expiresAt: expiresAt * 1000,
  }
}

/**
 * Remove the stored session, the way auth-js's own sign-out does.
 *
 * Needed because auth-js cannot always do it: `signOut()` loads the session
 * first, which refreshes an expired access token, and when that refresh fails
 * retryably (offline, a dead uplink, an auth outage) it returns the error
 * WITHOUT removing anything. The next refresh that succeeds, whether the
 * auto-refresh ticker once the network is back or the next launch, then signs
 * the user straight back in. auth-js reads storage on every call, so a removed
 * session is simply gone to it; a refresh already in flight is discarded by its
 * own commit guard, which checks the slot has not changed under it.
 */
export function clearStoredSession(key: string | null = AUTH_STORAGE_KEY): void {
  if (!key) return
  try {
    localStorage.removeItem(key)
    // Where auth-js keeps the user when it is configured to split it out. This
    // app never does, but auth-js's own sign-out clears it too.
    localStorage.removeItem(`${key}-user`)
  } catch {
    // Storage unavailable: there is nothing this code can remove.
  }
}
