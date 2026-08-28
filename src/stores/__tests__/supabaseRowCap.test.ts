/**
 * Regression: collection reads must page past PostgREST's row cap (#1152).
 *
 * Production incident (2026-08-17): the owner's account held 1454 sets, the
 * newest logged 2026-08-15. `_fetchFromSupabase` issued `.select('*')` with no
 * `.range()`, so PostgREST returned the first `max_rows` (1000) rows under an
 * ASCENDING `created_at` sort and reported success. On a device whose
 * localStorage had just been cleared — the server dump being the only source of
 * truth — the app hydrated the OLDEST 1000 sets and showed training history
 * ending on the day set #1000 was written, five weeks stale, with a
 * "4 weeks since your last workout" banner over the top.
 *
 * Nothing was lost server-side, which is what made it so quiet: no error, no
 * failed sync, no lost write. Just a read that returned less than it should and
 * said it was fine.
 *
 * Why nothing caught it: `createFakeSupabase` returned every seeded row
 * regardless of any cap, so the unpaged read looked complete under test, and no
 * fixture anywhere in the suite came within an order of magnitude of 1000 rows.
 * These tests seed PAST the cap and assert the store hydrates everything.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

const { fakeSupabase } = await vi.hoisted(async () => {
  const { createFakeSupabase } = await import('../../__tests__/fakeSupabase')
  // Default maxRows — the real 1000-row PostgREST cap.
  return { fakeSupabase: createFakeSupabase({ mode: 'ok' }) }
})

vi.mock('../../lib/supabase', () => ({
  supabase: fakeSupabase,
  isPreviewMode: { value: false },
}))

vi.mock('../../lib/syncQueue', () => ({
  syncQueue: { enqueue: vi.fn(), enqueueDelete: vi.fn(), clear: vi.fn() },
}))

vi.mock('../../lib/logger', () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}))

import { useWorkoutStore } from '../workout'
import { useBodyweightStore } from '../bodyweight'
import { SUPABASE_MAX_ROWS } from '../../lib/supabasePagination'

const USER = 'user-1152'

/** Sets with strictly increasing timestamps so none collapse under set dedup. */
function seedSets(exerciseId: string, count: number, startDay: string) {
  const base = new Date(`${startDay}T00:00:00.000Z`).getTime()
  return Array.from({ length: count }, (_, i) => ({
    id: `set-${exerciseId}-${i}`,
    user_id: USER,
    exercise_id: exerciseId,
    // One set per hour keeps every (date|weight|reps) tuple distinct.
    date: new Date(base + i * 3600_000).toISOString(),
    weight: 135 + (i % 20) * 5,
    reps: 5 + (i % 5),
    estimated_1rm: 200 + (i % 50),
    created_at: new Date(base + i * 3600_000).toISOString(),
    deleted_at: null,
  }))
}

describe('Supabase collection reads page past the row cap (#1152)', () => {
  beforeEach(() => {
    localStorageMock.clear()
    fakeSupabase.reset()
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('the fake enforces the real cap — an unpaged select truncates here too', async () => {
    // Guards the guard: if this ever returns everything, every assertion below
    // passes vacuously and the bug can ship again.
    fakeSupabase.seed('sets', seedSets('ex-1', 1454, '2026-01-01'))
    const { data } = await fakeSupabase.from('sets').select('*').eq('user_id', USER)

    expect((data as unknown[]).length).toBe(SUPABASE_MAX_ROWS)
  })

  it('hydrates all 1454 sets, not the first 1000 (the production case)', async () => {
    fakeSupabase.seed('exercises', [{
      id: 'ex-1', user_id: USER, name: 'Bench Press', tags: ['Push'],
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
      deleted_at: null,
    }])
    fakeSupabase.seed('sets', seedSets('ex-1', 1454, '2026-01-01'))

    const store = useWorkoutStore()
    await store.init(USER)

    const sets = store.exercises.flatMap(ex => ex.sets)
    expect(sets).toHaveLength(1454)
    // The tail is the part that used to vanish — assert it explicitly rather
    // than trusting the count, which a duplicated page would also satisfy.
    expect(sets.some(s => s.id === 'set-ex-1-1453')).toBe(true)
    expect(new Set(sets.map(s => s.id)).size).toBe(1454)
  })

  it('the newest set survives the fetch — the banner said "4 weeks since your last workout"', async () => {
    fakeSupabase.seed('exercises', [{
      id: 'ex-1', user_id: USER, name: 'Bench Press', tags: [],
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
      deleted_at: null,
    }])
    const sets = seedSets('ex-1', 1454, '2026-01-01')
    const newest = sets[sets.length - 1].date
    fakeSupabase.seed('sets', sets)

    const store = useWorkoutStore()
    await store.init(USER)

    const dates = store.exercises.flatMap(ex => ex.sets).map(s => s.date).sort()
    expect(dates[dates.length - 1]).toBe(newest)
  })

  it('pages sets in max_rows-sized windows rather than one unbounded read', async () => {
    fakeSupabase.seed('exercises', [{
      id: 'ex-1', user_id: USER, name: 'Bench Press', tags: [],
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
      deleted_at: null,
    }])
    fakeSupabase.seed('sets', seedSets('ex-1', 1454, '2026-01-01'))

    const store = useWorkoutStore()
    await store.init(USER)

    const setReads = fakeSupabase.selectsFor('sets')
    expect(setReads.length).toBeGreaterThanOrEqual(2)
    expect(setReads[0].range).toEqual({ from: 0, to: 999 })
    expect(setReads[1].range).toEqual({ from: 1000, to: 1999 })
  })

  it('spreads a capped read across many exercises without losing any of them', async () => {
    // The cap is per-response, not per-exercise: 40 exercises × 60 sets is one
    // 2400-row collection, and the exercises whose sets sort last lose ALL of
    // their history when the read truncates.
    const exercises = Array.from({ length: 40 }, (_, i) => ({
      id: `ex-${i}`, user_id: USER, name: `Lift ${i}`, tags: [],
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
      deleted_at: null,
    }))
    fakeSupabase.seed('exercises', exercises)
    fakeSupabase.seed('sets', exercises.flatMap((ex, i) =>
      seedSets(ex.id, 60, `2026-0${(i % 9) + 1}-01`)))

    const store = useWorkoutStore()
    await store.init(USER)

    expect(store.exercises).toHaveLength(40)
    for (const ex of store.exercises) {
      expect(ex.sets, `${ex.name} lost its sets`).toHaveLength(60)
    }
  })

  it('pages exercises too — a heavy account can exceed the cap on that table alone', async () => {
    fakeSupabase.seed('exercises', Array.from({ length: 1200 }, (_, i) => ({
      id: `ex-${i}`, user_id: USER, name: `Lift ${i}`, tags: [],
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
      deleted_at: null,
    })))

    const store = useWorkoutStore()
    await store.init(USER)

    expect(store.exercises).toHaveLength(1200)
  })

  it('pages bodyweight entries — daily logging reaches the cap in under three years', async () => {
    const base = new Date('2023-01-01T00:00:00.000Z').getTime()
    fakeSupabase.seed('bodyweight_entries', Array.from({ length: 1100 }, (_, i) => ({
      id: `bw-${i}`,
      user_id: USER,
      date: new Date(base + i * 86_400_000).toISOString(),
      weight: 180 + (i % 10),
      created_at: new Date(base + i * 86_400_000).toISOString(),
      deleted_at: null,
    })))

    const store = useBodyweightStore()
    await store.init(USER)

    expect(store.entries).toHaveLength(1100)
  })
})
