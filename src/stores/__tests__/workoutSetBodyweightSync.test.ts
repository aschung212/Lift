/**
 * Regression: the bodyweight captured onto a bodyweight-loaded set must reach
 * every device, not only the one that logged it (LIFT-1569).
 *
 * `set.bodyweight` had no `sets` column. `estimated_1rm` synced already folded,
 * so a second phone, a PWA reinstall or a new sign-in received a plain pull-up
 * as `weight: 0` with a ~224 lb e1RM and no bodyweight to explain it:
 * `formatSetLoad` read it as "0 lbs × 12" on every history surface (the
 * LIFT-1373 contradiction) and `effectiveSetWeight` counted it as zero volume in
 * the calendar, the trend charts, the training report and the theme stats (the
 * #1333 one). #1357's restore keeps a capture alive on the device that made it
 * and cannot help a device that never had one.
 *
 * The column has a second half that a plain "sync it" would get wrong: every
 * row written before it existed reads back NULL while the phone that logged the
 * set still holds the value. A capture is written once and never cleared, so
 * that NULL means "never learned", and the merge has to keep the phone's value
 * and send it to the server rather than let the NULL win.
 *
 * Why the suite missed it: every sync test ran ONE device, which always held its
 * own captures (and #1357's fixtures re-attached them), so nothing ever looked
 * at a device that had not logged the set. These run two real stores against
 * one fake server whose clock stamps writes the way `trg_sets_updated_at` does,
 * and assert on the server's rows.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

const { fakeSupabase, serverTime, invoke } = await vi.hoisted(async () => {
  const { createFakeSupabase } = await import('../../__tests__/fakeSupabase')
  // The server's now(): what `trg_sets_updated_at` stamps a write with.
  const serverTime = { now: '2026-10-12T18:00:00.000Z' }
  // Synchronous syncQueue: every enqueued write lands on the fake at once.
  const invoke = (_key: string, op: () => PromiseLike<unknown>) => {
    Promise.resolve(op()).catch(() => {})
  }
  return {
    fakeSupabase: createFakeSupabase({ mode: 'ok', serverClock: () => serverTime.now }),
    serverTime,
    invoke,
  }
})

vi.mock('../../lib/supabase', () => ({
  supabase: fakeSupabase,
  isPreviewMode: { value: false },
}))

vi.mock('../../lib/syncQueue', () => ({
  syncQueue: { enqueue: vi.fn(invoke), enqueueDelete: vi.fn(invoke), clear: vi.fn() },
}))

vi.mock('../../lib/logger', () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}))

import { useWorkoutStore, type Exercise, type WorkoutSet } from '../workout'
import { useBodyweightStore } from '../bodyweight'
import { syncQueue } from '../../lib/syncQueue'
import { effectiveSetWeight, formatSetLoad } from '../../lib/bodyweightLoad'
import { epley } from '../../lib/epley'
import { _resetTombstones } from '../../lib/tombstones'

const USER = 'user-1569'
const EX = 'ex-pullup'
/** The session day, as `endOfDayISO` writes it. */
const DATE = '2026-10-12T23:59:12.345Z'
/** The set was logged… */
const T_LOG = '2026-10-12T17:00:00.000Z'
/** …and the server accepted it. */
const T0 = '2026-10-12T17:00:01.000Z'
/** The lifter's bodyweight when the set was logged, in lbs. */
const BW = 170
const LBS = { displayWeight: (lbs: number) => lbs, unit: 'lbs' }

/** Let the synchronous syncQueue's microtask chains land on the fake. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

function serverExercise(overrides: Record<string, unknown> = {}) {
  return {
    id: EX, user_id: USER, name: 'Pull-up', tags: ['Pull'], bodyweight_loaded: true,
    created_at: T_LOG, updated_at: T0, deleted_at: null,
    ...overrides,
  }
}

/**
 * A plain pull-up (nothing added) as the server holds it. `bodyweight` is NULL:
 * the row was written before the column existed, or by a build that predates it.
 */
function serverSet(overrides: Record<string, unknown> = {}) {
  return {
    id: 'set-1', user_id: USER, exercise_id: EX,
    date: DATE, weight: 0, reps: 12, estimated_1rm: epley(BW, 12),
    attempted_next_rep: false, bodyweight: null,
    created_at: T_LOG, updated_at: T0, deleted_at: null,
    ...overrides,
  }
}

/** The same set as a device holds it after an earlier sync. */
function localSet(overrides: Partial<WorkoutSet> = {}): WorkoutSet {
  return {
    id: 'set-1', date: DATE, weight: 0, reps: 12, estimated1RM: epley(BW, 12),
    createdAt: T_LOG, updated_at: T0,
    ...overrides,
  }
}

function seedLocal(sets: WorkoutSet[]) {
  localStorageMock.setItem('workout-exercises', JSON.stringify([
    { id: EX, name: 'Pull-up', tags: ['Pull'], bodyweightLoaded: true, updated_at: T0, sets },
  ]))
}

const serverRow = (id: string) => fakeSupabase.tables.sets.find(r => r.id === id)!

const localCopy = (store: ReturnType<typeof useWorkoutStore>, id: string) =>
  store.exercises.flatMap(e => e.sets).find(s => s.id === id)!

/** A device with nothing on it — a second phone, a reinstall, a new sign-in — after its first sync. */
async function freshDevice() {
  localStorageMock.clear()
  setActivePinia(createPinia())
  const store = useWorkoutStore()
  await store.init(USER)
  await settle()
  return store
}

describe('the bodyweight captured onto a set reaches every device (LIFT-1569)', () => {
  beforeEach(() => {
    localStorageMock.clear()
    fakeSupabase.reset()
    _resetTombstones()
    serverTime.now = '2026-10-12T18:00:00.000Z'
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.mocked(syncQueue.enqueue).mockImplementation(invoke)
  })

  it('a pull-up logged on one device reads as bodyweight, not "0 lbs", on another', async () => {
    setActivePinia(createPinia())
    useBodyweightStore().addEntry(BW)
    const phone = useWorkoutStore()
    await phone.init(USER)
    const id = phone.addExercise('Pull-up', ['Pull'])!
    phone.setExerciseBodyweightLoaded(id, true)
    phone.logSet(id, 0, 12)
    await settle()
    const logged = phone.exercises[0].sets[0]
    // The phone itself was always right; the question is everyone else.
    expect(logged.bodyweight).toBe(BW)
    expect(serverRow(logged.id).bodyweight).toBe(BW)

    const tablet = await freshDevice()

    const exercise = tablet.exercises[0]
    const set = localCopy(tablet, logged.id)
    expect(set.bodyweight).toBe(BW)
    // What the lifter sees on every history row, and what every volume sum adds.
    expect(formatSetLoad(set, exercise, LBS)).toBe('Bodyweight')
    expect(effectiveSetWeight(set, exercise)).toBe(BW)
  })

  it('an added load keeps its fold too: "+25 lbs", counted as 195', async () => {
    setActivePinia(createPinia())
    useBodyweightStore().addEntry(BW)
    const phone = useWorkoutStore()
    await phone.init(USER)
    const id = phone.addExercise('Weighted Dip', ['Push'])!
    phone.setExerciseBodyweightLoaded(id, true)
    phone.logSet(id, 25, 6)
    await settle()

    const tablet = await freshDevice()

    const exercise = tablet.exercises[0]
    const set = exercise.sets[0]
    expect(formatSetLoad(set, exercise, LBS)).toBe('+25 lbs')
    expect(effectiveSetWeight(set, exercise)).toBe(25 + BW)
    // The e1RM that synced was folded from this load, so the two now agree.
    expect(set.estimated1RM).toBe(epley(25 + BW, 6))
  })

  it("fills a row the server holds without one from the device that captured it, and only that column", async () => {
    fakeSupabase.seed('exercises', [serverExercise()])
    fakeSupabase.seed('sets', [serverSet()])
    seedLocal([localSet({ bodyweight: BW })])
    setActivePinia(createPinia())

    const phone = useWorkoutStore()
    await phone.init(USER)
    await settle()

    expect(serverRow('set-1').bodyweight).toBe(BW)
    // The server's copy stood (it matches the phone's in every other column),
    // so re-sending the whole row would only re-assert this fetch's snapshot
    // over anything another device writes after it.
    expect(fakeSupabase.upsertsFor('sets')).toEqual([])
    expect(fakeSupabase.updatesFor('sets').map(c => c.data)).toEqual([{ bodyweight: BW }])
    // The phone kept its capture, in memory and on disk — the NULL did not win.
    expect(localCopy(phone, 'set-1').bodyweight).toBe(BW)
    const persisted = JSON.parse(localStorageMock.getItem('workout-exercises')!) as Exercise[]
    expect(persisted[0].sets[0].bodyweight).toBe(BW)

    const tablet = await freshDevice()
    expect(localCopy(tablet, 'set-1').bodyweight).toBe(BW)
  })

  it('fills the sets that share a weigh-in with one queued write, a chunk of ids per request', async () => {
    // Turning the flag on stamps one value onto every earlier set of the
    // exercise, so an account owes its fills in a few large groups. One queued
    // write per set would drain at the queue's 200 writes a minute, with the
    // lifter's own new sets waiting behind them.
    const ids = Array.from({ length: 205 }, (_, i) => `set-${i}`)
    const dateOf = (i: number) => `2026-10-12T23:59:12.${String(i).padStart(3, '0')}Z`
    const OTHER_DAY = '2026-10-11T23:59:30.000Z'
    fakeSupabase.seed('exercises', [serverExercise()])
    fakeSupabase.seed('sets', [
      ...ids.map((id, i) => serverSet({ id, date: dateOf(i) })),
      serverSet({ id: 'set-earlier', date: OTHER_DAY }),
    ])
    seedLocal([
      ...ids.map((id, i) => localSet({ id, date: dateOf(i), bodyweight: BW })),
      localSet({ id: 'set-earlier', date: OTHER_DAY, bodyweight: 172 }),
    ])
    setActivePinia(createPinia())

    await useWorkoutStore().init(USER)
    await settle()

    const fillKeys = vi.mocked(syncQueue.enqueue).mock.calls
      .map(([key]) => key)
      .filter(key => key.startsWith('set-bodyweight:'))
    expect(fillKeys.sort()).toEqual(['set-bodyweight:170', 'set-bodyweight:172'])
    const requests = fakeSupabase.updatesFor('sets').map(c => ({
      bodyweight: (c.data as { bodyweight: number }).bodyweight,
      ids: (c.filters.id as { __in: string[] }).__in.length,
    }))
    expect(requests.filter(r => r.bodyweight === BW).map(r => r.ids)).toEqual([100, 100, 5])
    expect(requests.filter(r => r.bodyweight === 172).map(r => r.ids)).toEqual([1])
    expect(fakeSupabase.tables.sets.filter(r => r.bodyweight === null)).toEqual([])
  })

  it('stops filling once the column holds the capture', async () => {
    fakeSupabase.seed('exercises', [serverExercise()])
    fakeSupabase.seed('sets', [serverSet()])
    seedLocal([localSet({ bodyweight: BW })])
    setActivePinia(createPinia())
    const phone = useWorkoutStore()
    await phone.init(USER)
    await settle()
    expect(fakeSupabase.updatesFor('sets')).toHaveLength(1)

    serverTime.now = '2026-10-12T19:00:00.000Z'
    await phone._fetchFromSupabase()
    await settle()

    expect(fakeSupabase.updatesFor('sets')).toHaveLength(1)
    expect(fakeSupabase.upsertsFor('sets')).toEqual([])
    expect(localCopy(phone, 'set-1').bodyweight).toBe(BW)
  })

  it('a fill never replaces a capture that reached the server first', async () => {
    fakeSupabase.seed('exercises', [serverExercise()])
    fakeSupabase.seed('sets', [serverSet()])
    seedLocal([localSet({ bodyweight: BW })])
    // Hold the fill in the queue so another device's write can land first.
    const held: (() => PromiseLike<unknown>)[] = []
    vi.mocked(syncQueue.enqueue).mockImplementation((key, op) => {
      if (key.startsWith('set-bodyweight:')) held.push(op)
      else invoke(key, op)
    })
    setActivePinia(createPinia())

    const phone = useWorkoutStore()
    await phone.init(USER)
    expect(held).toHaveLength(1)
    serverRow('set-1').bodyweight = 172
    await Promise.all(held.map(op => op()))

    expect(serverRow('set-1').bodyweight).toBe(172)
  })

  it('a device that has not learned a capture does not erase it by re-sending the set', async () => {
    // The phone's fill landed after the tablet's last sync, so the tablet's copy
    // has no capture. Turning the flag off rewrites and re-sends every set.
    fakeSupabase.seed('exercises', [serverExercise()])
    fakeSupabase.seed('sets', [serverSet({ bodyweight: BW })])
    seedLocal([localSet()])
    setActivePinia(createPinia())

    const tablet = useWorkoutStore()
    tablet.bindUser(USER)
    tablet.setExerciseBodyweightLoaded(EX, false)
    await settle()

    expect(fakeSupabase.upsertsFor('sets')).toHaveLength(1)
    expect(serverRow('set-1').bodyweight).toBe(BW)

    // The next sync hands the tablet the capture, so turning the flag back on
    // folds the load the set was logged at rather than today's weigh-in.
    await tablet._fetchFromSupabase()
    await settle()
    expect(localCopy(tablet, 'set-1').bodyweight).toBe(BW)
  })
})
