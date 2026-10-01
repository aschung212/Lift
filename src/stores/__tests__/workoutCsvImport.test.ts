/**
 * Regression: a CSV import must become the user's synced history (LIFT-1526).
 *
 * Settings → Data → Import created every exercise with
 * `addExercise(…, { sync: false })`. The import predates the `sample` flag by a
 * day; when #232 introduced it, `sync: false` on `addExercise` started meaning
 * "onboarding sample data, never synced", and every push in
 * `_fetchFromSupabase` skips a sample row. So an imported Strong / Hevy /
 * Logbook history never left the importing device. A second device never saw
 * it, and a reinstall lost it, until the user happened to edit each exercise.
 *
 * Why the suite missed it: `csvImport.test.ts` covers the parser alone, and
 * nothing anywhere drove an import into the store and asked the SERVER what it
 * held. These tests run the real store and the real sync queue (debounce, rate
 * limiter, retries) against `createFakeSupabase`, and assert on `fake.tables`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'

const { fakeSupabase } = await vi.hoisted(async () => {
  const { createFakeSupabase } = await import('../../__tests__/fakeSupabase')
  return { fakeSupabase: createFakeSupabase({ mode: 'ok' }) }
})

vi.mock('../../lib/supabase', () => ({
  supabase: fakeSupabase,
  isPreviewMode: { value: false },
}))

// IndexedDB isn't available under happy-dom and isn't the subject here.
vi.mock('../../lib/durableStorage', () => ({
  backupToIDB: vi.fn(),
  restoreFromIDB: vi.fn(() => Promise.resolve(null)),
}))

vi.mock('../../lib/logger', () => ({
  logError: vi.fn(), logWarn: vi.fn(), logInfo: vi.fn(),
}))

import { useWorkoutStore } from '../workout'
import { syncQueue, syncStatus, _resetRateLimit, _resetCircuitBreaker } from '../../lib/syncQueue'
import { _resetTombstones } from '../../lib/tombstones'
import { importCSV } from '../../lib/csvImport'
import { BULK_UPSERT_CHUNK } from '../../lib/bulkUpsert'
import { setDayKey } from '../../lib/dates'

const localStorageMock = getLocalStorageMock()
const USER = 'user-1526'

/** Drain the queue's debounce, retries and the microtask chains they start. */
const tick = () => vi.runAllTimersAsync()

const STRONG_HEADER = 'Date,Workout Name,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE'

/** A Strong export holding two lifts this account has never seen. */
const STRONG_CSV = `${STRONG_HEADER}
2026-03-02,Push,Bench Press (Barbell),1,185,5,,,,,8
2026-03-02,Push,Bench Press (Barbell),2,185,5,,,,,8.5
2026-03-04,Legs,Squat (Barbell),1,225,5,,,,,`

/**
 * A Strong export with `count` sets of one lift, one per row. Every row gets
 * its own weight: same-day sets are told apart only by `endOfDayISO`'s random
 * seconds and milliseconds, and hundreds of identical day/weight/reps rows would
 * eventually draw the same stamp and be collapsed by `deduplicateSets`.
 */
function strongCsvWithSets(name: string, count: number): string {
  const rows = Array.from({ length: count }, (_, i) => `2026-03-02,Push,${name},${i + 1},${100 + i / 2},5,,,,,`)
  return [STRONG_HEADER, ...rows].join('\n')
}

function serverRow(table: 'exercises' | 'sets', id: string) {
  return fakeSupabase.tables[table].find(r => r.id === id)
}

/** The upserts issued so far, in order, as `[table, rows-in-request]`. */
function upsertRequests(): [string, number][] {
  return fakeSupabase.calls
    .filter(c => c.op === 'upsert')
    .map(c => [c.table, Array.isArray(c.data) ? c.data.length : 1])
}

function withTZ(tz: string, fn: () => void) {
  const prev = process.env.TZ
  process.env.TZ = tz
  try {
    fn()
  } finally {
    process.env.TZ = prev
  }
}

describe('a CSV import is synced history, not onboarding sample data (LIFT-1526)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
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
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('creates real exercises and uploads them with every set', async () => {
    const store = useWorkoutStore()
    await store.init(USER)
    store.importHistory(importCSV(STRONG_CSV).exercises)

    // Nothing for the push filters to skip: this is what used to be `true`.
    expect(store.exercises.map(e => e.sample)).toEqual([undefined, undefined])

    await tick()

    expect(fakeSupabase.tables.exercises.map(r => r.name).sort())
      .toEqual(['Bench Press (Barbell)', 'Squat (Barbell)'])
    expect(fakeSupabase.tables.exercises.every(r => r.user_id === USER)).toBe(true)
    for (const exercise of store.exercises) {
      for (const set of exercise.sets) {
        expect(serverRow('sets', set.id)).toMatchObject({
          exercise_id: exercise.id, user_id: USER, weight: set.weight, reps: set.reps,
        })
      }
    }
    expect(fakeSupabase.tables.sets).toHaveLength(3)
  })

  it('reaches another device signed into the same account', async () => {
    const store = useWorkoutStore()
    await store.init(USER)
    store.importHistory(importCSV(STRONG_CSV).exercises)
    await tick()

    // A second phone, or this one after a reinstall: no local state at all.
    localStorageMock.clear()
    setActivePinia(createPinia())
    const other = useWorkoutStore()
    await other.init(USER)

    expect(other.exercises.map(e => [e.name, e.sets.length]).sort())
      .toEqual([['Bench Press (Barbell)', 2], ['Squat (Barbell)', 1]])
  })

  it('uploads as a few multi-row requests, exercise rows first', async () => {
    const SETS = BULK_UPSERT_CHUNK * 2 + 37
    const store = useWorkoutStore()
    await store.init(USER)
    store.importHistory(importCSV(strongCsvWithSets('Incline Press', SETS)).exercises)

    // One queued write for the whole import. One per row is what put a large
    // history behind the 200-per-minute rate limit.
    expect(syncQueue.pending).toBe(1)

    await tick()

    // The exercise row lands before any set that references it: the queue runs
    // a flush's ops concurrently, so a set sent alongside its exercise can lose
    // the race and fail the foreign key.
    expect(upsertRequests()).toEqual([
      ['exercises', 1],
      ['sets', BULK_UPSERT_CHUNK],
      ['sets', BULK_UPSERT_CHUNK],
      ['sets', 37],
    ])
    expect(fakeSupabase.tables.sets).toHaveLength(SETS)
  })

  it('appends to an exercise the account already has, without rewriting its row', async () => {
    fakeSupabase.seed('exercises', [{
      id: 'ex-bench', user_id: USER, name: 'Bench Press (Barbell)', tags: ['Push'],
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null,
    }])
    fakeSupabase.seed('sets', [{
      id: 's-old', user_id: USER, exercise_id: 'ex-bench', date: '2026-02-01T23:59:10.000Z',
      weight: 175, reps: 5, estimated_1rm: 204, created_at: '2026-02-01T18:00:00.000Z', deleted_at: null,
    }])
    const store = useWorkoutStore()
    await store.init(USER)

    // Strong spells it differently; the match is case-insensitive, as addExercise's is.
    store.importHistory(importCSV(STRONG_CSV.replaceAll('Bench Press (Barbell)', 'bench press (barbell)')).exercises)

    expect(store.exercises.map(e => e.name).sort()).toEqual(['Bench Press (Barbell)', 'Squat (Barbell)'])
    const bench = store.exercises.find(e => e.id === 'ex-bench')!
    expect(bench.sets).toHaveLength(3)

    await tick()

    // Only the new lift's row goes out; the existing one is not rewritten.
    expect(fakeSupabase.upsertsFor('exercises').flatMap(c => c.data as { name: string }[]).map(r => r.name))
      .toEqual(['Squat (Barbell)'])
    expect(fakeSupabase.tables.sets.filter(r => r.exercise_id === 'ex-bench')).toHaveLength(3)
  })

  it('keeps the RPE and "went for the next rep" the file carried', async () => {
    const csv = `# Logbook Export — 2026-09-30 — v1.0.0 — anon — weights in lbs
Exercise,Date,Weight (lbs),Reps,Estimated 1RM,Tags,RPE,Went For Next Rep
Weighted Dip,2026-09-28,45,8,57,Push;Chest,9,yes`
    const store = useWorkoutStore()
    await store.init(USER)
    store.importHistory(importCSV(csv).exercises)

    const [dip] = store.exercises
    expect(dip.tags).toEqual(['Push', 'Chest'])
    expect(dip.sets[0]).toMatchObject({ weight: 45, reps: 8, rpe: 9, attemptedNextRep: true })

    await tick()
    expect(serverRow('sets', dip.sets[0].id)).toMatchObject({ attempted_next_rep: true })
  })

  it('sends a set as it is when the upload runs, not as it was imported', async () => {
    const store = useWorkoutStore()
    await store.init(USER)
    store.importHistory(importCSV(STRONG_CSV).exercises)
    const bench = store.exercises.find(e => e.name === 'Bench Press (Barbell)')!
    const [edited, deleted] = bench.sets

    // Both inside the debounce window, so the import's upload has not run yet.
    store.updateSet(bench.id, edited.id, 190, 4)
    store.deleteSet(bench.id, deleted.id)
    await tick()

    // A snapshot taken at import time would land after the edit's own write
    // (the upload waits on the exercise row first) and put 185 back...
    expect(serverRow('sets', edited.id)).toMatchObject({ weight: 190, reps: 4 })
    // ...and would insert the deleted set after its soft-delete matched nothing.
    expect(serverRow('sets', deleted.id)).toBeUndefined()
  })

  it('is recovered, in bulk, by the next sync when the app closes before it uploads', async () => {
    const SETS = BULK_UPSERT_CHUNK + 100
    const store = useWorkoutStore()
    await store.init(USER)
    store.importHistory(importCSV(strongCsvWithSets('Front Squat', SETS)).exercises)

    // Killed inside the debounce window: the in-memory queue is gone, the
    // imported history is on disk.
    syncQueue.clear()
    setActivePinia(createPinia())
    const relaunched = useWorkoutStore()
    expect(relaunched.exercises[0].sets).toHaveLength(SETS)

    await relaunched.init(USER)
    await tick()

    expect(fakeSupabase.tables.sets).toHaveLength(SETS)
    // Through the same bulk path, not one queued write per set.
    expect(upsertRequests()).toEqual([
      ['exercises', 1],
      ['sets', BULK_UPSERT_CHUNK],
      ['sets', 100],
    ])
  })

  it('never batches a row that omits a NOT NULL column with one that sends it', async () => {
    // Local-only rows in both shapes each producer emits: an exercise with and
    // without `input_mode`, a set with and without a log time (`created_at`).
    localStorageMock.setItem('workout-exercises', JSON.stringify([
      {
        id: 'ex-plates', name: 'Bench Press (Barbell)', tags: [], inputMode: 'plates',
        updated_at: '2026-09-01T00:00:00.000Z',
        sets: [
          { id: 's-timed', date: '2026-09-01T23:59:01.000Z', weight: 185, reps: 5, estimated1RM: 216, createdAt: '2026-09-01T18:00:00.000Z' },
          { id: 's-legacy', date: '2026-08-01T23:59:01.000Z', weight: 180, reps: 5, estimated1RM: 210 },
        ],
      },
      { id: 'ex-numpad', name: 'Cable Fly', tags: [], updated_at: '2026-09-01T00:00:00.000Z', sets: [] },
    ]))
    const store = useWorkoutStore()
    await store.init(USER)
    await tick()

    // Mixed into one request, the absent value is written as NULL, which the
    // NOT NULL column rejects in production, failing every row in the request.
    expect(serverRow('exercises', 'ex-numpad')!.input_mode).toBe('numpad')
    expect(serverRow('exercises', 'ex-plates')!.input_mode).toBe('plates')
    expect(serverRow('sets', 's-legacy')!.created_at).not.toBeNull()
    expect(serverRow('sets', 's-timed')!.created_at).toBe('2026-09-01T18:00:00.000Z')
  })

  it('stops uploading once the session it was queued for has signed out', async () => {
    const store = useWorkoutStore()
    await store.init(USER)
    store.importHistory(importCSV(STRONG_CSV).exercises)

    // Sign-out lands while the upload is already under way.
    const from = fakeSupabase.from.bind(fakeSupabase)
    vi.spyOn(fakeSupabase, 'from').mockImplementation((table: string) => {
      if (table === 'exercises') store.$reset()
      return from(table)
    })
    await tick()

    expect(fakeSupabase.upsertsFor('sets')).toEqual([])
  })

  it.each([
    // 7:30 pm on 1 Apr in Los Angeles is already 2 Apr in UTC...
    ['America/Los_Angeles', '2026-04-02T02:30:00.000Z'],
    // ...and 8:30 am on 1 Apr in Tokyo is still 31 Mar.
    ['Asia/Tokyo', '2026-03-31T23:30:00.000Z'],
  ])('files a timestamped set under its local day in %s (#746)', (tz, instant) => {
    // The parser hands back a real instant for a date format it only
    // recognises through Date.parse. The import used to take slice(0, 10) of
    // it, the UTC day.
    withTZ(tz, () => {
      const store = useWorkoutStore()
      store.importHistory([{ name: 'Bench Press (Barbell)', tags: [], sets: [{ date: instant, weight: 135, reps: 5 }] }])
      const [set] = store.exercises[0].sets
      expect(setDayKey(set.date)).toBe('2026-04-01')
      expect(set.date.startsWith('2026-04-01T23:59')).toBe(true)
    })
  })
})

describe('imports an older build stranded as sample data (LIFT-1526)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorageMock.clear()
    fakeSupabase.reset()
    _resetTombstones()
    syncQueue.clear()
    _resetRateLimit()
    _resetCircuitBreaker()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('are released and uploaded on the next sync, while the onboarding demo stays local', async () => {
    const updatedAt = '2026-05-01T00:00:00.000Z'
    localStorageMock.setItem('workout-exercises', JSON.stringify([
      {
        id: 'demo-bench', name: 'Bench Press', tags: ['Push'], sample: true, updated_at: updatedAt,
        sets: [{ id: 'demo-s1', date: '2026-04-30T23:59:01.000Z', weight: 135, reps: 8, estimated1RM: 171 }],
      },
      {
        id: 'imported-rdl', name: 'Romanian Deadlift (Barbell)', tags: [], sample: true, updated_at: updatedAt,
        sets: [
          { id: 'rdl-s1', date: '2026-04-28T23:59:01.000Z', weight: 185, reps: 8, estimated1RM: 234 },
          { id: 'rdl-s2', date: '2026-04-28T23:59:02.000Z', weight: 185, reps: 8, estimated1RM: 234 },
        ],
      },
    ]))

    const store = useWorkoutStore()
    expect(store.exercises.find(e => e.id === 'demo-bench')!.sample).toBe(true)
    expect(store.exercises.find(e => e.id === 'imported-rdl')!.sample).toBeUndefined()

    await store.init(USER)
    await tick()

    expect(fakeSupabase.tables.exercises.map(r => r.id)).toEqual(['imported-rdl'])
    expect(fakeSupabase.tables.sets.map(r => r.id).sort()).toEqual(['rdl-s1', 'rdl-s2'])
  })
})
