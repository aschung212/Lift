/**
 * LIFT-1510 — an offline or slow launch must not adopt a cached copy of the
 * user_preferences / user_progression row over what this device already holds.
 *
 * Both reads are adopted remote-wins with no freshness check, and the service
 * worker used to answer them NetworkFirst: on a launch where the network was
 * down or slower than 3s, Workbox fell back to the copy it cached on the last
 * successful read and the store received it as `{ data, error: null }` — a
 * fresh-looking row. A setting changed since then had reached the server as a
 * POST, which never refreshes the cached GET, so the lifter's own change was
 * reverted: preferences wrote the old theme/units/gyms into localStorage and
 * the FOUC keys (surviving the outage), and progression pushed the old row back
 * over the server's newer one.
 *
 * Why nothing caught it: every store test fakes the Supabase client, so no
 * request ever passed through the service worker's routes, and the Workbox
 * test only sliced vite.config.js's text for cache names that existed. This
 * drives the REAL stores through a real supabase-js client whose `fetch` is
 * the config's own routing (serviceWorkerRoutes.ts), across two "launches".
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getLocalStorageMock } from '../../__tests__/helpers'
import {
  loadWorkboxOptions,
  emulateServiceWorker,
  type EmulatedServiceWorker,
  type RuntimeCachingRule,
} from '../../__tests__/serviceWorkerRoutes'

const localStorageMock = getLocalStorageMock()

const { net, enqueue } = vi.hoisted(() => ({
  net: { client: null as unknown },
  enqueue: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  // A getter, so the stores read the client built in beforeAll below — it
  // needs the evaluated config, which a hoisted factory cannot await.
  get supabase() { return net.client },
  isPreviewMode: { value: false },
}))

vi.mock('../../lib/syncQueue', () => ({
  syncQueue: { enqueue, enqueueDelete: vi.fn(), clear: vi.fn(), rehydrate: vi.fn() },
  syncStatus: { value: 'synced' },
}))

vi.mock('../../lib/durableStorage', () => ({
  backupToIDB: vi.fn(),
}))

vi.mock('../../lib/crossTabSync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/crossTabSync')>()),
  broadcastStoreUpdate: vi.fn(),
}))

import { usePreferencesStore } from '../preferences'
import { useProgressionStore } from '../progression'

const USER_ID = 'u1'

/** The account's rows as PostgREST holds them, keyed by table. */
const server: Record<string, Record<string, unknown> | null> = {}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** Just enough PostgREST: a `.single()` read of the row, or PGRST116 when there is none. */
async function postgrest(request: Request): Promise<Response> {
  if (request.method !== 'GET') return new Response(null, { status: 201 })
  const table = new URL(request.url).pathname.replace(/^\/rest\/v1\//, '')
  const row = server[table]
  if (!row) {
    return json(406, { code: 'PGRST116', details: 'The result contains 0 rows', hint: null, message: 'JSON object requested, multiple (or no) rows returned' })
  }
  return json(200, row)
}

const PREFERENCES_BLOB = {
  features: { workouts: true, calendar: true, weight: true },
  theme: 'fire',
  colorMode: 'dark',
  weightUnit: 'lbs',
}

function progressionRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    user_id: USER_ID,
    total_xp: 0,
    streak_weeks: 0,
    weekly_target: 3,
    pending_target_change: null,
    show_progression: true,
    progression_enabled: true,
    unlocked_themes: ['pearl'],
    starter_theme: 'fire',
    starter_confirmed: true,
    epoch: 1,
    streak_history: [],
    xp_per_set: {},
    bodyweight_xp_dates: [],
    ...over,
  }
}

/** Every upsert the progression store queued, as the rows it would write. */
function progressionPushes(): Record<string, unknown>[] {
  return enqueue.mock.calls
    .filter(([key]) => key === 'progression-sync')
    .map(([, , descriptor]) => (descriptor as { row: Record<string, unknown> }).row)
}

let rules: RuntimeCachingRule[]
let sw: EmulatedServiceWorker

beforeAll(async () => {
  rules = (await loadWorkboxOptions()).runtimeCaching ?? []
  const { createClient } = await import('@supabase/supabase-js')
  // Default client options on purpose — including postgrest-js's retry of a
  // failed GET — so a store read behaves here as it does in production.
  net.client = createClient('https://project.supabase.co', 'anon-key', {
    global: { fetch: (input, init) => sw.fetch(input, init) },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }) as SupabaseClient
})

beforeEach(() => {
  // A fresh Cache Storage per test; within a test it outlives the "relaunch".
  sw = emulateServiceWorker(rules, postgrest)
  server.user_preferences = null
  server.user_progression = null
  localStorageMock.clear()
  enqueue.mockClear()
  setActivePinia(createPinia())
})

/** A cold start: new Pinia, so every store re-hydrates from localStorage. */
function relaunch() {
  setActivePinia(createPinia())
}

describe('LIFT-1510 an offline launch never adopts a cached copy of a remote-wins row', () => {
  it('keeps a preference changed since the last online read', async () => {
    // Launch 1, online: the account's row is read — and, if its route caches,
    // stored by the service worker.
    server.user_preferences = { preferences: PREFERENCES_BLOB }
    const first = usePreferencesStore()
    await first.init(USER_ID)
    expect(first.theme).toBe('fire')

    // The lifter changes theme, and the upsert reaches the server. That was a
    // POST, so any cached copy of the GET still says 'fire'.
    first.setTheme('water')
    server.user_preferences = { preferences: { ...PREFERENCES_BLOB, theme: 'water' } }

    // Launch 2, with no network.
    sw.online = false
    relaunch()
    const second = usePreferencesStore()
    await second.init(USER_ID)

    expect(second.theme).toBe('water')
    // The FOUC key is what the NEXT cold start paints before Pinia exists, so a
    // revert written here outlived the outage that caused it.
    expect(localStorageMock.getItem('app-theme')).toBe('water')
    expect(JSON.parse(localStorageMock.getItem('user-preferences')!).theme).toBe('water')
    // And the failed read is reported as one, not as a successful sync.
    expect(second.lastSyncError).toBe('network')
  })

  it('does not adopt a cached progression row, or push it back over the server', async () => {
    server.user_progression = progressionRow({ show_progression: true })
    const first = useProgressionStore()
    await first.init(USER_ID)
    expect(first.showProgression).toBe(true)

    first.setShowProgression(false)
    server.user_progression = progressionRow({ show_progression: false })
    enqueue.mockClear()

    sw.online = false
    relaunch()
    const second = useProgressionStore()
    await second.init(USER_ID)

    // _fetchFromSupabase ends in _syncToSupabase, so an adopted stale row was
    // not merely shown — it was written back over the server's newer one, and
    // every other device picked it up from there.
    expect(
      progressionPushes().filter(row => row.show_progression === true),
      'a stale progression row was pushed back to the server',
    ).toEqual([])
    expect(second.showProgression).toBe(false)
    expect(second.lastSyncError).toBe('network')
  })

  it('still adopts the server\'s row when the network answers', async () => {
    // NetworkOnly must cost nothing online: another device's change still wins.
    server.user_preferences = { preferences: PREFERENCES_BLOB }
    const first = usePreferencesStore()
    await first.init(USER_ID)

    server.user_preferences = { preferences: { ...PREFERENCES_BLOB, weightUnit: 'kg' } }
    relaunch()
    const second = usePreferencesStore()
    await second.init(USER_ID)

    expect(second.weightUnit).toBe('kg')
    expect(second.lastSyncError).toBeNull()
  })
})

describe('LIFT-1510 an offline read fails in one attempt, not after seconds of backoff', () => {
  // The splash screen stays up until every store's init() settles (useAuth's
  // initStores), and the service worker's cached copy used to answer these two
  // reads instantly offline. Answered by the network instead, postgrest-js
  // would retry a failed GET three times at 1s/2s/4s — seven seconds added to
  // every offline cold start for a read whose failure costs nothing, since the
  // store keeps its local state and useSyncRecovery re-reads on reconnect.
  // (A regression here fails on the attempt count after ~7s, hence the timeout.)
  const readsOf = (table: string) =>
    sw.networkRequests.filter(r => r.startsWith('GET ') && r.includes(`/rest/v1/${table}?`))

  it('preferences', async () => {
    sw.online = false
    await usePreferencesStore().init(USER_ID)
    expect(readsOf('user_preferences')).toHaveLength(1)
  }, 15_000)

  it('progression', async () => {
    sw.online = false
    await useProgressionStore().init(USER_ID)
    expect(readsOf('user_progression')).toHaveLength(1)
  }, 15_000)
})
