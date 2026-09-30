/**
 * Regression: a whole-row store's read is never answered from the service
 * worker's cache (LIFT-1510).
 *
 * The SW sits between every Supabase read and the network. Its catch-all route
 * served `user_preferences` NetworkFirst (24 h) and a rule of its own served
 * `user_progression` NetworkFirst (6 h), so on any launch that was offline, or
 * slower than the 3-second network timeout, both reads resolved with the row
 * from the last good launch and `error: null` — indistinguishable from the
 * server's current row. Both stores adopt their row remote-wins:
 *
 *  - preferences reverted every setting changed since that launch and
 *    re-persisted the revert, and the next settings change pushed the whole
 *    blob, revert included, over the account's;
 *  - progression adopted the stale staged goal and visibility and
 *    `_syncToSupabase` pushed them straight back over the account's row.
 *
 * Without the SW the same read fails and local state, which is newer, stands.
 *
 * Why nothing caught it: no test ever put the service worker between a store
 * and the network. Store tests hand the store a Supabase double directly, and
 * `workboxCacheRegression.test.ts` asserted on the TEXT of vite.config.js,
 * pinning the `supabase-api` catch-all cache as a feature. So these tests run
 * the REAL supabase-js client through a model of the SW that reads the same
 * `RUNTIME_CACHING` the build ships, against a small PostgREST fake, with the
 * real stores and the real sync queue, and assert on the account's row. Each
 * case has a control that repeats the steps under the pre-fix routes, proving
 * the harness can see the revert it guards against.
 */
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { RouteRule } from '../../__tests__/serviceWorkerModel'

// ── A PostgREST server behind a connection the test controls ──────────
const { harness } = vi.hoisted(() => {
  type Row = Record<string, unknown>
  // JSON, not structuredClone: a request body is JSON on the wire, and the
  // preferences payload carries Vue reactive proxies structuredClone refuses.
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const harness = {
    /** The route table the SW model reads: the shipped one, or a control. */
    routes: [] as unknown[],
    /** No connection: every request the page or the SW makes fails. */
    offline: false,
    /** How long every request takes to answer, in ms. */
    latencyMs: 0,
    rows: new Map<string, Map<string, Row>>(),
    /** Every GET that reached the server, exactly as the client built it. */
    reads: [] as string[],
    sw: null as { cachedUrls: () => string[]; clear: () => void } | null,
    reset() {
      this.routes = []
      this.offline = false
      this.latencyMs = 0
      this.rows = new Map()
      this.reads = []
    },
    table(name: string): Map<string, Row> {
      if (!this.rows.has(name)) this.rows.set(name, new Map())
      return this.rows.get(name)!
    },
    seed(name: string, row: Row) {
      this.table(name).set(String(row.user_id), clone(row))
    },
    row(name: string, userId = 'u1'): Row | undefined {
      return this.table(name).get(userId)
    },
    /** What `fetch` reaches: `eq` filters, a `select` list, `.single()` via Accept, upserts. */
    async network(url: string, init: RequestInit): Promise<Response> {
      if (this.latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, this.latencyMs))
      if (this.offline) throw new TypeError('Failed to fetch')
      const target = new URL(url)
      const rows = this.table(target.pathname.replace(/^\/rest\/v1\//, ''))
      if ((init.method ?? 'GET').toUpperCase() === 'POST') {
        // ON CONFLICT (on_conflict, else the primary key — `user_id` for
        // user_progression) DO UPDATE: the payload's columns replace the row's.
        const conflict = target.searchParams.get('on_conflict') ?? 'user_id'
        const payload = JSON.parse(String(init.body)) as Row | Row[]
        for (const row of Array.isArray(payload) ? payload : [payload]) {
          const key = String(row[conflict])
          rows.set(key, { ...(rows.get(key) ?? {}), ...row })
        }
        return new Response(null, { status: 201 })
      }
      this.reads.push(url)
      const filters = [...target.searchParams].filter(([, v]) => v.startsWith('eq.'))
      const found = [...rows.values()].filter(r => filters.every(([k, v]) => String(r[k]) === v.slice(3)))
      const select = target.searchParams.get('select') ?? '*'
      const project = (r: Row) => (select === '*' ? r : Object.fromEntries(select.split(',').map(c => [c, r[c]])))
      if ((new Headers(init.headers).get('Accept') ?? '').includes('vnd.pgrst.object')) {
        if (found.length !== 1) {
          return json(406, {
            code: 'PGRST116',
            message: 'JSON object requested, multiple (or no) rows returned',
            details: `The result contains ${found.length} rows`,
            hint: null,
          })
        }
        return json(200, project(found[0]))
      }
      return json(200, found.map(project))
    },
  }
  return { harness }
})

vi.mock('../../lib/supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  const { createServiceWorkerFetch } = await import('../../__tests__/serviceWorkerModel')
  const sw = createServiceWorkerFetch({
    rules: () => harness.routes as RouteRule[],
    network: (url, init) => harness.network(url, init),
  })
  harness.sw = sw
  return {
    // The real client, so the URLs, headers, GET retries and error envelopes
    // are postgrest-js's own. `accessToken` stands in for a signed-in session
    // without starting the auth client.
    supabase: createClient('https://lifttest.supabase.co', 'test-anon-key', {
      accessToken: async () => 'test-access-token',
      global: { fetch: sw.fetch },
    }),
    isPreviewMode: { value: false },
  }
})
vi.mock('../../lib/durableStorage', () => ({
  backupToIDB: vi.fn(),
  restoreFromIDB: vi.fn(async () => null),
  clearIDB: vi.fn(async () => {}),
  closeDB: vi.fn(),
}))
vi.mock('../../lib/crossTabSync', () => ({ broadcastSyncStatus: vi.fn(), broadcastStoreUpdate: vi.fn() }))
vi.mock('../../lib/logger', () => ({ logError: vi.fn(), logWarn: vi.fn(), logInfo: vi.fn() }))

import { syncQueue, _resetRateLimit, _resetCircuitBreaker } from '../../lib/syncQueue'
import { RUNTIME_CACHING } from '../../lib/swRuntimeCaching'
import { resolveWorkboxRoute } from '../../__tests__/serviceWorkerModel'
import { usePreferencesStore } from '../preferences'
import { useProgressionStore } from '../progression'

/**
 * The two rules that answered these reads before LIFT-1510, as the old
 * vite.config.js declared them (minus `expiration`, which the model does not
 * age). The controls run under them.
 */
const PRE_FIX_ROUTES: RouteRule[] = [
  {
    urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/(user_progression|xp_events|progression_snapshots)\b/i,
    handler: 'NetworkFirst',
    options: { cacheName: 'supabase-progression', networkTimeoutSeconds: 3, cacheableResponse: { statuses: [0, 200] } },
  },
  {
    urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/.*/i,
    handler: 'NetworkFirst',
    options: { cacheName: 'supabase-api', networkTimeoutSeconds: 3, cacheableResponse: { statuses: [0, 200] } },
  },
]

/** A bad connection: none at all, or one slower than the old 3-second timeout. */
const BAD_CONNECTIONS = [
  ['offline', 'offline'],
  ['slower than the old 3 s timeout', 'slow'],
] as const
type Connection = 'online' | 'offline' | 'slow'

let onLine: MockInstance<() => boolean>

function setConnection(connection: Connection): void {
  harness.offline = connection === 'offline'
  harness.latencyMs = connection === 'slow' ? 5000 : 0
  // A slow uplink is still "online" to the browser; only a dead radio is not.
  onLine.mockReturnValue(connection !== 'offline')
}

/** The connection comes back: the parked queue hears `online` and flushes. */
function reconnect(): void {
  setConnection('online')
  window.dispatchEvent(new Event('online'))
}

/**
 * Advance fake time in 1 s steps until `pending` settles. postgrest-js sleeps
 * 1/2/4 s between GET retries, the SW's timeout and the latency are timers,
 * and the queue debounces: none of it moves unless time does.
 */
async function settle<T>(pending: Promise<T>): Promise<T> {
  let settled = false
  void pending.then(() => { settled = true }, () => { settled = true })
  for (let s = 0; s < 120 && !settled; s++) await vi.advanceTimersByTimeAsync(1000)
  if (!settled) throw new Error('settle: still pending after 120 s of fake time')
  return pending
}

/** Let every queued write reach the server. */
async function drainWrites(): Promise<void> {
  await settle(new Promise<void>((resolve) => setTimeout(resolve, 30_000)))
}

/** A new app launch on the same device: fresh Pinia, same localStorage, same SW caches. */
function relaunch(): void {
  setActivePinia(createPinia())
}

beforeEach(() => {
  vi.useFakeTimers()
  harness.reset()
  harness.sw!.clear()
  localStorage.clear()
  _resetRateLimit()
  _resetCircuitBreaker()
  syncQueue.clear()
  setActivePinia(createPinia())
  onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})

afterEach(() => {
  syncQueue.clear()
  onLine.mockRestore()
  vi.useRealTimers()
})

// ── Preferences ─────────────────────────────────────────────────────

const ACCOUNT_PREFERENCES = {
  features: { workouts: true, calendar: true, weight: true },
  theme: 'water',
  colorMode: 'dark',
  weightUnit: 'kg',
  restTimerEnabled: true,
  restTimerAutoStart: true,
  gyms: ['Home Gym'],
}

function accountPreferences(): Record<string, unknown> {
  return harness.row('user_preferences')!.preferences as Record<string, unknown>
}

/**
 * Launch online, change the theme (it reaches the account), relaunch on a bad
 * connection, flip another setting in that session — the blob is pushed whole
 * — and let the connection recover.
 */
async function changeThemeThenRelaunch(connection: Connection) {
  harness.seed('user_preferences', {
    id: 'prefs-row-1',
    user_id: 'u1',
    preferences: ACCOUNT_PREFERENCES,
    updated_at: '2026-09-01T00:00:00.000Z',
  })
  await settle(usePreferencesStore().init('u1'))
  usePreferencesStore().setTheme('fire')
  await drainWrites()
  expect(accountPreferences().theme).toBe('fire')

  relaunch()
  setConnection(connection)
  const store = usePreferencesStore()
  await settle(store.init('u1'))
  const afterLaunch = { theme: store.theme, foucMirror: localStorage.getItem('app-theme') }

  store.setRestTimer(false)
  reconnect()
  await drainWrites()
  return { afterLaunch, account: accountPreferences() }
}

describe('preferences: a bad-connection launch is never answered with a cached row (LIFT-1510)', () => {
  it.each(BAD_CONNECTIONS)('a relaunch that is %s keeps a theme changed since the last good read, and so does the account', async (_label, connection) => {
    harness.routes = RUNTIME_CACHING
    const { afterLaunch, account } = await changeThemeThenRelaunch(connection)

    expect(afterLaunch).toEqual({ theme: 'fire', foucMirror: 'fire' })
    expect(account).toMatchObject({ theme: 'fire', restTimerEnabled: false, weightUnit: 'kg', gyms: ['Home Gym'] })
  })

  it.each(BAD_CONNECTIONS)('control: under the pre-fix routes a relaunch that is %s reverts it, and the next push hands the revert to the account', async (_label, connection) => {
    harness.routes = PRE_FIX_ROUTES
    const { afterLaunch, account } = await changeThemeThenRelaunch(connection)

    // The SW answered with launch 1's row: the theme reverted on screen and in
    // the key the next cold start paints from, then left with the next push.
    expect(afterLaunch).toEqual({ theme: 'water', foucMirror: 'water' })
    expect(account).toMatchObject({ theme: 'water', restTimerEnabled: false })
  })
})

// ── Progression ─────────────────────────────────────────────────────

const ACCOUNT_PROGRESSION = {
  user_id: 'u1',
  total_xp: 0,
  streak_weeks: 0,
  weekly_target: 3,
  // A goal change staged last week, which the user revises below.
  pending_target_change: 4,
  show_progression: true,
  progression_enabled: true,
  unlocked_themes: [{ id: 'pearl', unlockedAt: '2026-05-01T00:00:00.000Z' }],
  starter_theme: null,
  starter_confirmed: false,
  epoch: 1,
  streak_history: [],
  xp_per_set: {},
  bodyweight_xp_dates: [],
}

/**
 * Launch online, re-stage next week's goal and hide the XP bar (both reach the
 * account), relaunch on a bad connection, then recover the way
 * useSyncRecovery does: queued writes first, then the read.
 */
async function changeGoalThenRelaunch(connection: Connection) {
  harness.seed('user_progression', ACCOUNT_PROGRESSION)
  await settle(useProgressionStore().init('u1'))
  await drainWrites()
  useProgressionStore().setWeeklyTarget(5)
  useProgressionStore().setShowProgression(false)
  await drainWrites()
  expect(harness.row('user_progression')).toMatchObject({ pending_target_change: 5, show_progression: false })

  relaunch()
  setConnection(connection)
  const store = useProgressionStore()
  await settle(store.init('u1'))
  const afterLaunch = { pendingTargetChange: store.pendingTargetChange, showProgression: store.showProgression }

  reconnect()
  await drainWrites()
  await settle(store._fetchFromSupabase())
  await drainWrites()
  return {
    afterLaunch,
    afterRecovery: { pendingTargetChange: store.pendingTargetChange, showProgression: store.showProgression },
    account: harness.row('user_progression'),
  }
}

describe('progression: a bad-connection launch is never answered with a cached row (LIFT-1510)', () => {
  it.each(BAD_CONNECTIONS)('a relaunch that is %s keeps the re-staged goal, and the account keeps it too', async (_label, connection) => {
    harness.routes = RUNTIME_CACHING
    const { afterLaunch, afterRecovery, account } = await changeGoalThenRelaunch(connection)

    expect(afterLaunch).toEqual({ pendingTargetChange: 5, showProgression: false })
    expect(afterRecovery).toEqual({ pendingTargetChange: 5, showProgression: false })
    expect(account).toMatchObject({ pending_target_change: 5, show_progression: false, weekly_target: 3 })
  })

  it.each(BAD_CONNECTIONS)('control: under the pre-fix routes a relaunch that is %s adopts the stale row and pushes it back over the account', async (_label, connection) => {
    harness.routes = PRE_FIX_ROUTES
    const { afterLaunch, account } = await changeGoalThenRelaunch(connection)

    // `_fetchFromSupabase` merged launch 1's cached row remote-wins and
    // `_syncToSupabase` pushed the result: the account lost both changes.
    expect(afterLaunch).toEqual({ pendingTargetChange: 4, showProgression: true })
    expect(account).toMatchObject({ pending_target_change: 4, show_progression: true })
  })
})

// ── The route each read actually takes ─────────────────────────────

describe('the whole-row reads the stores send (LIFT-1510)', () => {
  it('go to the network through a NetworkOnly route and leave nothing in any cache', async () => {
    harness.routes = RUNTIME_CACHING
    harness.seed('user_preferences', { id: 'prefs-row-1', user_id: 'u1', preferences: ACCOUNT_PREFERENCES })
    harness.seed('user_progression', ACCOUNT_PROGRESSION)
    await settle(usePreferencesStore().init('u1'))
    await settle(useProgressionStore().init('u1'))

    // Non-vacuity: both stores really read, through the real client's URLs.
    const reads = harness.reads.filter(url => /\/rest\/v1\/user_(preferences|progression)\b/.test(url))
    expect(reads.map(url => new URL(url).pathname).sort()).toEqual(['/rest/v1/user_preferences', '/rest/v1/user_progression'])
    for (const url of reads) {
      expect(resolveWorkboxRoute(RUNTIME_CACHING, url)?.handler, url).toBe('NetworkOnly')
    }
    expect(harness.sw!.cachedUrls()).toEqual([])
  })
})
