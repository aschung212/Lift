/**
 * Regression: a set edited on one device must survive another device's next
 * sync (LIFT-1523).
 *
 * `_fetchFromSupabase` let the EXERCISE's last-write-wins comparison decide
 * every set inside it. A set edit never moves its exercise's timestamp on the
 * server — `updateSet` upserts the `sets` row and nothing else — so:
 *
 *   1. Devices A and B both hold set S (100 × 5) under exercise E, and both
 *      adopted E's server stamp T0.
 *   2. B corrects S to 105. Only the `sets` row is written; E stays at T0.
 *   3. A fetches. E ties at T0, a tie is a LOCAL win, S differs from the
 *      server's copy — so A re-upserts its stale 100 over B's correction.
 *
 * The fix resolves each set by the SET's stamp (`WorkoutSet.updated_at` vs the
 * `sets.updated_at` column `trg_sets_updated_at` maintains) and pushes only the
 * local copies that genuinely win. Set writes also stop bumping the exercise's
 * own stamp, which made a set edit outrank another device's rename.
 *
 * Why the suite missed it: no fixture could express "this set was edited
 * elsewhere". The shared fake never moves `updated_at`, every fetch-path test
 * seeded server set rows with none at all, and the set comparison never read
 * one — so a remote edit and the copy this device already held looked exactly
 * alike. These cases seed server rows whose set stamp has moved while the
 * exercise stamp has not, and the last ones run two real stores against a fake
 * built with `serverClock`, which stamps writes the way the trigger does.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

const { fakeSupabase, serverTime } = await vi.hoisted(async () => {
  const { createFakeSupabase } = await import('../../__tests__/fakeSupabase')
  // The server's now(): what `trg_*_updated_at` stamps a write with.
  const serverTime = { now: '2026-09-28T17:00:01.000Z' }
  return {
    fakeSupabase: createFakeSupabase({ mode: 'ok', serverClock: () => serverTime.now }),
    serverTime,
  }
})

vi.mock('../../lib/supabase', () => ({
  supabase: fakeSupabase,
  isPreviewMode: { value: false },
}))

// Synchronous syncQueue: every enqueued write lands on the fake, so the
// assertions read SERVER state — the revert was a write, not just a bad read.
vi.mock('../../lib/syncQueue', () => {
  const invoke = (_key: string, op: () => PromiseLike<unknown>) => {
    Promise.resolve(op()).catch(() => {})
  }
  return {
    syncQueue: { enqueue: vi.fn(invoke), enqueueDelete: vi.fn(invoke), clear: vi.fn() },
  }
})

vi.mock('../../lib/logger', () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}))

import { useWorkoutStore, type WorkoutSet } from '../workout'
import { epley } from '../../lib/epley'
import { _resetTombstones } from '../../lib/tombstones'

const USER = 'user-1523'
const EX = 'ex-bench'
/** The session day, as `endOfDayISO` writes it. */
const DATE = '2026-09-28T23:59:12.345Z'
/** The set was logged… */
const T_LOG = '2026-09-28T17:00:00.000Z'
/** …the server accepted it, and both devices adopted this stamp. */
const T0 = '2026-09-28T17:00:01.000Z'
/** Device B corrected the weight; the trigger stamped the `sets` row. */
const T1 = '2026-09-29T08:00:00.000Z'
/** Something later on this device. */
const T2 = '2026-09-29T12:00:00.000Z'

/** Let the synchronous syncQueue's microtask chains land on the fake. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

function serverExercise(overrides: Record<string, unknown> = {}) {
  return {
    id: EX, user_id: USER, name: 'Bench Press', tags: ['Push'],
    created_at: T_LOG,
    // B's set edit never touched this row — that is the whole defect.
    updated_at: T0,
    deleted_at: null,
    ...overrides,
  }
}

/** The server's copy of set-1 AFTER device B's correction. */
function serverSet(overrides: Record<string, unknown> = {}) {
  return {
    id: 'set-1', user_id: USER, exercise_id: EX,
    date: DATE, weight: 105, reps: 5, estimated_1rm: epley(105, 5),
    attempted_next_rep: false,
    created_at: T_LOG, updated_at: T1, deleted_at: null,
    ...overrides,
  }
}

/** This device's copy of set-1, as an earlier fetch left it. */
function localSet(overrides: Partial<WorkoutSet> = {}): WorkoutSet {
  return {
    id: 'set-1', date: DATE, weight: 100, reps: 5, estimated1RM: epley(100, 5),
    createdAt: T_LOG, updated_at: T0,
    ...overrides,
  }
}

function seedLocal(
  { exerciseUpdatedAt = T0, name = 'Bench Press', sets = [localSet()] }:
  { exerciseUpdatedAt?: string; name?: string; sets?: WorkoutSet[] } = {},
) {
  localStorageMock.setItem('workout-exercises', JSON.stringify([
    { id: EX, name, tags: ['Push'], updated_at: exerciseUpdatedAt, sets },
  ]))
}

const serverRow = (id: string) => fakeSupabase.tables.sets.find(r => r.id === id)!

/** Weights this device upserted for `id`, oldest first. */
function pushedWeights(id: string): unknown[] {
  return fakeSupabase.upsertsFor('sets')
    .map(c => c.data as { id: string; weight: number })
    .filter(row => row.id === id)
    .map(row => row.weight)
}

const localCopy = (store: ReturnType<typeof useWorkoutStore>, id: string) =>
  store.exercises.flatMap(e => e.sets).find(s => s.id === id)!

describe('a set edited on another device survives this device\'s sync (LIFT-1523)', () => {
  beforeEach(() => {
    localStorageMock.clear()
    fakeSupabase.reset()
    _resetTombstones()
    serverTime.now = T2
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('guards the guard — the exercise stamps tie while the set stamps differ', () => {
    // If a future edit collapses either half, every case below passes
    // vacuously: with the exercise newer remotely the old merge adopted the
    // server's sets anyway, and with equal set stamps there is no edit to lose.
    expect(serverExercise().updated_at).toBe(T0)
    expect(Date.parse(serverSet().updated_at)).toBeGreaterThan(Date.parse(localSet().updated_at!))
    expect(serverSet().weight).not.toBe(localSet().weight)
  })

  it("adopts another device's correction instead of reverting it", async () => {
    fakeSupabase.seed('exercises', [serverExercise()])
    fakeSupabase.seed('sets', [serverSet()])
    seedLocal()

    const store = useWorkoutStore()
    await store.init(USER)
    await settle()

    expect(localCopy(store, 'set-1').weight).toBe(105)
    expect(localCopy(store, 'set-1').updated_at).toBe(T1)
  })

  it('never pushes the stale copy back over the correction', async () => {
    fakeSupabase.seed('exercises', [serverExercise()])
    fakeSupabase.seed('sets', [serverSet()])
    seedLocal()

    const store = useWorkoutStore()
    await store.init(USER)
    await settle()

    expect(pushedWeights('set-1')).toEqual([])
    expect(serverRow('set-1').weight).toBe(105)
  })

  it('persists the adopted correction, so a reload does not resurrect the stale weight', async () => {
    fakeSupabase.seed('exercises', [serverExercise()])
    fakeSupabase.seed('sets', [serverSet()])
    seedLocal()

    const store = useWorkoutStore()
    await store.init(USER)
    await settle()
    store._reloadFromStorage()

    expect(localCopy(store, 'set-1').weight).toBe(105)
    expect(localCopy(store, 'set-1').updated_at).toBe(T1)
  })

  it('adopts the correction even when this device has logged on the exercise since', async () => {
    // `logSet` used to bump the exercise past the server's stamp, so this
    // device won the exercise outright — and pushed every set that differed.
    fakeSupabase.seed('exercises', [serverExercise()])
    fakeSupabase.seed('sets', [serverSet()])
    const newSet = {
      id: 'set-2', date: '2026-09-29T23:59:30.000Z', weight: 135, reps: 3,
      estimated1RM: epley(135, 3), createdAt: T2,
    }
    seedLocal({ exerciseUpdatedAt: T2, sets: [localSet(), newSet] })

    const store = useWorkoutStore()
    await store.init(USER)
    await settle()

    expect(localCopy(store, 'set-1').weight).toBe(105)
    expect(serverRow('set-1').weight).toBe(105)
    expect(pushedWeights('set-1')).toEqual([])
    // The set the server lacks is still pushed — that path is untouched.
    expect(pushedWeights('set-2')).toEqual([135])
  })

  it('a set persisted before stamps existed takes the server\'s copy', async () => {
    fakeSupabase.seed('exercises', [serverExercise()])
    fakeSupabase.seed('sets', [serverSet()])
    seedLocal({ sets: [localSet({ updated_at: undefined })] })

    const store = useWorkoutStore()
    await store.init(USER)
    await settle()

    expect(localCopy(store, 'set-1').weight).toBe(105)
    expect(pushedWeights('set-1')).toEqual([])
  })

  it('an exact stamp tie with different values goes to the server (an unbumped server-side change)', async () => {
    // Every local edit stamps the set, so a tie means the SERVER's values moved
    // without its stamp: a trigger-less catalog, or a trigger-suppressed
    // backfill. The opposite of `mergeEntities`' tie rule, on purpose.
    fakeSupabase.seed('exercises', [serverExercise()])
    fakeSupabase.seed('sets', [serverSet()])
    seedLocal({ sets: [localSet({ updated_at: T1 })] })

    const store = useWorkoutStore()
    await store.init(USER)
    await settle()

    expect(localCopy(store, 'set-1').weight).toBe(105)
    expect(pushedWeights('set-1')).toEqual([])
  })

  it('still keeps a genuinely newer local edit and pushes it', async () => {
    // The fix must not invert the rule: an offline correction made AFTER the
    // server's stamp is the one the lifter made last.
    fakeSupabase.seed('exercises', [serverExercise()])
    fakeSupabase.seed('sets', [serverSet()])
    seedLocal({ sets: [localSet({ weight: 110, estimated1RM: epley(110, 5), updated_at: T2 })] })

    const store = useWorkoutStore()
    await store.init(USER)
    await settle()

    expect(localCopy(store, 'set-1').weight).toBe(110)
    expect(pushedWeights('set-1')).toEqual([110])
    expect(serverRow('set-1').weight).toBe(110)
  })

  it("keeps a newer local edit when another device's exercise edit wins the exercise", async () => {
    // The mirror image: the remote ROW won (a rename elsewhere), and the old
    // merge handed it every set too — replacing an unflushed local edit with
    // the server's older copy and never pushing it.
    fakeSupabase.seed('exercises', [serverExercise({ name: 'Barbell Bench Press', updated_at: T1 })])
    fakeSupabase.seed('sets', [serverSet({ weight: 100, estimated_1rm: epley(100, 5), updated_at: T0 })])
    seedLocal({ sets: [localSet({ weight: 110, estimated1RM: epley(110, 5), updated_at: T2 })] })

    const store = useWorkoutStore()
    await store.init(USER)
    await settle()

    expect(store.exercises[0].name).toBe('Barbell Bench Press')
    expect(localCopy(store, 'set-1').weight).toBe(110)
    expect(pushedWeights('set-1')).toEqual([110])
    expect(serverRow('set-1').weight).toBe(110)
  })

  it("the same set in the server's own rendering is not a conflict", async () => {
    // Postgres renders a timestamptz as `…+00:00` and hands a `real` column
    // back at float4 precision (100 kg = 220.46226218487757 lbs comes back as
    // 220.46227). Compared as strings / doubles, every set this device logged
    // looked edited — the old `remote.date !== set.date` check re-upserted it.
    const kgInLbs = 220.46226218487757
    expect(220.46227).not.toBe(kgInLbs)
    expect(Math.fround(220.46227)).toBe(Math.fround(kgInLbs))

    fakeSupabase.seed('exercises', [serverExercise()])
    fakeSupabase.seed('sets', [serverSet({
      date: '2026-09-28T23:59:12.345+00:00',
      weight: 220.46227,
      estimated_1rm: Math.fround(epley(kgInLbs, 5)),
      updated_at: T0,
    })])
    // Stamped AFTER the server's copy: a device clock running ahead.
    seedLocal({ sets: [localSet({ weight: kgInLbs, estimated1RM: epley(kgInLbs, 5), updated_at: T2 })] })

    const store = useWorkoutStore()
    await store.init(USER)
    await settle()

    expect(pushedWeights('set-1')).toEqual([])
    // Taking the server's copy re-anchors this device to the server's clock,
    // so a skewed local stamp cannot outlive the first fetch after its write.
    expect(localCopy(store, 'set-1').updated_at).toBe(T0)
  })

  it("adopts another device's edit of a set this device shows inside a merged duplicate", async () => {
    // Two devices each created "Bench Press"; the merge shows b-0 under
    // uuid-a, but the server still files it under uuid-b (LIFT-1335). The old
    // per-exercise comparison saw b-0 as missing from uuid-a and pushed the
    // local copy — reverting the edit AND re-parenting the row.
    fakeSupabase.seed('exercises', [
      serverExercise({ id: 'uuid-a' }),
      serverExercise({ id: 'uuid-b', name: 'bench press' }),
    ])
    fakeSupabase.seed('sets', [
      serverSet({ id: 'a-0', exercise_id: 'uuid-a', date: '2026-09-28T23:59:01.000Z', weight: 100, updated_at: T0 }),
      serverSet({ id: 'a-1', exercise_id: 'uuid-a', date: '2026-09-28T23:59:02.000Z', weight: 100, updated_at: T0 }),
      serverSet({ id: 'b-0', exercise_id: 'uuid-b', date: '2026-09-28T23:59:03.000Z', weight: 140, updated_at: T1 }),
    ])
    localStorageMock.setItem('workout-exercises', JSON.stringify([{
      id: 'uuid-a', name: 'Bench Press', tags: ['Push'], updated_at: T0, mergedFrom: ['uuid-b'],
      sets: [
        localSet({ id: 'a-0', date: '2026-09-28T23:59:01.000Z' }),
        localSet({ id: 'a-1', date: '2026-09-28T23:59:02.000Z' }),
        localSet({ id: 'b-0', date: '2026-09-28T23:59:03.000Z', weight: 135, estimated1RM: epley(135, 5) }),
      ],
    }]))

    const store = useWorkoutStore()
    await store.init(USER)
    await settle()

    expect(localCopy(store, 'b-0').weight).toBe(140)
    expect(pushedWeights('b-0')).toEqual([])
    expect(serverRow('b-0')).toMatchObject({ exercise_id: 'uuid-b', weight: 140 })
  })

  it('pushes a newer local edit of a merged-duplicate set under the parent the server files it under', async () => {
    fakeSupabase.seed('exercises', [
      serverExercise({ id: 'uuid-a' }),
      serverExercise({ id: 'uuid-b', name: 'bench press' }),
    ])
    fakeSupabase.seed('sets', [
      serverSet({ id: 'a-0', exercise_id: 'uuid-a', date: '2026-09-28T23:59:01.000Z', weight: 100, updated_at: T0 }),
      serverSet({ id: 'a-1', exercise_id: 'uuid-a', date: '2026-09-28T23:59:02.000Z', weight: 100, updated_at: T0 }),
      serverSet({ id: 'b-0', exercise_id: 'uuid-b', date: '2026-09-28T23:59:03.000Z', weight: 135, updated_at: T0 }),
    ])
    localStorageMock.setItem('workout-exercises', JSON.stringify([{
      id: 'uuid-a', name: 'Bench Press', tags: ['Push'], updated_at: T0, mergedFrom: ['uuid-b'],
      sets: [
        localSet({ id: 'a-0', date: '2026-09-28T23:59:01.000Z' }),
        localSet({ id: 'a-1', date: '2026-09-28T23:59:02.000Z' }),
        localSet({ id: 'b-0', date: '2026-09-28T23:59:03.000Z', weight: 145, estimated1RM: epley(145, 5), updated_at: T2 }),
      ],
    }]))

    const store = useWorkoutStore()
    await store.init(USER)
    await settle()

    expect(pushedWeights('b-0')).toEqual([145])
    expect(serverRow('b-0')).toMatchObject({ exercise_id: 'uuid-b', weight: 145 })
  })
})

describe('set writes stamp the set, not the exercise (LIFT-1523)', () => {
  beforeEach(() => {
    localStorageMock.clear()
    fakeSupabase.reset()
    _resetTombstones()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(T2))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('updateSet stamps the set it edits and leaves its exercise alone', () => {
    seedLocal()
    const store = useWorkoutStore()

    store.updateSet(EX, 'set-1', 102.5, 5)

    expect(localCopy(store, 'set-1').updated_at).toBe(T2)
    expect(store.exercises[0].updated_at).toBe(T0)
  })

  it('the stamp survives a reload', () => {
    seedLocal()
    useWorkoutStore().updateSet(EX, 'set-1', 102.5, 5)

    setActivePinia(createPinia())
    expect(localCopy(useWorkoutStore(), 'set-1').updated_at).toBe(T2)
  })

  it('logSet leaves the new set unstamped and its exercise alone', () => {
    // A freshly logged set is not an edit of anything the server holds; with
    // no stamp it defers to the server's copy once that copy exists.
    seedLocal()
    const store = useWorkoutStore()

    store.logSet(EX, 135, 3, '2026-09-29')

    const logged = store.exercises[0].sets.at(-1)!
    expect(logged).not.toHaveProperty('updated_at')
    expect(store.exercises[0].updated_at).toBe(T0)
  })

  it('deleteSet leaves its exercise alone', () => {
    seedLocal()
    const store = useWorkoutStore()

    store.deleteSet(EX, 'set-1')

    expect(store.exercises[0].sets).toHaveLength(0)
    expect(store.exercises[0].updated_at).toBe(T0)
  })

  it('setExerciseBodyweightLoaded stamps every set it rewrites, and the exercise it edits', () => {
    seedLocal({ sets: [localSet(), localSet({ id: 'set-2', date: '2026-09-28T23:59:13.000Z' })] })
    const store = useWorkoutStore()

    store.setExerciseBodyweightLoaded(EX, true)

    expect(store.exercises[0].sets.map(s => s.updated_at)).toEqual([T2, T2])
    expect(store.exercises[0].updated_at).toBe(T2)
  })
})

describe('a set edit does not outrank another device\'s exercise edit (LIFT-1523)', () => {
  beforeEach(() => {
    localStorageMock.clear()
    fakeSupabase.reset()
    _resetTombstones()
    serverTime.now = T2
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("adopts the other device's rename instead of pushing the old name back", async () => {
    // B renamed the exercise at T1. This device then corrected a set, offline,
    // at T2. `updateSet` used to stamp the EXERCISE at T2, so it outranked the
    // rename and the next fetch upserted the old name over it.
    fakeSupabase.seed('exercises', [serverExercise({ name: 'Barbell Bench Press', updated_at: T1 })])
    fakeSupabase.seed('sets', [serverSet({ weight: 100, estimated_1rm: epley(100, 5), updated_at: T0 })])
    seedLocal()

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(T2))
    const store = useWorkoutStore()
    store.updateSet(EX, 'set-1', 102.5, 5)
    vi.useRealTimers()

    await store.init(USER)
    await settle()

    expect(store.exercises[0].name).toBe('Barbell Bench Press')
    expect(fakeSupabase.tables.exercises[0].name).toBe('Barbell Bench Press')
    const pushedNames = fakeSupabase.upsertsFor('exercises').map(c => (c.data as { name: string }).name)
    expect(pushedNames).not.toContain('Bench Press')
    // …and the set edit itself still reaches the server.
    expect(localCopy(store, 'set-1').weight).toBe(102.5)
    expect(serverRow('set-1').weight).toBe(102.5)
  })
})

describe('two devices converge on a set edit (LIFT-1523)', () => {
  beforeEach(() => {
    localStorageMock.clear()
    fakeSupabase.reset()
    _resetTombstones()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('an edit made on one device reaches the other, and the server keeps it', async () => {
    // Two real stores against one server whose clock stamps every write the way
    // `trg_*_updated_at` does — no hand-written "later" row anywhere.
    serverTime.now = T0
    fakeSupabase.seed('exercises', [serverExercise({ updated_at: T0 })])
    fakeSupabase.seed('sets', [serverSet({ weight: 100, estimated_1rm: epley(100, 5), updated_at: T0 })])

    const piniaA = createPinia()
    setActivePinia(piniaA)
    const deviceA = useWorkoutStore()
    await deviceA.init(USER)
    await settle()

    const piniaB = createPinia()
    setActivePinia(piniaB)
    const deviceB = useWorkoutStore()
    await deviceB.init(USER)
    await settle()

    // B corrects the set. The server accepts the write a moment later.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(T1))
    serverTime.now = '2026-09-29T08:00:01.000Z'
    deviceB.updateSet(EX, 'set-1', 105, 5)
    vi.useRealTimers()
    await settle()
    expect(serverRow('set-1').weight).toBe(105)

    // A syncs: it must adopt the correction, not revert it.
    serverTime.now = T2
    setActivePinia(piniaA)
    await deviceA._fetchFromSupabase()
    await settle()
    expect(serverRow('set-1').weight).toBe(105)
    expect(localCopy(deviceA, 'set-1').weight).toBe(105)

    // B syncs after A's push of its (unchanged) exercise row moved E's stamp:
    // the old merge handed B the reverted copy at exactly this point.
    setActivePinia(piniaB)
    await deviceB._fetchFromSupabase()
    await settle()
    expect(localCopy(deviceB, 'set-1').weight).toBe(105)

    // And it stays put on the next round of both.
    setActivePinia(piniaA)
    await deviceA._fetchFromSupabase()
    await settle()
    setActivePinia(piniaB)
    await deviceB._fetchFromSupabase()
    await settle()
    expect(serverRow('set-1').weight).toBe(105)
    expect(localCopy(deviceA, 'set-1').weight).toBe(105)
    expect(localCopy(deviceB, 'set-1').weight).toBe(105)
  })
})
