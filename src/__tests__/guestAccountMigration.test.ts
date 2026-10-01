/**
 * Regression: a guest who signs up must end up with ONE copy of their history
 * on the server (LIFT-1534).
 *
 * On sign-in, `useAuth.initStores` runs `migrateLocalStorageToSupabase` and
 * then each store's `init()`, whose `_fetchFromSupabase` pushes every local row
 * it cannot find on the server. The migration minted a fresh UUID for every
 * exercise and set it uploaded, so the sync found none of the local ids and
 * pushed the whole history again. The account held two copies of everything.
 * `deduplicateByName` and `deduplicateSets` hid that on screen, because the
 * copies matched to the timestamp, until the first edit: an edited set left its
 * stale twin behind as a visible duplicate on every other device, and a deleted
 * set came back from its twin on the next fetch.
 *
 * Why the suite missed it: `migrate.test.ts` checked the rows the migration
 * sent against a hand-rolled mock, the sync tests began from an empty or seeded
 * server, and nothing ever ran the two against the same server. The minted ids
 * were even asserted as expected output. Every test here runs the real
 * migration and the real stores, through the real sync queue, against one
 * `createFakeSupabase`, and asserts on what the server holds.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { getLocalStorageMock } from './helpers'

const { fakeSupabase } = await vi.hoisted(async () => {
  const { createFakeSupabase } = await import('./fakeSupabase')
  return { fakeSupabase: createFakeSupabase({ mode: 'ok' }) }
})

vi.mock('../lib/supabase', () => ({
  supabase: fakeSupabase,
  isPreviewMode: { value: false },
}))

// IndexedDB isn't available under happy-dom and isn't the subject here; the
// queue's timing, retries and journal bookkeeping still run for real.
vi.mock('../lib/durableStorage', () => ({
  backupToIDB: vi.fn(),
  restoreFromIDB: vi.fn(() => Promise.resolve(null)),
}))

vi.mock('../lib/logger', () => ({
  logError: vi.fn(), logWarn: vi.fn(), logInfo: vi.fn(),
}))

import { useWorkoutStore, type Exercise, type WorkoutSet } from '../stores/workout'
import { useBodyweightStore, type BodyweightEntry } from '../stores/bodyweight'
import { migrateLocalStorageToSupabase } from '../lib/migrate'
import { syncQueue, syncStatus, _resetRateLimit, _resetCircuitBreaker } from '../lib/syncQueue'
import { _resetTombstones } from '../lib/tombstones'

const localStorageMock = getLocalStorageMock()
const USER = 'user-1534'

/** Drain the queue's debounce and retries, and the microtask chains they start. */
const tick = () => vi.runAllTimersAsync()

/** What the guest logged before signing up: straight sets, a lone set, two weigh-ins. */
function guestHistory(): { exercises: Exercise[]; entries: BodyweightEntry[] } {
  const benchSet = (n: number): WorkoutSet => ({
    id: `s-bench-${n}`,
    date: `2026-09-20T23:59:1${n}.000Z`,
    weight: 135,
    reps: 5,
    estimated1RM: 158,
    createdAt: `2026-09-20T18:1${n}:00.000Z`,
  })
  return {
    exercises: [
      {
        id: 'ex-bench', name: 'Bench Press', tags: ['Push'], updated_at: '2026-09-20T18:30:00.000Z',
        sets: [benchSet(1), benchSet(2), benchSet(3)],
      },
      {
        id: 'ex-squat', name: 'Squat', tags: ['Legs'], updated_at: '2026-09-21T18:30:00.000Z',
        sets: [{
          id: 's-squat-1', date: '2026-09-21T23:59:40.000Z', weight: 185, reps: 5,
          estimated1RM: 216, createdAt: '2026-09-21T18:05:00.000Z',
        }],
      },
    ],
    entries: [
      { id: 'bw-1', date: '2026-09-19T23:59:30.000Z', weight: 181.5, updated_at: '2026-09-19T08:00:00.000Z' },
      { id: 'bw-2', date: '2026-09-20T23:59:30.000Z', weight: 181, updated_at: '2026-09-20T08:00:00.000Z' },
    ],
  }
}

function seedDevice(history: { exercises: Exercise[]; entries: BodyweightEntry[] }) {
  localStorageMock.setItem('workout-exercises', JSON.stringify(history.exercises))
  localStorageMock.setItem('bodyweight-entries', JSON.stringify(history.entries))
}

/**
 * Sign the guest in, in the order `useAuth.initStores` runs: the migration,
 * the journal replay, then each store's first fetch and the pushes it queues.
 */
async function signUp() {
  const workout = useWorkoutStore()
  const bodyweight = useBodyweightStore()
  await migrateLocalStorageToSupabase(USER)
  await syncQueue.rehydrate()
  await Promise.all([workout.init(USER), bodyweight.init(USER)])
  await tick()
  return { workout, bodyweight }
}

/** A second phone on the same account, or this one after a reinstall. */
async function anotherDevice() {
  localStorageMock.clear()
  _resetTombstones()
  setActivePinia(createPinia())
  const workout = useWorkoutStore()
  await workout.init(USER)
  return workout
}

const serverIds = (table: string) => fakeSupabase.tables[table].map(r => r.id).sort()

const liveServerIds = (table: string) =>
  fakeSupabase.tables[table].filter(r => r.deleted_at == null).map(r => r.id).sort()

/** "135×5"-style summaries of an exercise's sets, in order. */
const setSummaries = (exercise: Exercise | undefined) =>
  (exercise?.sets ?? []).map(s => `${s.weight}×${s.reps}`)

describe('signing a guest into an empty account (LIFT-1534)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-01T12:00:00.000Z'))
    localStorageMock.clear()
    fakeSupabase.reset()
    _resetTombstones()
    syncQueue.clear()
    _resetRateLimit()
    _resetCircuitBreaker()
    syncStatus.value = 'synced'
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stores each exercise, set and weigh-in once, under the id the device already uses', async () => {
    seedDevice(guestHistory())

    const { workout, bodyweight } = await signUp()

    // Before the fix each table held the migration's copies (fresh ids) AND
    // the local originals the first sync pushed after it.
    expect(serverIds('exercises')).toEqual(['ex-bench', 'ex-squat'])
    expect(serverIds('sets')).toEqual(['s-bench-1', 's-bench-2', 's-bench-3', 's-squat-1'])
    expect(serverIds('bodyweight_entries')).toEqual(['bw-1', 'bw-2'])
    // And the device still knows every row by the id it had.
    expect(workout.exercises.map(e => e.id).sort()).toEqual(['ex-bench', 'ex-squat'])
    expect(bodyweight.entries.map(e => e.id).sort()).toEqual(['bw-1', 'bw-2'])
  })

  it('leaves the first sync nothing to push', async () => {
    seedDevice(guestHistory())

    await signUp()

    // One request per table: the migration's. The sync found every local id
    // on the server, where it used to push the whole history a second time.
    expect(fakeSupabase.upsertsFor('exercises')).toHaveLength(1)
    expect(fakeSupabase.upsertsFor('sets')).toHaveLength(1)
    expect(fakeSupabase.upsertsFor('bodyweight_entries')).toHaveLength(1)
  })

  it('applies a later edit to the only copy, so another device sees the set once', async () => {
    seedDevice(guestHistory())
    const { workout } = await signUp()

    workout.updateSet('ex-bench', 's-bench-1', 145, 5)
    await tick()

    expect(fakeSupabase.tables.sets.map(r => `${r.id} ${r.weight}×${r.reps}`).sort()).toEqual([
      's-bench-1 145×5', 's-bench-2 135×5', 's-bench-3 135×5', 's-squat-1 185×5',
    ])
    const other = await anotherDevice()
    // Before the fix the migrated twin kept 135×5, no longer matched the edited
    // set, and showed up as a fourth bench set.
    expect(setSummaries(other.exercises.find(e => e.name === 'Bench Press'))).toEqual(['145×5', '135×5', '135×5'])
  })

  it('keeps a set deleted after sign-up deleted on another device', async () => {
    seedDevice(guestHistory())
    const { workout } = await signUp()

    workout.deleteSet('ex-squat', 's-squat-1')
    await tick()

    expect(liveServerIds('sets')).toEqual(['s-bench-1', 's-bench-2', 's-bench-3'])
    const other = await anotherDevice()
    // Before the fix the migrated twin was still live and came straight back.
    expect(setSummaries(other.exercises.find(e => e.name === 'Squat'))).toEqual([])
  })

  it('uploads nothing into an account that already holds data, where a local row may be stale', async () => {
    // This device synced Bench Press before; another device has renamed it
    // since. The migration now writes under the ids the sync uses, so without
    // the empty-account guard it would upsert the stale local copy over the
    // rename. The shared fake used to answer the guard's count query with no
    // count at all, which read as an empty account, so this was untestable.
    fakeSupabase.seed('exercises', [{
      id: 'ex-bench', user_id: USER, name: 'Paused Bench Press', tags: ['Push'],
      created_at: '2026-09-20T18:00:00.000Z', updated_at: '2026-09-30T09:00:00.000Z', deleted_at: null,
    }])
    seedDevice(guestHistory())

    await migrateLocalStorageToSupabase(USER)

    expect(fakeSupabase.calls.filter(c => c.op !== 'select')).toEqual([])
    expect(fakeSupabase.tables.exercises.map(r => r.name)).toEqual(['Paused Bench Press'])
  })

  it('keeps a weigh-in deleted after sign-up deleted', async () => {
    seedDevice(guestHistory())
    const { bodyweight } = await signUp()

    bodyweight.deleteEntry('bw-1')
    await tick()

    expect(liveServerIds('bodyweight_entries')).toEqual(['bw-2'])
  })
})

// ── The migration writes what the sync would have written ────────────
//
// The migration builds its rows itself (`migrate.ts`), beside the store's
// producers (`_buildExerciseUpsert`, `_enqueueSetUpsert`, `_enqueueEntryUpsert`),
// so the two can drift. Drift is not cosmetic: the server stamps `updated_at`
// as the rows land, its copy wins the first merge on the device, and a column
// the migration left out is erased locally by that merge. This drives one
// history through each path into an empty server and requires the same rows,
// from a fixture that sets every field the domain types declare.

const here = dirname(fileURLToPath(import.meta.url))

/** Property names declared in `export interface <name> { … }`, comments stripped. */
function interfaceFields(file: string, name: string): string[] {
  const source = readFileSync(resolve(here, file), 'utf-8')
  const start = source.indexOf(`export interface ${name} {`)
  if (start === -1) return []
  const open = source.indexOf('{', start)
  let depth = 0
  let end = open
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}' && --depth === 0) { end = i; break }
  }
  const body = source.slice(open + 1, end).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  return [...body.matchAll(/^\s*([A-Za-z_$][\w$]*)\??\s*:/gm)].map(m => m[1])
}

/**
 * Fields no producer sends, which a fully configured fixture may leave out.
 * `updated_at` is a merge stamp the server's trigger maintains (LIFT-1401),
 * wherever it is declared. `sample` rows are the onboarding demo, which the
 * sync never pushes (LIFT-1527 decides what the migration does with them).
 * `mergedFrom` is recomputed on every fetch.
 */
const UNSENT_FIELDS = ['updated_at', 'sample', 'mergedFrom']

/** One history with every field set, plus the shapes that omit a column. */
function configuredHistory(): { exercises: Exercise[]; entries: BodyweightEntry[] } {
  return {
    exercises: [
      {
        id: 'ex-dip', name: 'Weighted Dip', tags: ['Push', 'Chest'],
        inputMode: 'plates', barWeight: 20, plateCountMode: 'total', intensityMaxReps: 6,
        equipment: 'bodyweight', gyms: ['Home Gym'], notes: 'lean forward',
        bodyweightLoaded: true, archived_at: '2026-09-25T00:00:00.000Z',
        updated_at: '2026-09-25T00:00:00.000Z',
        sets: [
          {
            id: 's-dip-1', date: '2026-09-24T23:59:10.000Z', weight: 25, reps: 8, estimated1RM: 263,
            createdAt: '2026-09-24T18:02:00.000Z', attemptedNextRep: true, rpe: 9, bodyweight: 180,
          },
          // A legacy set: no log time, so the server's own `created_at` stands.
          { id: 's-dip-legacy', date: '2026-03-01T12:00:00.000Z', weight: 0, reps: 10, estimated1RM: 240, bodyweight: 180 },
        ],
      },
      // Nothing configured: `input_mode` is left to its DEFAULT.
      {
        id: 'ex-curl', name: 'Curl', tags: [], updated_at: '2026-09-22T00:00:00.000Z',
        sets: [{ id: 's-curl-1', date: '2026-09-22T23:59:05.000Z', weight: 30, reps: 12, estimated1RM: 42 }],
      },
    ],
    entries: [{ id: 'bw-1', date: '2026-09-24T23:59:30.000Z', weight: 180, updated_at: '2026-09-24T08:00:00.000Z' }],
  }
}

/** Every row the server holds, per synced table, in id order. */
function serverState() {
  const byId = (table: string) => [...fakeSupabase.tables[table]].sort((a, b) => a.id.localeCompare(b.id))
  return { exercises: byId('exercises'), sets: byId('sets'), bodyweight_entries: byId('bodyweight_entries') }
}

describe('the migration writes exactly the rows the sync would write (LIFT-1534)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-01T12:00:00.000Z'))
    localStorageMock.clear()
    fakeSupabase.reset()
    _resetTombstones()
    syncQueue.clear()
    _resetRateLimit()
    _resetCircuitBreaker()
    syncStatus.value = 'synced'
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sets every field the domain types declare (fixture completeness)', () => {
    // vitest does not typecheck, so this is what makes a field added to one of
    // these interfaces reach the comparison below instead of passing it by.
    const { exercises: [dip], entries: [entry] } = configuredHistory()
    const exerciseFields = interfaceFields('../stores/workout.ts', 'Exercise')
    const setFields = interfaceFields('../stores/workout.ts', 'WorkoutSet')
    const entryFields = interfaceFields('../stores/bodyweight.ts', 'BodyweightEntry')
    // Anchors, so an extractor that matched nothing cannot pass vacuously.
    expect(exerciseFields).toEqual(expect.arrayContaining(['id', 'tags', 'barWeight', 'mergedFrom']))
    expect(setFields).toEqual(expect.arrayContaining(['id', 'estimated1RM', 'createdAt', 'rpe']))
    expect(entryFields).toEqual(expect.arrayContaining(['id', 'weight', 'updated_at']))

    const unset = (fields: string[], row: object) => fields.filter(f => !UNSENT_FIELDS.includes(f) && !(f in row))
    expect(unset(exerciseFields, dip)).toEqual([])
    expect(unset(setFields, dip.sets[0])).toEqual([])
    expect(unset(entryFields, entry)).toEqual([])
  })

  it('puts the same rows on the server as the sync pushes on its own', async () => {
    // The sync alone, into an empty account: every row is local-only and pushed.
    seedDevice(configuredHistory())
    await Promise.all([useWorkoutStore().init(USER), useBodyweightStore().init(USER)])
    await tick()
    const viaSync = serverState()
    expect(viaSync.exercises).toHaveLength(2)
    expect(viaSync.sets).toHaveLength(3)

    // The migration alone, from the same device state into a fresh account.
    localStorageMock.clear()
    fakeSupabase.reset()
    _resetTombstones()
    setActivePinia(createPinia())
    seedDevice(configuredHistory())
    await migrateLocalStorageToSupabase(USER)

    expect(serverState()).toEqual(viaSync)
  })

  it('loses nothing on the device when the server copy wins the first merge', async () => {
    // The rows the migration writes carry a server `updated_at` later than any
    // local edit, so the sign-in fetch replaces the local exercise with the
    // server's. Whatever the migration did not send would vanish here.
    const history = configuredHistory()
    seedDevice(history)

    const { workout, bodyweight } = await signUp()

    const withoutStamp = <T extends { updated_at?: string }>(rows: T[]) =>
      rows.map(({ updated_at: _stamp, ...rest }) => rest)
    expect(withoutStamp(workout.exercises)).toMatchObject(withoutStamp(history.exercises))
    expect(withoutStamp(bodyweight.entries)).toEqual(withoutStamp(history.entries))
  })
})
