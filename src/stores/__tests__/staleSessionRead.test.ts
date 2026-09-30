/**
 * Regression: a store read that lands after its session ended writes nothing
 * (LIFT-1517).
 *
 * Nothing cancels a Supabase request on sign-out. `useAuth`'s teardown runs
 * every store's `$reset()` — `_userId` nulled, an empty payload persisted —
 * while a `_fetchFromSupabase` issued a moment earlier (the initial hydrate, or
 * a `useSyncRecovery` re-fetch on resume) is still in flight. The workout and
 * bodyweight reads never looked at `_userId` again once the response arrived,
 * so they ran their whole success path against the wiped store: the previous
 * user's history was merged into it and `_persist()`ed back to localStorage,
 * which is exactly the state `$reset()` exists to prevent (#1158). From there it
 * reached the next account to sign in on the device as that account's OWN data
 * — `migrateLocalStorageToSupabase` inserts it into an empty account, and the
 * fetch's `localOnly` push upserts it into any other. If the next account
 * signed in before the stale response arrived, the response merged straight
 * into its live store.
 *
 * LIFT-1515 had already added the check to the SUCCESS path of the two
 * whole-row stores (preferences, progression), for its own reason; their
 * failure branches and `finally` still acted on a stale response, so all four
 * stores run the same matrix here.
 *
 * Why nothing caught it: every fetch-path test awaits `init()` or
 * `_fetchFromSupabase()` to completion before doing anything else, and every
 * sign-out test (`signOutStateWipe`, `signOutRealStores`) signs out with no read
 * in flight — the store is always either fully hydrated or fully wiped at the
 * moment it is inspected. The defect only exists between those two states, so a
 * test has to hold a response open across the sign-out, which is what the gate
 * in the Supabase mock below does.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

/** How a held read is finally answered. */
type Answer = 'rows' | 'resolved-auth-error' | 'thrown-auth-error'

const { fake, gate } = await vi.hoisted(async () => {
  const { createFakeSupabase } = await import('../../__tests__/fakeSupabase')
  return {
    fake: createFakeSupabase({ mode: 'ok' }),
    // While `batch` is set, every query built is held open and its release
    // function is collected there — see `holdReads`.
    gate: { batch: null as Array<(answer: Answer) => void> | null },
  }
})

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from(table: string) {
      const builder = fake.from(table)
      const batch = gate.batch
      if (!batch) return builder
      // Answer only once the test releases this batch. The fake computes its
      // rows at answer time, so a held read returns what the server holds then.
      const answer = builder.then.bind(builder)
      builder.then = ((onFulfilled, onRejected) =>
        new Promise<Answer>(release => batch.push(release))
          .then(how => {
            if (how === 'resolved-auth-error') {
              // PostgREST's JWT-expiry envelope — resolved, not thrown (LIFT-1321).
              return { data: null, error: { message: 'JWT expired', code: 'PGRST301' }, status: 401 }
            }
            if (how === 'thrown-auth-error') {
              throw Object.assign(new Error('Invalid JWT'), { status: 401 })
            }
            return answer()
          })
          .then(onFulfilled, onRejected)) as typeof builder.then
      return builder
    },
  },
  isPreviewMode: { value: false },
}))

// Synchronous queue: every enqueued write runs against the fake immediately, so
// the assertions read what reached the server rather than a list of intentions.
vi.mock('../../lib/syncQueue', () => {
  const run = (_key: string, op: () => PromiseLike<unknown>) => {
    Promise.resolve(op()).then(undefined, () => {})
  }
  return {
    syncQueue: { enqueue: vi.fn(run), enqueueDelete: vi.fn(run), clear: vi.fn() },
    syncStatus: { value: 'synced' },
  }
})

// Spy the refresh but keep the real `isAuthError`, so a stale 401 is classified
// exactly as a live one would be.
vi.mock('../../lib/sessionHealth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/sessionHealth')>()),
  ensureFreshSession: vi.fn(() => Promise.resolve(true)),
}))

vi.mock('../../lib/crossTabSync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/crossTabSync')>()),
  broadcastStoreUpdate: vi.fn(),
  broadcastSyncStatus: vi.fn(),
}))

vi.mock('../../lib/durableStorage', () => ({ backupToIDB: vi.fn() }))

vi.mock('../../lib/logger', () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}))

import { useWorkoutStore } from '../workout'
import { useBodyweightStore } from '../bodyweight'
import { usePreferencesStore } from '../preferences'
import { useProgressionStore } from '../progression'
import { syncStatus } from '../../lib/syncQueue'
import { ensureFreshSession } from '../../lib/sessionHealth'
import { _resetTombstones } from '../../lib/tombstones'

const USER_A = 'user-a'
const USER_B = 'user-b'
const CREATED = '2026-09-01T12:00:00.000Z'

/** Let pending awaits reach the held `then`s, and queued writes settle. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

function readJSON(key: string): unknown {
  const raw = localStorage.getItem(key)
  return raw === null ? null : JSON.parse(raw)
}

/** The slice of a store every case drives — the rest is per-store. */
interface SessionStore {
  init(userId: string): Promise<void>
  _fetchFromSupabase(): Promise<void>
  $reset(): void
  syncing: boolean
  lastSyncError: unknown
}

/**
 * One store's view of "whose data is this": each seeded account's rows carry
 * its user id in a name or key, so `markers` answers which accounts' data the
 * store holds, in memory and in its persisted payload.
 */
interface StoreCase {
  name: string
  open: () => SessionStore
  seed: (userId: string) => void
  memory: (store: SessionStore) => string[]
  persisted: () => string[]
  /** The store's next write for the signed-in account — how held data would leave the device. */
  nextWrite: (store: SessionStore) => Promise<void>
}

const CASES: StoreCase[] = [
  {
    name: 'workout',
    open: () => useWorkoutStore(),
    seed: userId => {
      fake.tables.exercises.push({
        id: `ex-${userId}`, user_id: userId, name: `Bench (${userId})`, tags: [],
        created_at: CREATED, updated_at: CREATED, deleted_at: null,
      })
      fake.tables.sets.push({
        id: `set-${userId}`, user_id: userId, exercise_id: `ex-${userId}`,
        date: '2026-09-01T23:59:30.000Z', weight: 225, reps: 5, estimated_1rm: 262.5,
        created_at: CREATED, deleted_at: null,
      })
    },
    memory: store => (store as ReturnType<typeof useWorkoutStore>).exercises.map(e => e.name),
    persisted: () => ((readJSON('workout-exercises') ?? []) as { name: string }[]).map(e => e.name),
    // The next fetch pushes every local row the server lacks as `localOnly`.
    nextWrite: store => store._fetchFromSupabase(),
  },
  {
    name: 'bodyweight',
    open: () => useBodyweightStore(),
    seed: userId => {
      // A day apiece: the fetch keeps one entry per day, so two accounts'
      // weigh-ins on the SAME day would collapse and hide a leak behind the dedup.
      const day = userId === USER_A ? '2026-09-01' : '2026-09-02'
      fake.tables.bodyweight_entries.push({
        id: `bw-${userId}`, user_id: userId, date: `${day}T23:59:30.000Z`, weight: 181,
        created_at: CREATED, updated_at: CREATED, deleted_at: null,
      })
    },
    memory: store => (store as ReturnType<typeof useBodyweightStore>).entries.map(e => e.id),
    persisted: () => ((readJSON('bodyweight-entries') ?? []) as { id: string }[]).map(e => e.id),
    nextWrite: store => store._fetchFromSupabase(),
  },
  {
    name: 'preferences',
    open: () => usePreferencesStore(),
    seed: userId => {
      fake.tables.user_preferences.push({
        id: `prefs-${userId}`, user_id: userId,
        preferences: { features: { workouts: true, calendar: true, weight: true }, gyms: [`Gym ${userId}`] },
      })
    },
    memory: store => [...(store as ReturnType<typeof usePreferencesStore>).gyms],
    persisted: () => [...(((readJSON('user-preferences') ?? {}) as { gyms?: string[] }).gyms ?? [])],
    // The fetch only adopts; the blob reaches the server on the next settings change.
    nextWrite: async store => {
      (store as ReturnType<typeof usePreferencesStore>).setTheme('fire')
    },
  },
  {
    name: 'progression',
    open: () => useProgressionStore(),
    seed: userId => {
      fake.tables.user_progression.push({
        id: `prog-${userId}`, user_id: userId, total_xp: 120, weekly_target: 3,
        xp_per_set: { [`set-${userId}`]: { xp: 120, theme: 'pearl', epoch: 1, zone: 'working', isPR: false, isRepPR: false } },
      })
    },
    memory: store => Object.keys((store as ReturnType<typeof useProgressionStore>).xpPerSet),
    persisted: () => Object.keys(((readJSON('user-progression') ?? {}) as { xpPerSet?: object }).xpPerSet ?? {}),
    // The fetch unions and then `_syncToSupabase`s the merged row.
    nextWrite: store => store._fetchFromSupabase(),
  },
]

/**
 * Start `start()` with every query it issues synchronously held open, and hand
 * back a way to answer them later. Every store builds its query before its
 * first await, so the batch holds exactly that call's reads and nothing after.
 */
function holdReads(start: () => Promise<void>) {
  const batch: Array<(answer: Answer) => void> = []
  gate.batch = batch
  const pending = start()
  gate.batch = null
  return {
    async answer(how: Answer = 'rows') {
      await settle()
      // Non-vacuity: a gate that held nothing would let every assertion pass.
      expect(batch.length).toBeGreaterThan(0)
      for (const release of batch.splice(0)) release(how)
      await pending
      await settle()
    },
  }
}

/** Every row written to the server so far, as text, to search for an account's data. */
const writesSoFar = () =>
  JSON.stringify(fake.calls.filter(c => c.op !== 'select').map(c => c.data))

describe.each(CASES)('$name store: a read that outlives its session (LIFT-1517)', (c) => {
  beforeEach(() => {
    localStorageMock.clear()
    fake.reset()
    _resetTombstones()
    gate.batch = null
    syncStatus.value = 'synced'
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('does not re-persist the signed-out user into the wiped store', async () => {
    c.seed(USER_A)
    const store = c.open()

    const read = holdReads(() => store.init(USER_A))
    store.$reset() // sign-out lands while the read is in flight
    await read.answer('rows')

    // Before the fix all four stores held (and had persisted) user-a again —
    // the payload the next sign-in on this device would have uploaded.
    expect(c.memory(store)).toEqual([])
    expect(c.persisted()).toEqual([])
    expect(writesSoFar()).not.toContain(USER_A)
    expect(store.syncing).toBe(false)
    expect(store.lastSyncError).toBeNull()
  })

  it('does not merge the previous user into the next account that signed in', async () => {
    c.seed(USER_A)
    c.seed(USER_B)
    const store = c.open()

    const read = holdReads(() => store.init(USER_A))
    store.$reset()
    await store.init(USER_B) // the next account signs in before the response arrives
    await read.answer('rows')

    expect(c.memory(store).join()).not.toContain(USER_A)
    expect(c.persisted().join()).not.toContain(USER_A)

    // …and nothing of user-a's leaves the device under user-b's account on the
    // store's next write — the actual cross-account upload.
    await c.nextWrite(store)
    await settle()
    expect(writesSoFar()).not.toContain(USER_A)
    // The next session itself is untouched.
    expect(c.memory(store).join()).toContain(USER_B)
  })

  it('leaves the next session to own the syncing flag', async () => {
    c.seed(USER_A)
    c.seed(USER_B)
    const store = c.open()

    const readA = holdReads(() => store.init(USER_A))
    store.$reset()
    const readB = holdReads(() => store.init(USER_B))
    expect(store.syncing).toBe(true)

    await readA.answer('rows')
    // user-b's read is still in flight: the stale read's `finally` must not
    // report the store as idle.
    expect(store.syncing).toBe(true)

    await readB.answer('rows')
    expect(store.syncing).toBe(false)
  })

  it.each(['resolved-auth-error', 'thrown-auth-error'] as const)(
    'does not report a stale %s against the next session',
    async (how) => {
      c.seed(USER_A)
      const store = c.open()

      const read = holdReads(() => store.init(USER_A))
      store.$reset()
      await read.answer(how)

      // A 401 is expected once the session is gone. Classified, it would light
      // the next session's sync indicator; routed to `ensureFreshSession`, it
      // would try to refresh a session that no longer exists and raise the
      // "Session expired — sign in again" banner over the auth screen.
      expect(store.lastSyncError).toBeNull()
      expect(syncStatus.value).toBe('synced')
      expect(ensureFreshSession).not.toHaveBeenCalled()
    },
  )

  it('still applies a read when the same account is signed in throughout', async () => {
    // The guard compares accounts, not "was there a sign-out": a read must
    // still land in the session it belongs to.
    c.seed(USER_A)
    const store = c.open()

    const read = holdReads(() => store.init(USER_A))
    await read.answer('rows')

    expect(c.memory(store).join()).toContain(USER_A)
    expect(c.persisted().join()).toContain(USER_A)
  })
})
