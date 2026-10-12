import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createClient,
  isAuthRefreshDiscardedError,
  isAuthRetryableFetchError,
  type SupabaseClient,
} from '@supabase/supabase-js'

// A mutable mock of the supabase singleton so each test can shape auth
// behavior, or install a real client (the LIFT-1549 block at the bottom).
const mockAuth = {
  refreshSession: vi.fn(),
}
vi.mock('../supabase', () => ({
  get supabase() {
    return mockSupabase
  },
}))
let mockSupabase: unknown = { auth: mockAuth }

import {
  isAuthError,
  ensureFreshSession,
  authNeedsReauth,
  clearReauthFlag,
  refreshFailureKeepsSession,
  sessionRecoveryTick,
  _resetSessionHealth,
} from '../sessionHealth'

/** An error shaped the way auth-js builds one: an Error carrying its brand and class name. */
function authJsError(name: string, message: string, status: number): Error {
  return Object.assign(new Error(message), { __isAuthError: true, name, status })
}

/** auth-js's answer for a refresh token the server refused. */
const refused = () => ({
  data: { user: null, session: null },
  error: authJsError('AuthApiError', 'Invalid Refresh Token: Refresh Token Not Found', 400),
})

/** auth-js's answer for a refresh that never reached the auth server. */
const unreachable = () => ({
  data: { user: null, session: null },
  error: authJsError('AuthRetryableFetchError', 'Failed to fetch', 0),
})

beforeEach(() => {
  mockSupabase = { auth: mockAuth }
  mockAuth.refreshSession.mockReset()
  _resetSessionHealth()
})

describe('isAuthError', () => {
  it('detects a 401 numeric status', () => {
    expect(isAuthError({ status: 401 })).toBe(true)
    expect(isAuthError({ statusCode: 401 })).toBe(true)
    expect(isAuthError({ status: '401' })).toBe(true)
  })

  it('detects PostgREST JWT error codes', () => {
    expect(isAuthError({ code: 'PGRST301' })).toBe(true) // expired/invalid JWT
    expect(isAuthError({ code: 'PGRST303' })).toBe(true) // JWT from the future
  })

  it('detects auth-shaped messages', () => {
    expect(isAuthError({ message: 'JWT expired' })).toBe(true)
    expect(isAuthError({ message: 'Token has expired' })).toBe(true)
    expect(isAuthError({ message: 'invalid JWT: signature is invalid' })).toBe(true)
    expect(isAuthError({ message: 'Unauthorized' })).toBe(true)
  })

  it('does NOT flag offline / unrelated errors', () => {
    expect(isAuthError({ message: 'Failed to fetch' })).toBe(false)
    expect(isAuthError({ message: 'NetworkError when attempting to fetch resource' })).toBe(false)
    expect(isAuthError({ code: 'PGRST116' })).toBe(false) // no rows
    expect(isAuthError({ code: '23505' })).toBe(false) // unique violation
    expect(isAuthError(null)).toBe(false)
    expect(isAuthError(undefined)).toBe(false)
    expect(isAuthError('jwt expired')).toBe(false) // strings aren't error objects
  })
})

describe('ensureFreshSession', () => {
  it('returns true and clears the flag when refresh succeeds', async () => {
    authNeedsReauth.value = true
    mockAuth.refreshSession.mockResolvedValue({ data: { session: { access_token: 'fresh' } }, error: null })

    const ok = await ensureFreshSession()

    expect(ok).toBe(true)
    expect(authNeedsReauth.value).toBe(false)
    expect(mockAuth.refreshSession).toHaveBeenCalledTimes(1)
  })

  it('flips authNeedsReauth when auth-js refuses the refresh', async () => {
    mockAuth.refreshSession.mockResolvedValue(refused())

    const ok = await ensureFreshSession()

    expect(ok).toBe(false)
    expect(authNeedsReauth.value).toBe(true)
  })

  it('flips authNeedsReauth for an error auth-js does not mark retryable', async () => {
    // No brand, no class name: nothing says the session survived.
    mockAuth.refreshSession.mockResolvedValue({ data: { session: null }, error: { message: 'invalid refresh token' } })

    await ensureFreshSession()

    expect(authNeedsReauth.value).toBe(true)
  })

  // LIFT-1549: the banner this flag raises signs out, and sign-out clears the
  // sync journal and resets every store. A session that only needed the
  // network must not be offered that.
  it('keeps the session when the refresh could not get through', async () => {
    mockAuth.refreshSession.mockResolvedValue(unreachable())

    const ok = await ensureFreshSession()

    expect(ok).toBe(false)
    expect(authNeedsReauth.value).toBe(false)
  })

  it('keeps the session when auth-js discarded a refresh another tab beat', async () => {
    mockAuth.refreshSession.mockResolvedValue({
      data: { user: null, session: null },
      error: authJsError('AuthRefreshDiscardedError', 'Refresh result discarded', 409),
    })

    await ensureFreshSession()

    expect(authNeedsReauth.value).toBe(false)
  })

  it('leaves an earlier refusal standing when a later refresh could not get through', async () => {
    mockAuth.refreshSession.mockResolvedValueOnce(refused()).mockResolvedValueOnce(unreachable())

    await ensureFreshSession()
    await ensureFreshSession()

    expect(authNeedsReauth.value).toBe(true)
  })

  // auth-js returns every auth failure as a result, so a throw is not its
  // answer about the session. It used to raise the flag, pinned here with an
  // error literally named "network down".
  it('keeps the session when the refresh throws', async () => {
    mockAuth.refreshSession.mockRejectedValue(new Error('storage unavailable'))

    const ok = await ensureFreshSession()

    expect(ok).toBe(false)
    expect(authNeedsReauth.value).toBe(false)
  })

  it('is single-flight — concurrent callers share ONE refresh', async () => {
    let resolveRefresh: (v: unknown) => void = () => {}
    mockAuth.refreshSession.mockReturnValue(
      new Promise((res) => { resolveRefresh = res }),
    )

    const a = ensureFreshSession()
    const b = ensureFreshSession()
    const c = ensureFreshSession()

    resolveRefresh({ data: { session: { access_token: 'x' } }, error: null })
    await Promise.all([a, b, c])

    expect(mockAuth.refreshSession).toHaveBeenCalledTimes(1)
  })

  it('allows a new refresh after the previous one settles', async () => {
    mockAuth.refreshSession.mockResolvedValue({ data: { session: { access_token: 'x' } }, error: null })

    await ensureFreshSession()
    await ensureFreshSession()

    expect(mockAuth.refreshSession).toHaveBeenCalledTimes(2)
  })

  it('returns false without throwing when supabase is unavailable', async () => {
    mockSupabase = null
    const ok = await ensureFreshSession()
    expect(ok).toBe(false)
  })
})

describe('clearReauthFlag', () => {
  it('resets the flag', () => {
    authNeedsReauth.value = true
    clearReauthFlag()
    expect(authNeedsReauth.value).toBe(false)
  })
})

/**
 * The recovery signal read-path recovery listens to (LIFT-1226). Watching
 * `authNeedsReauth` alone is not enough: the common recovery is 401 -> refresh
 * -> success, in which the flag is never raised and so has no true->false edge.
 */
describe('sessionRecoveryTick', () => {
  it('bumps when a refresh heals the session', async () => {
    mockAuth.refreshSession.mockResolvedValue({ data: { session: { access_token: 'fresh' } }, error: null })

    // The flag was never raised — the only recovery evidence is this tick.
    expect(authNeedsReauth.value).toBe(false)
    await ensureFreshSession()

    expect(sessionRecoveryTick.value).toBe(1)
  })

  it('does not bump when the refresh fails', async () => {
    mockAuth.refreshSession.mockResolvedValue(refused())

    await ensureFreshSession()

    expect(sessionRecoveryTick.value).toBe(0)
  })

  it('does not bump when the refresh could not get through', async () => {
    mockAuth.refreshSession.mockResolvedValue(unreachable())

    await ensureFreshSession()

    expect(sessionRecoveryTick.value).toBe(0)
  })

  it('does not bump when the refresh throws', async () => {
    mockAuth.refreshSession.mockRejectedValue(new Error('storage unavailable'))

    await ensureFreshSession()

    expect(sessionRecoveryTick.value).toBe(0)
  })

  // LIFT-1549 stopped raising the flag for a refresh the network blocked, and
  // the raised flag was the only thing that made the TOKEN_REFRESHED arriving
  // once the network returns count as a recovery. Without the owed refresh
  // standing in for it, the reads and writes that 401'd would stay stale.
  it('bumps when TOKEN_REFRESHED lands after a refresh the network blocked', async () => {
    mockAuth.refreshSession.mockResolvedValue(unreachable())
    await ensureFreshSession()

    clearReauthFlag()
    clearReauthFlag()

    // Once: the owed refresh is settled by the first event.
    expect(sessionRecoveryTick.value).toBe(1)
  })

  it('bumps when TOKEN_REFRESHED lands after a refresh that threw', async () => {
    mockAuth.refreshSession.mockRejectedValue(new Error('storage unavailable'))
    await ensureFreshSession()

    clearReauthFlag()

    expect(sessionRecoveryTick.value).toBe(1)
  })

  it('settles the owed refresh when a later refresh of its own succeeds', async () => {
    mockAuth.refreshSession
      .mockResolvedValueOnce(unreachable())
      .mockResolvedValueOnce({ data: { session: { access_token: 'fresh' } }, error: null })
    await ensureFreshSession()
    await ensureFreshSession()
    expect(sessionRecoveryTick.value).toBe(1)

    // The TOKEN_REFRESHED that success emits is routine by now.
    clearReauthFlag()

    expect(sessionRecoveryTick.value).toBe(1)
  })

  it('bumps when a RAISED reauth flag is cleared by a re-sign-in', () => {
    authNeedsReauth.value = true

    clearReauthFlag()

    expect(sessionRecoveryTick.value).toBe(1)
  })

  it('stays flat when a healthy session merely refreshes its token', () => {
    // TOKEN_REFRESHED fires routinely on a healthy session; treating each one as
    // a recovery would schedule a pointless four-store re-fetch every cycle.
    clearReauthFlag()
    clearReauthFlag()

    expect(sessionRecoveryTick.value).toBe(0)
  })
})

/**
 * LIFT-1549, against the REAL supabase-js client, the way storedSession.test.ts
 * pins auth-js's half of LIFT-1545.
 *
 * `ensureFreshSession` raised `authNeedsReauth` on every failed refresh. The
 * mocks above could never have shown what was wrong with that, because they
 * only ever returned a failure as `{ message: 'invalid refresh token' }` or a
 * throw: which failures auth-js reports as RETRYABLE, keeping the session for
 * its own auto-refresh, exists only inside auth-js. So here the client the app
 * builds runs against an auth server the test controls, and each case checks
 * the answer auth-js gave, that this module reads it the way auth-js's own
 * predicates do, and what became of the banner flag.
 */
describe('ensureFreshSession against the real supabase-js client (LIFT-1549)', () => {
  const PROJECT_URL = 'https://abcdefghijklmnop.supabase.co'
  const KEY = 'sb-abcdefghijklmnop-auth-token'
  const NOW = new Date('2026-10-02T12:00:00.000Z')
  const USER = {
    id: 'user-1',
    email: 'lifter@example.com',
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: { provider: 'email' },
    user_metadata: {},
    created_at: '2026-01-01T00:00:00.000Z',
  }

  function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }

  const offline = (): Response => { throw new TypeError('Failed to fetch') }
  const refreshed = (): Response => json(200, {
    access_token: 'refreshed.access.token',
    token_type: 'bearer',
    expires_in: 3600,
    refresh_token: 'refresh-token-2',
    user: USER,
  })

  /** What the auth server does with the next refresh request. */
  let server: () => Response = offline
  const fetchMock = vi.fn(async (): Promise<Response> => server())
  let client: SupabaseClient | null = null

  /** A session as auth-js persists it, whose access token expires `expiresIn` seconds from NOW. */
  function storeSession(expiresIn: number, refreshToken = 'refresh-token-1'): void {
    localStorage.setItem(KEY, JSON.stringify({
      access_token: 'header.payload.signature',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(NOW.getTime() / 1000) + expiresIn,
      refresh_token: refreshToken,
      user: USER,
    }))
  }

  /** The client initSupabase builds, installed as the app's client. */
  function startClient(): SupabaseClient {
    client = createClient(PROJECT_URL, 'anon-key-for-tests', {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
        storageKey: KEY,
      },
      global: { fetch: fetchMock },
    })
    mockSupabase = client
    return client
  }

  /**
   * What a store does on a 401: ask for a refresh. Run past auth-js's ~25 s of
   * retries, and report what it returned beside the error auth-js answered the
   * refresh with.
   */
  async function refreshAfterA401(c: SupabaseClient): Promise<{ ok: boolean; error: unknown }> {
    const refresh = vi.spyOn(c.auth, 'refreshSession')
    try {
      const pending = ensureFreshSession()
      await vi.advanceTimersByTimeAsync(60_000)
      const ok = await pending
      const answer = (await refresh.mock.results.at(-1)?.value) as { error: unknown } | undefined
      return { ok, error: answer?.error }
    } finally {
      refresh.mockRestore()
    }
  }

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW })
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    server = offline
    fetchMock.mockClear()
  })

  afterEach(async () => {
    await client?.auth.dispose()
    client = null
    vi.useRealTimers()
  })

  it('keeps the session when the refresh never reaches the auth server', async () => {
    storeSession(3000)
    const { ok, error } = await refreshAfterA401(startClient())

    expect(ok).toBe(false)
    expect(fetchMock).toHaveBeenCalled()
    expect(isAuthRetryableFetchError(error)).toBe(true)
    expect(refreshFailureKeepsSession(error)).toBe(true)
    // Before LIFT-1549: true, and the banner offered a sign-out.
    expect(authNeedsReauth.value).toBe(false)
    expect(sessionRecoveryTick.value).toBe(0)
    // auth-js kept it too, for its auto-refresh to try again.
    expect(JSON.parse(localStorage.getItem(KEY)!).refresh_token).toBe('refresh-token-1')
  })

  it('keeps the session when the auth server answers with a 5xx', async () => {
    storeSession(3000)
    server = () => json(503, { message: 'upstream connect error' })
    const { error } = await refreshAfterA401(startClient())

    expect(isAuthRetryableFetchError(error)).toBe(true)
    expect(refreshFailureKeepsSession(error)).toBe(true)
    expect(authNeedsReauth.value).toBe(false)
  })

  // The path the issue was filed from: the network is back, but for 60 s after
  // a failed refresh auth-js answers every refresh of that token with the
  // cached failure. A write sent under the anon key meanwhile comes back 401.
  it('keeps the session through auth-js\'s cooldown, and recovers once it has passed', async () => {
    storeSession(3000)
    const c = startClient()
    await refreshAfterA401(c)

    server = refreshed
    fetchMock.mockClear()
    const inCooldown = await refreshAfterA401(c)

    expect(inCooldown.ok).toBe(false)
    // The cooldown answered, not the network.
    expect(fetchMock).not.toHaveBeenCalled()
    expect(isAuthRetryableFetchError(inCooldown.error)).toBe(true)
    expect(authNeedsReauth.value).toBe(false)

    const after = await refreshAfterA401(c)

    expect(after.ok).toBe(true)
    expect(sessionRecoveryTick.value).toBe(1)
    expect(authNeedsReauth.value).toBe(false)
  })

  // The refresh worked; another tab's rotation simply landed in storage first.
  it('keeps the session when auth-js discards a refresh another tab beat', async () => {
    storeSession(3000)
    server = () => {
      storeSession(3600, 'refresh-token-from-another-tab')
      return refreshed()
    }
    const { error } = await refreshAfterA401(startClient())

    expect(isAuthRefreshDiscardedError(error)).toBe(true)
    expect(refreshFailureKeepsSession(error)).toBe(true)
    expect(authNeedsReauth.value).toBe(false)
  })

  // The case the banner exists for, which must survive the fix.
  it('asks for a re-sign-in when the auth server refuses the refresh token', async () => {
    storeSession(3000)
    server = () => json(400, {
      code: 400,
      error_code: 'refresh_token_not_found',
      msg: 'Invalid Refresh Token: Refresh Token Not Found',
    })
    const { ok, error } = await refreshAfterA401(startClient())

    expect(ok).toBe(false)
    expect(isAuthRetryableFetchError(error)).toBe(false)
    expect(refreshFailureKeepsSession(error)).toBe(false)
    expect(authNeedsReauth.value).toBe(true)
  })

  it('asks for a re-sign-in when there is no session on the device to refresh', async () => {
    server = refreshed
    const { error } = await refreshAfterA401(startClient())

    expect(fetchMock).not.toHaveBeenCalled()
    expect((error as { name?: string }).name).toBe('AuthSessionMissingError')
    expect(refreshFailureKeepsSession(error)).toBe(false)
    expect(authNeedsReauth.value).toBe(true)
  })
})
