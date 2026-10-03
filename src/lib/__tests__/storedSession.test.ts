/**
 * The session auth-js stores on this device, read without asking auth-js
 * (LIFT-1545).
 *
 * An offline cold start more than an hour after the last session showed the
 * sign-in screen. auth-js can't answer `getSession()` for an expired access
 * token until it has refreshed it; offline that refresh fails, and auth-js
 * answers `session: null` while keeping the session in storage. useAuth now
 * reads the user back out of that slot and keeps them signed in until a
 * refresh gets through.
 *
 * Nothing caught the original because `useAuth.test.ts` mocks `getSession()`
 * whole: it answered either a session or `{ session: null }` with no error,
 * which is the shape of a device that was never signed in. The third shape,
 * no session plus a retryable error with the session still stored, only exists
 * inside auth-js. So the contract half of this file runs the REAL supabase-js
 * client against a network that fails, and pins the behaviour the fix is built
 * on: what `getSession()` answers, what stays in storage, what `signOut()`
 * leaves behind, and which event reports the refresh once it succeeds.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { authStorageKey, readStoredSession, clearStoredSession } from '../storedSession'

const PROJECT_URL = 'https://abcdefghijklmnop.supabase.co'
const KEY = 'sb-abcdefghijklmnop-auth-token'
// Not an `sb_…` key, so supabase-js doesn't warn about the format.
const ANON_KEY = 'anon-key-for-tests'
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

/** A session as auth-js persists it, whose access token expires `expiresIn` seconds from NOW. */
function sessionBlob(expiresIn: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    access_token: 'header.payload.signature',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(NOW.getTime() / 1000) + expiresIn,
    refresh_token: 'refresh-token-1',
    user: USER,
    ...overrides,
  }
}

function store(blob: unknown): void {
  localStorage.setItem(KEY, typeof blob === 'string' ? blob : JSON.stringify(blob))
}

describe('authStorageKey', () => {
  // supabase-js picks the key itself when none is given. initSupabase now
  // passes one, so it must be the very key supabase-js would have picked, or
  // every session persisted before this change is lost and its user signed
  // out on update. Asked of the real SDK rather than restated, so a release
  // that changes the default fails here instead of in production.
  it.each([
    PROJECT_URL,
    `${PROJECT_URL}/`,
    'https://api.example.com',
    'http://127.0.0.1:54321',
    'http://localhost:54321',
  ])('matches the key supabase-js derives on its own for %s', async (url) => {
    const client = createClient(url, ANON_KEY)
    try {
      const sdkDefault = (client as unknown as { storageKey: string }).storageKey
      expect(sdkDefault).toMatch(/^sb-.+-auth-token$/)
      expect(authStorageKey(url)).toBe(sdkDefault)
    } finally {
      await client.auth.dispose()
    }
  })

  it('has no key for a URL that does not parse', () => {
    expect(authStorageKey('not a url')).toBeNull()
  })
})

describe('readStoredSession', () => {
  it('reads the user and the access token expiry', () => {
    store(sessionBlob(-7200))

    expect(readStoredSession(KEY)).toEqual({
      user: { id: 'user-1', email: 'lifter@example.com' },
      expiresAt: NOW.getTime() - 7200 * 1000,
    })
  })

  it('reads nothing without a key (Supabase not configured)', () => {
    store(sessionBlob(-7200))
    expect(readStoredSession(null)).toBeNull()
  })

  it('reads nothing when nothing is stored', () => {
    expect(readStoredSession(KEY)).toBeNull()
  })

  // Each of these is a blob auth-js itself would not load (it needs an access
  // token, a refresh token and an expiry), or one with no user to show.
  it.each([
    ['corrupt JSON', '{"access_token":'],
    ['an array', '[]'],
    ['no refresh token', sessionBlob(-7200, { refresh_token: undefined })],
    ['an empty refresh token', sessionBlob(-7200, { refresh_token: '' })],
    ['no access token', sessionBlob(-7200, { access_token: undefined })],
    ['no expiry', sessionBlob(-7200, { expires_at: undefined })],
    ['a non-numeric expiry', sessionBlob(-7200, { expires_at: 'soon' })],
    ['no user', sessionBlob(-7200, { user: undefined })],
    ['a user with no id', sessionBlob(-7200, { user: { email: 'lifter@example.com' } })],
    ['a user with an empty id', sessionBlob(-7200, { user: { ...USER, id: '' } })],
  ])('reads nothing from %s', (_name, blob) => {
    store(blob)
    expect(readStoredSession(KEY)).toBeNull()
  })

  it('reads a user with no email as an empty email', () => {
    store(sessionBlob(-7200, { user: { ...USER, email: undefined } }))
    expect(readStoredSession(KEY)?.user).toEqual({ id: 'user-1', email: '' })
  })
})

describe('clearStoredSession', () => {
  it('removes the session and the split-out user slot', () => {
    store(sessionBlob(-7200))
    localStorage.setItem(`${KEY}-user`, JSON.stringify({ user: USER }))

    clearStoredSession(KEY)

    expect(localStorage.getItem(KEY)).toBeNull()
    expect(localStorage.getItem(`${KEY}-user`)).toBeNull()
  })

  it('leaves everything alone without a key', () => {
    store(sessionBlob(-7200))
    clearStoredSession(null)
    expect(readStoredSession(KEY)).not.toBeNull()
  })
})

describe('auth-js with an expired session and a network that fails (the contract LIFT-1545 relies on)', () => {
  let client: SupabaseClient | null = null
  let online = false

  // The refresh endpoint (the only request auth-js makes here), answering
  // once `online` is set.
  const fetchMock = vi.fn(async (): Promise<Response> => {
    if (!online) throw new TypeError('Failed to fetch')
    return new Response(JSON.stringify({
      access_token: 'refreshed.access.token',
      token_type: 'bearer',
      expires_in: 3600,
      refresh_token: 'refresh-token-2',
      user: USER,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })

  /** The client initSupabase builds, against the failing network. */
  function startClient(): SupabaseClient {
    client = createClient(PROJECT_URL, ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
        storageKey: KEY,
      },
      global: { fetch: fetchMock },
    })
    return client
  }

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW })
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    online = false
    fetchMock.mockClear()
  })

  afterEach(async () => {
    await client?.auth.dispose()
    client = null
    vi.useRealTimers()
  })

  it('answers getSession() with no session and a retryable error, and keeps the session stored', async () => {
    store(sessionBlob(-7200))
    const answer = startClient().auth.getSession()
    // auth-js retries the refresh for ~25 s (200 ms doubling) before giving up.
    await vi.advanceTimersByTimeAsync(60_000)
    const { data, error } = await answer

    expect(fetchMock).toHaveBeenCalled()
    expect(data.session).toBeNull()
    expect(error?.name).toBe('AuthRetryableFetchError')
    // The same `session: null` a never-signed-in device gets, but the user is
    // still on the device, where the next refresh will look for them.
    expect(readStoredSession(KEY)?.user).toEqual({ id: 'user-1', email: 'lifter@example.com' })
  })

  it('answers a still-valid session from storage, without the network', async () => {
    store(sessionBlob(3000))
    const { data, error } = await startClient().auth.getSession()

    expect(error).toBeNull()
    expect(data.session?.user.id).toBe('user-1')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // Why useAuth.signOut() clears the slot itself: auth-js's sign-out loads the
  // session first, which means refreshing it, and gives up on the retryable
  // failure without removing anything.
  it('signs out WITHOUT removing a session it cannot refresh first', async () => {
    store(sessionBlob(-7200))
    const answer = startClient().auth.signOut()
    await vi.advanceTimersByTimeAsync(60_000)
    const { error } = await answer

    expect(error?.name).toBe('AuthRetryableFetchError')
    expect(readStoredSession(KEY)).not.toBeNull()
  })

  it('treats a session removed from storage as signed out', async () => {
    store(sessionBlob(-7200))
    const auth = startClient().auth
    const first = auth.getSession()
    await vi.advanceTimersByTimeAsync(60_000)
    await first

    clearStoredSession(KEY)
    online = true
    const refreshesBefore = fetchMock.mock.calls.length
    const { data, error } = await auth.getSession()

    expect(data.session).toBeNull()
    expect(error).toBeNull()
    // And nothing brings it back once the network returns: the ticker finds
    // no session to refresh.
    await vi.advanceTimersByTimeAsync(180_000)
    expect(fetchMock).toHaveBeenCalledTimes(refreshesBefore)
    expect(readStoredSession(KEY)).toBeNull()
  })

  // The signal useAuth binds the stores on.
  it('reports the session through TOKEN_REFRESHED once a refresh gets through', async () => {
    store(sessionBlob(-7200))
    const auth = startClient().auth
    const events: Array<[string, string | undefined]> = []
    auth.onAuthStateChange((event, session) => { events.push([event, session?.user.id]) })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(events).not.toContainEqual(['TOKEN_REFRESHED', 'user-1'])

    online = true
    // The auto-refresh ticker runs every 30 s, and auth-js waits out a 60 s
    // cooldown after a failed refresh before it tries the same token again.
    await vi.advanceTimersByTimeAsync(120_000)

    expect(events).toContainEqual(['TOKEN_REFRESHED', 'user-1'])
    expect(JSON.parse(localStorage.getItem(KEY)!).refresh_token).toBe('refresh-token-2')
  })
})
