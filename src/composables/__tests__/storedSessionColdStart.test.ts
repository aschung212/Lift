/**
 * Regression LIFT-1545: an offline cold start more than an hour after the last
 * session showed the sign-in screen to a lifter whose data was all on the
 * device.
 *
 * The access token had expired, so auth-js refreshed it before `getSession()`
 * would answer. Offline, that refresh retried for about 25 s (one browser
 * timeout on a dead uplink), kept the session in storage because the failure
 * was retryable, and answered `session: null`. useAuth read that as signed
 * out: the splash waited out the retries, then AuthScreen appeared, and the
 * auto-refresh signed the user back in only once the network returned.
 *
 * Nothing caught it because `useAuth.test.ts` mocks `getSession()` whole and
 * only ever answered a session, or no session with no error. "No session, a
 * retryable error, and the session still stored" exists only inside auth-js.
 * So these tests build the client the way the app does (`initSupabase()`, the
 * real supabase-js) against a network the test controls, and run
 * `useAuth().init()` on it. The stores are spies, so a test can see whether
 * anything was bound to the account. The network is a fake, so a test can take
 * it away, give it back, or revoke the session. auth-js's own behaviour is
 * pinned separately in `lib/__tests__/storedSession.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// The global setup replaces the client module with `{ supabase: null }`; these
// tests need the real one.
vi.unmock('../../lib/supabase')

// useTheme reads it, and useAuth imports it transitively.
vi.stubGlobal('matchMedia', vi.fn(() => ({
  matches: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})))

const { stores, migrate, queue, net } = vi.hoisted(() => {
  const storeSpies = () => ({ init: vi.fn(async () => {}), $reset: vi.fn(), holdUntilRead: vi.fn() })
  return {
    stores: {
      workout: storeSpies(),
      bodyweight: storeSpies(),
      preferences: storeSpies(),
      progression: storeSpies(),
    },
    migrate: vi.fn(async () => {}),
    queue: { clear: vi.fn(), rehydrate: vi.fn(async () => {}) },
    /** What the auth server does with a refresh: nothing reaches it, it answers, or it refuses the token. */
    net: { mode: 'offline' as 'offline' | 'online' | 'revoked', delayMs: 0 },
  }
})

vi.mock('../../stores/workout', () => ({ useWorkoutStore: () => stores.workout }))
vi.mock('../../stores/bodyweight', () => ({ useBodyweightStore: () => stores.bodyweight }))
vi.mock('../../stores/preferences', () => ({ usePreferencesStore: () => stores.preferences }))
vi.mock('../../stores/progression', () => ({ useProgressionStore: () => stores.progression }))
vi.mock('../../lib/migrate', () => ({
  migrateLocalStorageToSupabase: (userId: string) => migrate(userId),
}))
vi.mock('../../lib/syncQueue', () => ({ syncQueue: queue }))
vi.mock('../../lib/logger', () => ({ logError: vi.fn(), logWarn: vi.fn(), logInfo: vi.fn() }))

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

// supabase-js reads the global fetch when it makes the request, and the only
// requests here are auth-js's token refreshes.
vi.stubGlobal('fetch', vi.fn(async () => {
  if (net.delayMs) await new Promise(resolve => setTimeout(resolve, net.delayMs))
  if (net.mode === 'offline') throw new TypeError('Failed to fetch')
  if (net.mode === 'revoked') {
    return json(400, {
      code: 400,
      error_code: 'refresh_token_not_found',
      msg: 'Invalid Refresh Token: Refresh Token Not Found',
    })
  }
  return json(200, {
    access_token: 'refreshed.access.token',
    token_type: 'bearer',
    expires_in: 3600,
    refresh_token: 'refresh-token-2',
    user: USER,
  })
}))

/** A session as auth-js persists it, whose access token expires `expiresIn` seconds from NOW. */
function storeSession(expiresIn: number): void {
  localStorage.setItem(KEY, JSON.stringify({
    access_token: 'header.payload.signature',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(NOW.getTime() / 1000) + expiresIn,
    refresh_token: 'refresh-token-1',
    user: USER,
  }))
}

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true })
}

type Booted = Awaited<ReturnType<typeof boot>>
let booted: Booted | null = null

/**
 * App.vue's start-up: `initSupabase().then(() => initAuth())`. `beforeInit`
 * gets the client between the two, for a test that needs to break it.
 */
async function boot(beforeInit?: (client: SupabaseClient) => void) {
  vi.resetModules()
  const supabaseModule = await import('../../lib/supabase')
  await supabaseModule.initSupabase()
  beforeInit?.(supabaseModule.supabase!)
  const { useAuth, STORED_SESSION_GRACE_MS } = await import('../useAuth')
  const { sessionAwaitingRefresh } = await import('../../lib/sessionHealth')
  const auth = useAuth()
  auth.init()
  booted = { auth, client: supabaseModule.supabase!, sessionAwaitingRefresh, grace: STORED_SESSION_GRACE_MS }
  return booted
}

const userId = (): string | undefined => (booted?.auth.user.value as { id?: string } | null)?.id

beforeEach(() => {
  vi.useFakeTimers({ now: NOW })
  vi.stubEnv('DEV', false)
  vi.stubEnv('VITE_SUPABASE_URL', PROJECT_URL)
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key-for-tests')
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  setOnline(true)
  net.mode = 'offline'
  net.delayMs = 0
})

afterEach(async () => {
  booted?.auth.destroy()
  await booted?.client.auth.dispose()
  booted = null
  vi.useRealTimers()
  vi.unstubAllEnvs()
  setOnline(true)
})

describe('an offline cold start with an expired access token (LIFT-1545)', () => {
  it('keeps the stored user signed in instead of showing the sign-in screen', async () => {
    storeSession(-7200)
    const { auth, sessionAwaitingRefresh, grace } = await boot()
    expect(auth.loading.value).toBe(true)

    // The splash waits the grace period, not auth-js's retries.
    await vi.advanceTimersByTimeAsync(grace)
    expect(auth.user.value).toEqual({ id: 'user-1', email: 'lifter@example.com' })
    expect(auth.loading.value).toBe(false)
    expect(sessionAwaitingRefresh.value).toBe(true)

    // auth-js gives up on the refresh and answers getSession() with no
    // session. Before the fix this is where the user was signed out.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(auth.user.value).toEqual({ id: 'user-1', email: 'lifter@example.com' })
    expect(auth.isGuest.value).toBe(false)
    expect(sessionAwaitingRefresh.value).toBe(true)
  })

  it('binds nothing to the account until a refresh gets through', async () => {
    storeSession(-7200)
    await boot()
    await vi.advanceTimersByTimeAsync(60_000)

    // With no usable token every request would go out under the anon key,
    // and RLS answers an anon read with empty rows, not an error.
    expect(migrate).not.toHaveBeenCalled()
    for (const store of Object.values(stores)) expect(store.init).not.toHaveBeenCalled()
    // Edits made meanwhile are held for the read that follows the refresh.
    expect(stores.preferences.holdUntilRead).toHaveBeenCalledWith('user-1')
    expect(stores.progression.holdUntilRead).toHaveBeenCalledWith('user-1')
  })

  it('binds the stores once a refresh gets through', async () => {
    storeSession(-7200)
    const { sessionAwaitingRefresh } = await boot()
    await vi.advanceTimersByTimeAsync(60_000)

    net.mode = 'online'
    // The auto-refresh ticker runs every 30 s, after auth-js's 60 s cooldown
    // on a token whose refresh just failed.
    await vi.advanceTimersByTimeAsync(120_000)

    expect(sessionAwaitingRefresh.value).toBe(false)
    expect(userId()).toBe('user-1')
    expect(migrate).toHaveBeenCalledWith('user-1')
    for (const store of Object.values(stores)) expect(store.init).toHaveBeenCalledWith('user-1')
  })

  it('shows the app at once when the browser knows it is offline', async () => {
    setOnline(false)
    storeSession(-7200)
    const { auth } = await boot()

    await vi.advanceTimersByTimeAsync(0)

    expect(userId()).toBe('user-1')
    expect(auth.loading.value).toBe(false)
  })

  // getSession() rejecting is auth-js failing in a way it does not report as
  // an error result; that answer is final, as it was before.
  it('drops a user restored at the grace period when getSession() then fails outright', async () => {
    storeSession(-7200)
    const { auth, sessionAwaitingRefresh, grace } = await boot((client) => {
      vi.spyOn(client.auth, 'getSession').mockImplementation(() => new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error('storage unavailable')), 5000)
      }))
    })
    await vi.advanceTimersByTimeAsync(grace)
    expect(userId()).toBe('user-1')

    await vi.advanceTimersByTimeAsync(5000)

    expect(auth.user.value).toBeNull()
    expect(sessionAwaitingRefresh.value).toBe(false)
    expect(auth.loading.value).toBe(false)
  })

  it('restores nothing once the auth module is torn down', async () => {
    storeSession(-7200)
    const { auth, grace } = await boot()

    auth.destroy()
    await vi.advanceTimersByTimeAsync(grace)

    expect(auth.user.value).toBeNull()
    expect(stores.preferences.holdUntilRead).not.toHaveBeenCalled()
  })

  it('leaves a session auth-js can answer from storage to the normal path', async () => {
    setOnline(false)
    storeSession(3000)
    const { auth, sessionAwaitingRefresh } = await boot()

    await vi.advanceTimersByTimeAsync(0)

    expect(sessionAwaitingRefresh.value).toBe(false)
    expect(stores.preferences.holdUntilRead).not.toHaveBeenCalled()
    expect(stores.workout.init).toHaveBeenCalledWith('user-1')
    expect(auth.loading.value).toBe(false)
  })
})

describe('a stored session that turns out to be revoked (LIFT-1545)', () => {
  it('goes straight to sign-in on a working connection, without showing the app first', async () => {
    net.mode = 'revoked'
    storeSession(-7200)
    const { auth, grace } = await boot()

    await vi.advanceTimersByTimeAsync(grace * 2)

    expect(auth.user.value).toBeNull()
    expect(auth.loading.value).toBe(false)
    // Never restored, not even for a moment.
    expect(stores.preferences.holdUntilRead).not.toHaveBeenCalled()
  })

  it('drops a restored user once the refresh is refused, leaving their data on the device', async () => {
    storeSession(-7200)
    const { auth, sessionAwaitingRefresh } = await boot()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(userId()).toBe('user-1')

    net.mode = 'revoked'
    await vi.advanceTimersByTimeAsync(120_000)

    expect(auth.user.value).toBeNull()
    expect(sessionAwaitingRefresh.value).toBe(false)
    // No store was bound to this session, so there is nothing to tear down:
    // the device is left exactly as an offline cold start always left it.
    for (const store of Object.values(stores)) expect(store.$reset).not.toHaveBeenCalled()
    expect(queue.clear).not.toHaveBeenCalled()
  })

  it('drops a user restored at the grace period when a slow refresh is then refused', async () => {
    net.mode = 'revoked'
    net.delayMs = 3000
    storeSession(-7200)
    const { auth, grace } = await boot()
    await vi.advanceTimersByTimeAsync(grace)
    expect(userId()).toBe('user-1')

    await vi.advanceTimersByTimeAsync(5000)

    expect(auth.user.value).toBeNull()
    expect(auth.loading.value).toBe(false)
    for (const store of Object.values(stores)) expect(store.$reset).not.toHaveBeenCalled()
  })
})

describe('signing out while auth-js cannot refresh the session (LIFT-1545)', () => {
  it('signs a restored user out for good, even once the network returns', async () => {
    storeSession(-7200)
    const { auth } = await boot()
    await vi.advanceTimersByTimeAsync(60_000)

    await auth.signOut()
    expect(auth.user.value).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()

    net.mode = 'online'
    await vi.advanceTimersByTimeAsync(120_000)

    expect(auth.user.value).toBeNull()
    expect(migrate).not.toHaveBeenCalled()
  })

  // The same auth-js behaviour reached from an ordinary session: the token
  // expires while the app is open with no signal, then the lifter signs out.
  // auth-js's signOut() gives up on the refresh without removing the session,
  // and before the fix the next refresh signed the user straight back in.
  it('signs out of a session whose token expired offline, for good', async () => {
    storeSession(3000)
    const { auth } = await boot()
    await vi.advanceTimersByTimeAsync(0)
    expect(migrate).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(2 * 3600_000)
    const signedOut = auth.signOut()
    await vi.advanceTimersByTimeAsync(60_000)
    await signedOut
    expect(localStorage.getItem(KEY)).toBeNull()

    net.mode = 'online'
    await vi.advanceTimersByTimeAsync(120_000)

    expect(auth.user.value).toBeNull()
    expect(migrate).toHaveBeenCalledTimes(1)
  })
})
