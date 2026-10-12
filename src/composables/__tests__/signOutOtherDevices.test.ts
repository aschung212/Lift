/**
 * Regression LIFT-1541: Sign Out on one device signed the account out on
 * every device.
 *
 * useAuth.signOut() called auth-js's signOut() with no options, and auth-js
 * defaults to `scope: 'global'`: the auth server revokes every refresh token
 * the account holds, not just this device's. Every other signed-in browser,
 * installed PWA and iPhone was signed out at its next token refresh, within the
 * hour (jwt_expiry is 3600). One that was open at that moment saw SIGNED_OUT
 * and ran the LIFT-1133 teardown, which resets its stores and clears its sync
 * journal, so a gym session it had not pushed yet was lost. Settings only asks
 * "Sign out?", which reads as this device, and the "Session expired" banner's
 * "Sign in" button runs the same sign-out.
 *
 * Nothing caught it because the scope only shows on a device the test does not
 * own. `useAuth.test.ts` mocks `signOut()` whole, the real-client suites never
 * modelled what `/logout` does with its scope, and no fixture ever signed the
 * account in twice. So here the app's client is the real one
 * (`initSupabase()`), the lifter's phone is a second real client with storage
 * of its own, and both talk to a fake auth server that keeps one session per
 * sign-in and ends sessions the way the real one does: `local` ends the
 * caller's session, `global` every session on the account, and deleting the
 * user ends all of them, because `auth.sessions` references `auth.users` ON
 * DELETE CASCADE (and each refresh token references its session the same way).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// The global setup replaces the client module with `{ supabase: null }`; these
// tests need the real one.
vi.unmock('../../lib/supabase')

// useTheme reads it, and useAuth imports it transitively.
vi.stubGlobal('matchMedia', vi.fn(() => ({
  matches: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})))

const { stores, server } = vi.hoisted(() => {
  const storeSpies = () => ({
    bindUser: vi.fn(),
    _fetchFromSupabase: vi.fn(async () => {}),
    $reset: vi.fn(),
    holdUntilRead: vi.fn(),
    exercises: [],
    entries: [],
  })
  return {
    stores: {
      workout: storeSpies(),
      bodyweight: storeSpies(),
      preferences: storeSpies(),
      progression: storeSpies(),
    },
    server: {
      /** auth.sessions: one per sign-in, with the tokens it last issued. */
      sessions: [] as Array<{ userId: string; accessToken: string; refreshToken: string; ended: boolean }>,
      /** The scope of every sign-out that reached the auth server. */
      logouts: [] as string[],
      tokensIssued: 0,
    },
  }
})

vi.mock('../../stores/workout', () => ({ useWorkoutStore: () => stores.workout }))
vi.mock('../../stores/bodyweight', () => ({ useBodyweightStore: () => stores.bodyweight }))
vi.mock('../../stores/preferences', () => ({ usePreferencesStore: () => stores.preferences }))
vi.mock('../../stores/progression', () => ({ useProgressionStore: () => stores.progression }))
vi.mock('../../lib/migrate', () => ({ migrateLocalStorageToSupabase: vi.fn(async () => {}) }))
vi.mock('../../lib/syncQueue', () => ({
  syncQueue: { clear: vi.fn(), rehydrate: vi.fn(async () => {}), flush: vi.fn(async () => {}) },
}))
vi.mock('../../lib/logger', () => ({ logError: vi.fn(), logWarn: vi.fn(), logInfo: vi.fn() }))

const PROJECT_URL = 'https://abcdefghijklmnop.supabase.co'
const KEY = 'sb-abcdefghijklmnop-auth-token'
// Not an `sb_…` key, so supabase-js doesn't warn about the format.
const ANON_KEY = 'anon-key-for-tests'
const NOW = new Date('2026-10-05T12:00:00.000Z')
const LIFTER = { id: 'user-1', email: 'lifter@example.com' }

type ServerSession = (typeof server.sessions)[number]

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** New tokens for `session`, as the auth server answers a sign-in or a refresh. */
function issueTokens(session: ServerSession) {
  const n = ++server.tokensIssued
  session.accessToken = `access-${n}.payload.signature`
  session.refreshToken = `refresh-${n}`
  return {
    access_token: session.accessToken,
    token_type: 'bearer',
    expires_in: 3600,
    refresh_token: session.refreshToken,
    user: {
      ...LIFTER,
      aud: 'authenticated',
      role: 'authenticated',
      app_metadata: { provider: 'email' },
      user_metadata: {},
      created_at: '2026-01-01T00:00:00.000Z',
    },
  }
}

/** A sign-in on some device: a new session on the account, its others untouched. */
function signIn() {
  const session: ServerSession = { userId: LIFTER.id, accessToken: '', refreshToken: '', ended: false }
  server.sessions.push(session)
  return issueTokens(session)
}

function liveSession(match: (s: ServerSession) => boolean): ServerSession | undefined {
  return server.sessions.find(s => !s.ended && match(s))
}

vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
  const authorization = new Headers(init?.headers).get('Authorization')
  const caller = liveSession(s => authorization === `Bearer ${s.accessToken}`)

  if (url.pathname === '/auth/v1/token') {
    if (url.searchParams.get('grant_type') === 'password') return json(200, signIn())
    const session = liveSession(s => s.refreshToken === body.refresh_token)
    if (!session) {
      return json(400, {
        code: 400,
        error_code: 'refresh_token_not_found',
        msg: 'Invalid Refresh Token: Refresh Token Not Found',
      })
    }
    return json(200, issueTokens(session))
  }
  if (url.pathname === '/auth/v1/logout') {
    if (!caller) {
      return json(403, {
        code: 403,
        error_code: 'session_not_found',
        msg: 'Session from session_id claim in JWT does not exist',
      })
    }
    const scope = url.searchParams.get('scope') ?? 'global'
    server.logouts.push(scope)
    const ends = (s: ServerSession): boolean =>
      scope === 'global' || (scope === 'local' ? s === caller : s !== caller)
    for (const s of server.sessions) if (s.userId === caller.userId && ends(s)) s.ended = true
    return new Response(null, { status: 204 })
  }
  if (url.pathname === '/rest/v1/rpc/delete_user_account') {
    if (!caller) return json(401, { code: 'PGRST301', message: 'JWT expired' })
    // Deleting the auth user takes every session it has with it.
    for (const s of server.sessions) if (s.userId === caller.userId) s.ended = true
    return new Response(null, { status: 204 })
  }
  // Delete Account's per-table deletes and delete_coach_data.
  if (url.pathname.startsWith('/rest/v1/')) return new Response(null, { status: 204 })
  return json(404, { msg: `no fake for ${url.pathname}` })
}))

type Booted = Awaited<ReturnType<typeof bootSignedIn>>
let booted: Booted | null = null
const otherClients: SupabaseClient[] = []

/**
 * This device, signed in: the session auth-js persisted at sign-in, then
 * App.vue's start-up, `initSupabase().then(() => initAuth())`, on a fresh
 * module graph.
 */
async function bootSignedIn() {
  const tokens = signIn()
  localStorage.setItem(KEY, JSON.stringify({
    ...tokens,
    expires_at: Math.floor(Date.now() / 1000) + tokens.expires_in,
  }))
  vi.resetModules()
  const supabaseModule = await import('../../lib/supabase')
  await supabaseModule.initSupabase()
  const { useAuth } = await import('../useAuth')
  const auth = useAuth()
  auth.init()
  booted = { auth, client: supabaseModule.supabase!, refreshToken: tokens.refresh_token }
  await vi.advanceTimersByTimeAsync(0)
  expect(auth.user.value?.id).toBe(LIFTER.id)
  return booted
}

/** A real client somewhere other than this device, with storage of its own. */
function anotherClient(): SupabaseClient {
  const client = createClient(PROJECT_URL, ANON_KEY, {
    auth: {
      storageKey: `other-${otherClients.length}-auth-token`,
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
  otherClients.push(client)
  return client
}

/** The lifter's phone, signed in to the same account. */
async function signInOnPhone() {
  const phone = anotherClient()
  const events: string[] = []
  phone.auth.onAuthStateChange((event) => { events.push(event) })
  const { error } = await phone.auth.signInWithPassword({ email: LIFTER.email, password: 'correct horse' })
  expect(error).toBeNull()
  return {
    events,
    /** The phone's session once its access token has expired and it has asked the server for a new one. */
    async afterNextRefresh() {
      await vi.advanceTimersByTimeAsync(2 * 3600_000)
      const answer = phone.auth.getSession()
      await vi.advanceTimersByTimeAsync(0)
      return (await answer).data.session
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW })
  vi.stubEnv('DEV', false)
  vi.stubEnv('VITE_SUPABASE_URL', PROJECT_URL)
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', ANON_KEY)
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  server.sessions.length = 0
  server.logouts.length = 0
})

afterEach(async () => {
  booted?.auth.destroy()
  await booted?.client.auth.dispose()
  booted = null
  for (const client of otherClients.splice(0)) await client.auth.dispose()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('Sign Out (LIFT-1541)', () => {
  it("signs out this device and leaves the lifter's other devices signed in", async () => {
    const { auth } = await bootSignedIn()
    const phone = await signInOnPhone()

    await auth.signOut()

    expect(auth.user.value).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
    // The server was asked to end this device's session, not the account's.
    expect(server.logouts).toEqual(['local'])
    // The phone refreshes its token as it does every hour, and stays signed in.
    expect((await phone.afterNextRefresh())?.user.id).toBe(LIFTER.id)
    expect(phone.events).toContain('TOKEN_REFRESHED')
    expect(phone.events).not.toContain('SIGNED_OUT')
  })

  // What the fix must keep: the server still ends this device's session, so
  // the refresh token it held is no use to anything holding a copy of it.
  it("ends this device's session on the server, not only on the device", async () => {
    const { auth, refreshToken } = await bootSignedIn()

    await auth.signOut()

    const { data, error } = await anotherClient().auth.refreshSession({ refresh_token: refreshToken })
    expect(data.session).toBeNull()
    expect(error?.code).toBe('refresh_token_not_found')
  })
})

describe('Delete Account (LIFT-1541)', () => {
  // Why the sign-out it ends with can be local: the deletion itself ends every
  // session the account has.
  it('still signs the lifter out on every device', async () => {
    const { auth } = await bootSignedIn()
    const phone = await signInOnPhone()

    await auth.deleteAccount()

    expect(auth.user.value).toBeNull()
    expect(await phone.afterNextRefresh()).toBeNull()
    expect(phone.events).toContain('SIGNED_OUT')
  })
})
