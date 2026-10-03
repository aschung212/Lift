/**
 * Regression: a signed-in cold start lifts the splash once the stores are
 * bound, not once they have read the server (LIFT-1516).
 *
 * `useAuth` flipped `loading` (the splash) only when `initStores` resolved,
 * and that meant a migration count query followed by all four stores' reads.
 * Every store had already hydrated from localStorage when it was created, so
 * the lifter's data was on screen-ready the whole time. Still, a dead uplink
 * or an expired service-worker cache held the splash through postgrest-js's
 * 1s/2s/4s GET retries plus the browser's own network timeout on every
 * attempt: tens of seconds to minutes at the gym, with nothing to show for it.
 * A rejection in that chain left it up for good (LIFT-1324).
 *
 * Why the suite missed it: `useAuth.test.ts` mocked every store with an
 * `init` that resolved at once, and no test ever held a request open across
 * the splash. The shared fake answers every query on the next microtask, so in
 * every test the network was instant and "the splash waits for the network"
 * could not be seen.
 *
 * These cases drive the real stores through the real `useAuth().init()`
 * against a client whose requests can be held: while `uplink.dead`, every
 * request is issued and never answered, the way a dead link looks from inside
 * postgrest-js. They assert on what the lifter can see and do (the splash,
 * the history on screen, whether a set they log goes out under their
 * account), not on which functions ran.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

// Needed by useTheme, which the stores import transitively.
vi.stubGlobal('matchMedia', vi.fn(() => ({
  matches: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})))

const { USER, OTHER_USER, fake, uplink, client, authListener, migrate, queue, logError } = await vi.hoisted(async () => {
  const { createFakeSupabase } = await import('../../__tests__/fakeSupabase')
  const USER = 'user-1516'
  const OTHER_USER = 'user-1516-next'
  const fake = createFakeSupabase()

  /** Answers for requests issued while the uplink was dead. */
  const held: Array<() => void> = []
  const uplink = {
    dead: false,
    /** Requests issued and still waiting for an answer. */
    pending: (): number => held.length,
    /** Answer everything held so far, and every request after it straight away. */
    revive(): void {
      uplink.dead = false
      for (const answer of held.splice(0)) answer()
    },
    /** Issue a request: answered now, or only once the uplink is back. */
    request<T>(answer: () => T | PromiseLike<T>): Promise<T> {
      if (!uplink.dead) return Promise.resolve(answer())
      return new Promise<T>((resolve) => { held.push(() => resolve(answer())) })
    },
  }

  const authListener: { cb: ((event: string, session: unknown) => void) | null } = { cb: null }
  const client = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { user: { id: USER, email: 'a@b.co' } } } })),
      onAuthStateChange: vi.fn((cb: (event: string, session: unknown) => void) => {
        authListener.cb = cb
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      }),
      startAutoRefresh: vi.fn(),
      stopAutoRefresh: vi.fn(),
    },
    // Every query is the shared fake's, so the chain surface stays its single
    // source of truth (LIFT-1009). Only WHEN it answers goes through the uplink.
    from: vi.fn((table: string) => {
      const builder = fake.from(table)
      const answer = builder.then.bind(builder)
      return Object.assign(builder, {
        then: (onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
          uplink.request(() => answer(onFulfilled as never, onRejected as never)),
      })
    }),
  }

  return {
    USER,
    OTHER_USER,
    fake,
    uplink,
    client,
    authListener,
    // The migration's first act is a count query, so on a dead uplink it is
    // one more request that never comes back.
    migrate: vi.fn(() => uplink.request(() => undefined)),
    queue: {
      enqueue: vi.fn(),
      enqueueDelete: vi.fn(),
      clear: vi.fn(),
      rehydrate: vi.fn(() => Promise.resolve()),
      flush: vi.fn(() => Promise.resolve()),
    },
    logError: vi.fn(),
  }
})

vi.mock('../../lib/supabase', () => ({ supabase: client, isPreviewMode: { value: false } }))
vi.mock('../../lib/migrate', () => ({ migrateLocalStorageToSupabase: migrate }))
vi.mock('../../lib/syncQueue', () => ({ syncQueue: queue, syncStatus: { value: 'synced' } }))
vi.mock('../../lib/durableStorage', () => ({ backupToIDB: vi.fn(), deleteAllIDB: vi.fn() }))
vi.mock('../../lib/crossTabSync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/crossTabSync')>()),
  broadcastStoreUpdate: vi.fn(),
  broadcastSyncStatus: vi.fn(),
}))
vi.mock('../../lib/logger', () => ({ logError, logWarn: vi.fn(), logInfo: vi.fn() }))

/** Let promise chains settle. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

let destroyAuth: (() => void) | null = null

/**
 * The app as a cold start finds it: fresh module state (so `loading` starts
 * true and `init()` is armed), a fresh Pinia, and stores hydrated from
 * whatever an earlier session left in localStorage.
 */
async function relaunch() {
  vi.resetModules()
  const { createPinia, setActivePinia } = await import('pinia')
  setActivePinia(createPinia())
  const { watch } = await import('vue')
  const { useWorkoutStore } = await import('../../stores/workout')
  const { useAuth, FIRST_READ_GRACE_MS } = await import('../useAuth')
  const auth = useAuth()
  destroyAuth = auth.destroy
  return { auth, workout: useWorkoutStore(), graceMs: FIRST_READ_GRACE_MS, watch }
}

/** A bench session an earlier launch logged on this device and persisted. */
async function leaveLocalHistory(): Promise<void> {
  const { workout } = await relaunch()
  const id = workout.addExercise('Bench Press', ['Push'])!
  workout.logSet(id, 185, 5)
  vi.clearAllMocks()
}

/** A squat session another device synced to the account. */
function seedServerHistory(): void {
  fake.seed('exercises', [{
    id: 'squat-row', user_id: USER, name: 'Squat', tags: [],
    created_at: '2026-09-30T18:00:00.000Z', updated_at: '2026-09-30T18:00:00.000Z', deleted_at: null,
  }])
  fake.seed('sets', [{
    id: 'squat-set', user_id: USER, exercise_id: 'squat-row',
    date: '2026-09-30T23:59:30.000Z', weight: 225, reps: 5, estimated_1rm: 262,
    created_at: '2026-09-30T18:05:00.000Z', deleted_at: null,
  }])
}

/** Every write the stores enqueued for a set. */
function setWrites() {
  return queue.enqueue.mock.calls
    .filter(([key]) => String(key).startsWith('set:'))
    .map(([, , descriptor]) => descriptor as { table: string; row: Record<string, unknown> })
}

/** The write a set logged at `weight` would go out as, under `userId`. */
const setWriteFor = (userId: string, weight: number) =>
  expect.objectContaining({ table: 'sets', row: expect.objectContaining({ user_id: userId, weight }) })

describe('a signed-in cold start lifts the splash once the stores are bound (LIFT-1516)', () => {
  beforeEach(() => {
    localStorageMock.clear()
    fake.reset()
    uplink.revive()
    authListener.cb = null
    vi.clearAllMocks()
    // init() only wires Supabase outside DEV, which vitest runs in.
    vi.stubEnv('DEV', false)
  })

  afterEach(() => {
    destroyAuth?.()
    destroyAuth = null
    uplink.revive()
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('shows the history already on the device while every request hangs', async () => {
    await leaveLocalHistory()
    uplink.dead = true
    const { auth, workout } = await relaunch()

    auth.init()
    await vi.waitFor(() => expect(auth.loading.value).toBe(false))

    // The splash is down with the bench session on screen, and the boot's
    // first request has still not come back: nothing here waited for it.
    expect(workout.exercises.map(e => e.name)).toEqual(['Bench Press'])
    expect(workout.exercises[0].sets).toHaveLength(1)
    expect(uplink.pending()).toBeGreaterThan(0)

    // The stores are bound, so a set logged now goes out under the account
    // rather than staying on this device.
    workout.logSet(workout.exercises[0].id, 190, 5)
    expect(setWrites()).toEqual([setWriteFor(USER, 190)])
  })

  it('still runs the reads behind the splash, flushing writes first, and lands them when the uplink returns', async () => {
    await leaveLocalHistory()
    uplink.dead = true
    const { auth, workout } = await relaunch()
    auth.init()
    await vi.waitFor(() => expect(auth.loading.value).toBe(false))

    seedServerHistory()
    uplink.revive()

    await vi.waitFor(() => expect(workout.exercises.map(e => e.name).sort()).toEqual(['Bench Press', 'Squat']))
    // Writes before reads, as a resume re-fetch does: the user can act while
    // the migration is out, and a read landing ahead of that write would merge
    // the server's older copy over it.
    expect(queue.flush).toHaveBeenCalledTimes(1)
    expect(client.from).toHaveBeenCalled()
    expect(queue.flush.mock.invocationCallOrder[0]).toBeLessThan(client.from.mock.invocationCallOrder[0])
  })

  it('binds no store until the durable journal has been read back', async () => {
    await leaveLocalHistory()
    // Keep the boot's reads out of it: their reconciliation would push the
    // local sets too, and this case is about what binding alone allows.
    uplink.dead = true
    let finishJournalRead!: () => void
    queue.rehydrate.mockImplementationOnce(() => new Promise<void>((resolve) => { finishJournalRead = resolve }))
    const { auth, workout } = await relaunch()
    auth.init()
    await vi.waitFor(() => expect(queue.rehydrate).toHaveBeenCalled())

    // The first journaled write persists the in-memory journal over the copy
    // in IndexedDB. Until that copy has been read, nothing may enqueue one, or
    // whatever the last session left unsent is gone.
    workout.logSet(workout.exercises[0].id, 190, 5)
    expect(queue.enqueue).not.toHaveBeenCalled()
    expect(auth.loading.value).toBe(true)

    finishJournalRead()
    await vi.waitFor(() => expect(auth.loading.value).toBe(false))
    workout.logSet(workout.exercises[0].id, 195, 5)
    expect(setWrites()).toEqual([setWriteFor(USER, 195)])
  })

  it('waits for the first read on a device that holds nothing of the user\'s, but not past the grace period', async () => {
    uplink.dead = true
    const { auth, graceMs } = await relaunch()
    vi.useFakeTimers()

    auth.init()
    await vi.advanceTimersByTimeAsync(0)
    expect(queue.rehydrate).toHaveBeenCalled()
    // Bound, but with nothing to show: only the first read can tell a
    // returning lifter from a new one, and rendering without it would put a
    // returning lifter into onboarding.
    expect(auth.loading.value).toBe(true)

    await vi.advanceTimersByTimeAsync(graceMs - 1)
    expect(auth.loading.value).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    // A dead uplink costs the grace period, not every retry the reads make.
    expect(auth.loading.value).toBe(false)
  })

  it('on a device that holds nothing, lifts the splash with the account already loaded', async () => {
    seedServerHistory()
    const { auth, workout, watch } = await relaunch()
    const shownAtLift: string[][] = []
    watch(auth.loading, (loading) => {
      if (!loading) shownAtLift.push(workout.exercises.map(e => e.name))
    }, { flush: 'sync' })

    auth.init()
    await vi.waitFor(() => expect(auth.loading.value).toBe(false))

    // A returning lifter on a new browser lands on their own history rather
    // than on the onboarding flow it would have taken to be empty.
    expect(shownAtLift).toEqual([['Squat']])
  })

  it('lifts the splash even when reading the journal throws, and leaves the stores unbound (LIFT-1324)', async () => {
    await leaveLocalHistory()
    queue.rehydrate.mockImplementationOnce(() => Promise.reject(new Error('IndexedDB unavailable')))
    const { auth, workout } = await relaunch()

    auth.init()
    await vi.waitFor(() => expect(auth.loading.value).toBe(false))

    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'IndexedDB unavailable' }),
      expect.objectContaining({ source: 'useAuth', action: 'initStores' }),
    )
    // The local-first app still renders, but the journal on disk was never
    // read, so nothing this session may write over it.
    expect(workout.exercises.map(e => e.name)).toEqual(['Bench Press'])
    workout.logSet(workout.exercises[0].id, 190, 5)
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('a sign-out while the journal is being read leaves every store unbound', async () => {
    let finishJournalRead!: () => void
    queue.rehydrate.mockImplementationOnce(() => new Promise<void>((resolve) => { finishJournalRead = resolve }))
    const { auth, workout } = await relaunch()
    auth.init()
    await vi.waitFor(() => expect(queue.rehydrate).toHaveBeenCalled())

    authListener.cb!('SIGNED_OUT', null)
    finishJournalRead()
    await vi.waitFor(() => expect(auth.loading.value).toBe(false))

    // Bound now, the stores would push whatever happens next under an account
    // that is no longer signed in on this device.
    expect(auth.user.value).toBeNull()
    workout.addExercise('Squat')
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('a run superseded mid-migration never flushes or reads for the session after it', async () => {
    await leaveLocalHistory()
    uplink.dead = true
    const { auth } = await relaunch()
    auth.init()
    await vi.waitFor(() => expect(auth.loading.value).toBe(false))

    // Signed out while the first run's migration hangs, then the next lifter
    // signs in on the same device and starts a run of their own.
    authListener.cb!('SIGNED_OUT', null)
    authListener.cb!('SIGNED_IN', { user: { id: OTHER_USER, email: 'b@c.co' } })
    await vi.waitFor(() => expect(migrate).toHaveBeenCalledTimes(2))

    uplink.revive()
    await vi.waitFor(() => expect(fake.selectsFor('user_preferences')).toHaveLength(1))
    await settle()

    // One flush and one read per store, all the second sign-in's: the first
    // run woke up to find itself superseded and stopped.
    expect(queue.flush).toHaveBeenCalledTimes(1)
    expect(fake.selectsFor('user_progression')).toHaveLength(1)
    expect(fake.selectsFor('user_preferences').map(c => c.filters.user_id)).toEqual([OTHER_USER])
  })
})
