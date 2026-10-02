/**
 * Regression: no store read is ever answered from the service worker's cache
 * (LIFT-1524).
 *
 * The SW sits between every Supabase read and the network, and it used to
 * cache all of them: `exercises` and `bodyweight_entries` NetworkFirst (12 h,
 * 3 s timeout), `sets` StaleWhileRevalidate (7 d). A cached response resolves
 * `{ data, error: null }` exactly like a fresh one, so:
 *
 *  - On a launch that was offline, or slower than 3 s, an exercise or weigh-in
 *    another device had edited came back as the copy this device last read. It
 *    TIED the local copy, a tie is a local win, and the local-wins loop
 *    re-upserted it over the edit.
 *  - Every sets read, online included, got the PREVIOUS read's snapshot. A set
 *    this device logged after it looked missing from the server, so the
 *    reconciliation pass re-pushed this device's copy over another device's
 *    correction; and a set another device logged showed up a launch late.
 *
 * LIFT-1510 assumed these three degraded safely because their merges go row
 * by row. They do not: a merge cannot tell a past state of the server from the
 * present one, and it pushes every row it reads as tied or missing.
 *
 * Why nothing caught it: no test ever put the service worker between a store
 * and the network. Store tests hand the store a Supabase double directly, and
 * `workboxCacheRegression.test.ts` asserted on the TEXT of vite.config.js,
 * pinning each of these caches as a feature. So these tests run the REAL
 * supabase-js client through a model of the SW that reads the same
 * `RUNTIME_CACHING` the build ships, in front of the shared fake's tables served
 * over HTTP (with `serverClock` standing in for the `updated_at` triggers), with
 * the real stores and the real sync queue, and assert on the SERVER's rows.
 * Each case has a control that repeats the steps under the pre-fix routes and
 * reproduces the revert, so the harness demonstrably sees what it guards.
 */
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { RouteRule } from '../../__tests__/serviceWorkerModel'

// ── The server, behind a connection the test controls ─────────────────
const { harness } = await vi.hoisted(async () => {
  const { createFakeSupabase } = await import('../../__tests__/fakeSupabase')
  const { createPostgrestTransport } = await import('../../__tests__/fakePostgrestTransport')
  // The server's now() is the test's (fake) clock, so an edit another device
  // makes later is stamped later, the way `trg_*_updated_at` stamps it.
  const fake = createFakeSupabase({ serverClock: () => new Date().toISOString() })
  const server = createPostgrestTransport(fake)
  const harness = {
    fake,
    /** The route table the SW model reads: the shipped one, or a control. */
    routes: [] as unknown[],
    /** No connection at all: every request fails at once. */
    offline: false,
    /** How long every request takes to answer, in ms. */
    latencyMs: 0,
    /** Every read that reached the server, exactly as the client built it. */
    reads: [] as string[],
    sw: null as { cachedUrls: () => string[]; clear: () => void } | null,
    async network(url: string, init: RequestInit): Promise<Response> {
      if (this.offline) throw new TypeError('Failed to fetch')
      if (this.latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, this.latencyMs))
      if ((init.method ?? 'GET').toUpperCase() === 'GET') this.reads.push(url)
      return server(url, init)
    },
  }
  return { harness }
})

vi.mock('../../lib/supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  const { createServiceWorkerModel } = await import('../../__tests__/serviceWorkerModel')
  const sw = createServiceWorkerModel({
    rules: () => harness.routes as RouteRule[],
    network: (url, init) => harness.network(url, init),
  })
  harness.sw = sw
  return {
    // The real client, so the URLs, headers, GET retries and error envelopes
    // are postgrest-js's own. `accessToken` stands in for a signed-in session
    // without starting the auth client.
    supabase: createClient('https://project.supabase.co', 'test-anon-key', {
      accessToken: async () => 'test-access-token',
      global: { fetch: sw.respond },
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
import { _resetTombstones } from '../../lib/tombstones'
import { epley } from '../../lib/epley'
import { useWorkoutStore } from '../workout'
import { useBodyweightStore } from '../bodyweight'

/**
 * The rules these three reads went through before LIFT-1524, as vite.config.js
 * declared them (minus `expiration`, which the model does not age). The other
 * pre-fix rules never matched these URLs. The controls run under these.
 */
const CACHEABLE = { statuses: [0, 200] }
const PRE_FIX_ROUTES: RouteRule[] = [
  {
    urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/sets\b/i,
    handler: 'StaleWhileRevalidate',
    options: { cacheName: 'supabase-sets', cacheableResponse: CACHEABLE },
  },
  {
    urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/exercises\b/i,
    handler: 'NetworkFirst',
    options: { cacheName: 'supabase-exercises', networkTimeoutSeconds: 3, cacheableResponse: CACHEABLE },
  },
  {
    urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/bodyweight_entries\b/i,
    handler: 'NetworkFirst',
    options: { cacheName: 'supabase-bodyweight', networkTimeoutSeconds: 3, cacheableResponse: CACHEABLE },
  },
]

const USER = 'user-1524'
/** The stamp these rows carried when this device first read them. */
const T0 = '2026-10-01T11:00:00.000Z'
/** The first launch. The fake clock starts here and only moves forward. */
const LAUNCH_1 = '2026-10-01T12:00:00.000Z'

const EXERCISE = {
  id: 'ex-bench', user_id: USER, name: 'Bench Press', tags: ['Push'],
  created_at: T0, updated_at: T0, deleted_at: null,
}

const WEIGH_IN = {
  id: 'bw-1', user_id: USER, date: '2026-09-30T23:59:30.000Z', weight: 180,
  created_at: T0, updated_at: T0, deleted_at: null,
}

/** A bad connection: none at all, or one slower than the old 3 s timeout. */
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

/**
 * Recover the way `useSyncRecovery` does once the connection is back: queued
 * writes reach the server first, then the store reads again.
 */
async function recover(read: () => Promise<void>): Promise<void> {
  reconnect()
  await drainWrites()
  await settle(read())
  await drainWrites()
}

function serverRow(table: string, id: string): Record<string, unknown> {
  const row = harness.fake.tables[table]?.find((r) => r.id === id)
  if (!row) throw new Error(`no ${table} row ${id} on the server`)
  return row
}

/** Another device's edit landing: its upsert, stamped by the trigger with the server's now(). */
async function editElsewhere(table: string, id: string, changes: Record<string, unknown>): Promise<void> {
  await harness.fake.from(table).upsert({ ...serverRow(table, id), ...changes })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(LAUNCH_1))
  harness.fake.reset()
  harness.routes = RUNTIME_CACHING
  harness.offline = false
  harness.latencyMs = 0
  harness.reads = []
  harness.sw!.clear()
  localStorage.clear()
  _resetTombstones()
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

// ── Exercises (NetworkFirst) ─────────────────────────────────────────

/**
 * Read the exercise online, let another device rename it, relaunch on
 * `connection`, then recover.
 */
async function renamedElsewhereThenRelaunch(connection: Connection) {
  harness.fake.seed('exercises', [EXERCISE])
  await settle(useWorkoutStore().init(USER))
  await drainWrites()

  await editElsewhere('exercises', EXERCISE.id, { name: 'Paused Bench Press' })

  relaunch()
  setConnection(connection)
  const store = useWorkoutStore()
  await settle(store.init(USER))
  const shownAfterLaunch = store.exercises[0].name

  await recover(() => store._fetchFromSupabase())
  return {
    shownAfterLaunch,
    shownAfterRecovery: store.exercises[0].name,
    server: serverRow('exercises', EXERCISE.id).name,
  }
}

describe('exercises: a bad-connection launch is never answered with a cached row (LIFT-1524)', () => {
  it.each(BAD_CONNECTIONS)('a relaunch that is %s keeps a rename made on another device, here and on the server', async (_label, connection) => {
    const result = await renamedElsewhereThenRelaunch(connection)

    expect(result.server).toBe('Paused Bench Press')
    expect(result.shownAfterRecovery).toBe('Paused Bench Press')
  })

  it('an offline relaunch fails its read honestly and keeps what this device already had', async () => {
    const result = await renamedElsewhereThenRelaunch('offline')

    expect(result.shownAfterLaunch).toBe('Bench Press')
  })

  it.each(BAD_CONNECTIONS)('control: under the pre-fix routes a relaunch that is %s pushes the stale name back over the rename', async (_label, connection) => {
    harness.routes = PRE_FIX_ROUTES
    const result = await renamedElsewhereThenRelaunch(connection)

    // The SW answered with launch 1's row. It tied the local copy, a tie is a
    // local win, and the local-wins loop re-upserted it over the rename; the
    // trigger then stamped the revert newest, so it wins every later merge.
    expect(result.shownAfterLaunch).toBe('Bench Press')
    expect(result.server).toBe('Bench Press')
    expect(result.shownAfterRecovery).toBe('Bench Press')
  })
})

// ── Bodyweight (NetworkFirst) ────────────────────────────────────────

/**
 * Read the weigh-in online, let another device correct it, relaunch on
 * `connection`, then recover.
 */
async function correctedElsewhereThenRelaunch(connection: Connection) {
  harness.fake.seed('bodyweight_entries', [WEIGH_IN])
  await settle(useBodyweightStore().init(USER))
  await drainWrites()

  await editElsewhere('bodyweight_entries', WEIGH_IN.id, { weight: 178 })

  relaunch()
  setConnection(connection)
  const store = useBodyweightStore()
  await settle(store.init(USER))

  await recover(() => store._fetchFromSupabase())
  return {
    shownAfterRecovery: store.entries.map((e) => e.weight),
    server: serverRow('bodyweight_entries', WEIGH_IN.id).weight,
  }
}

describe('bodyweight: a bad-connection launch is never answered with a cached row (LIFT-1524)', () => {
  it.each(BAD_CONNECTIONS)('a relaunch that is %s keeps a correction made on another device, here and on the server', async (_label, connection) => {
    const result = await correctedElsewhereThenRelaunch(connection)

    expect(result.server).toBe(178)
    expect(result.shownAfterRecovery).toEqual([178])
  })

  it.each(BAD_CONNECTIONS)('control: under the pre-fix routes a relaunch that is %s pushes the stale weight back over the correction', async (_label, connection) => {
    harness.routes = PRE_FIX_ROUTES
    const result = await correctedElsewhereThenRelaunch(connection)

    expect(result.server).toBe(180)
    expect(result.shownAfterRecovery).toEqual([180])
  })
})

// ── Sets (StaleWhileRevalidate) ──────────────────────────────────────

/**
 * Log a set online, let another device correct it, and relaunch on a GOOD
 * connection. Under StaleWhileRevalidate the sets read is answered with the
 * snapshot taken before the set existed.
 */
async function setCorrectedElsewhereThenRelaunch() {
  harness.fake.seed('exercises', [EXERCISE])
  const first = useWorkoutStore()
  await settle(first.init(USER))
  first.logSet(EXERCISE.id, 100, 5)
  await drainWrites()
  const setId = first.exercises[0].sets[0].id
  // Non-vacuity: the set really reached the server before it was corrected.
  expect(serverRow('sets', setId).weight).toBe(100)

  await editElsewhere('sets', setId, { weight: 105, estimated_1rm: epley(105, 5) })

  relaunch()
  const store = useWorkoutStore()
  await settle(store.init(USER))
  await drainWrites()
  return {
    shown: store.exercises[0].sets.find((s) => s.id === setId)?.weight,
    server: serverRow('sets', setId).weight,
  }
}

/** Read the sets online, let another device log one, and relaunch on a good connection. */
async function loggedElsewhereThenRelaunch() {
  harness.fake.seed('exercises', [EXERCISE])
  await settle(useWorkoutStore().init(USER))
  await drainWrites()

  await harness.fake.from('sets').upsert({
    id: 'set-elsewhere', user_id: USER, exercise_id: EXERCISE.id,
    date: '2026-10-01T23:59:41.000Z', weight: 135, reps: 5, estimated_1rm: epley(135, 5),
    attempted_next_rep: false, created_at: new Date().toISOString(),
  })

  relaunch()
  const store = useWorkoutStore()
  await settle(store.init(USER))
  return store.exercises[0].sets.map((s) => s.id)
}

describe('sets: every read reflects the server as it is now (LIFT-1524)', () => {
  it('a relaunch adopts a correction another device made to a set this device logged, and never pushes the old copy back', async () => {
    expect(await setCorrectedElsewhereThenRelaunch()).toEqual({ shown: 105, server: 105 })
  })

  it('control: under the pre-fix routes the stale snapshot makes the set look unsynced, and the re-push reverts the correction', async () => {
    harness.routes = PRE_FIX_ROUTES

    expect(await setCorrectedElsewhereThenRelaunch()).toEqual({ shown: 100, server: 100 })
  })

  it('a set logged on another device shows on the very next launch', async () => {
    expect(await loggedElsewhereThenRelaunch()).toEqual(['set-elsewhere'])
  })

  it('control: under the pre-fix routes it shows a launch late', async () => {
    harness.routes = PRE_FIX_ROUTES

    expect(await loggedElsewhereThenRelaunch()).toEqual([])
  })
})

// ── The route each read actually takes ───────────────────────────────

async function readEverything(): Promise<void> {
  harness.fake.seed('exercises', [EXERCISE])
  harness.fake.seed('bodyweight_entries', [WEIGH_IN])
  await settle(useWorkoutStore().init(USER))
  await settle(useBodyweightStore().init(USER))
}

describe('the reads the workout and bodyweight stores send (LIFT-1524)', () => {
  it('go to the network through a NetworkOnly route and leave nothing in any cache', async () => {
    await readEverything()

    // Non-vacuity: every collection really was read, through the real client's URLs.
    const tables = [...new Set(harness.reads.map((url) => new URL(url).pathname))].sort()
    expect(tables).toEqual(['/rest/v1/bodyweight_entries', '/rest/v1/exercises', '/rest/v1/sets'])
    for (const url of harness.reads) {
      expect(resolveWorkboxRoute(RUNTIME_CACHING, url)?.handler, url).toBe('NetworkOnly')
    }
    expect(harness.sw!.cachedUrls()).toEqual([])
  })

  it('control: under the pre-fix routes the same reads land in Cache Storage', async () => {
    harness.routes = PRE_FIX_ROUTES
    await readEverything()

    const cached = harness.sw!.cachedUrls().map((url) => new URL(url).pathname).sort()
    expect(cached).toEqual(['/rest/v1/bodyweight_entries', '/rest/v1/exercises', '/rest/v1/sets'])
  })
})
