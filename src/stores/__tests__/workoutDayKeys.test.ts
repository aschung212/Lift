/**
 * LIFT-1247 — the workout store's day-level reads bucket `set.date` through
 * `setDayKey` (#746), not a raw `slice(0, 10)`.
 *
 * The app writes set dates in TWO conventions and CLAUDE.md names `setDayKey`
 * as the single reconciliation point:
 *   - endOfDayISO stamps (`…T23:59:ssZ`) — every UI-logged set — carry the
 *     user's chosen LOCAL day directly in the prefix.
 *   - real UTC instants — `logSet`'s no-date fallback, legacy/imported rows —
 *     where the prefix is the UTC day, already tomorrow for an evening logged
 *     anywhere behind UTC.
 *
 * Two reads still used the raw prefix:
 *   1. `workoutDates`, the canonical "days you trained" list behind streaks,
 *      the welcome-back gap and the install prompt.
 *   2. the `sinceDate` cutoff in `_computePRResult` (getExercisePR /
 *      getExercisePRSet), which disagreed with `filterSetsSinceBaseline` in
 *      setScoring.ts about the same question.
 *
 * These tests force a non-UTC process timezone because the default CI zone is
 * UTC, where both bugs are invisible — which is exactly why the suite never
 * caught them.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'
import { filterSetsSinceBaseline } from '../../lib/setScoring'
import type { Exercise, WorkoutSet } from '../workout'

const localStorageMock = getLocalStorageMock()

vi.mock('../../lib/supabase', () => ({
  supabase: null,
  isPreviewMode: { value: false },
}))
vi.mock('../../lib/syncQueue', () => ({
  syncQueue: { enqueue: vi.fn(), enqueueDelete: vi.fn(), clear: vi.fn() },
}))
vi.mock('../../lib/durableStorage', () => ({
  backupToIDB: vi.fn(),
}))

const prevTZ = process.env.TZ

/** Node honors a runtime `process.env.TZ` reassignment (same trick as dates.test.ts). */
function setTZ(tz: string) {
  process.env.TZ = tz
}

function makeSet(id: string, date: string, estimated1RM: number): WorkoutSet {
  return { id, date, weight: 135, reps: 5, estimated1RM }
}

function seedExercise(sets: WorkoutSet[]): Exercise {
  return { id: 'ex-1', name: 'Bench Press', tags: ['Push'], sets }
}

async function storeWith(sets: WorkoutSet[]) {
  localStorageMock.setItem('workout-exercises', JSON.stringify([seedExercise(sets)]))
  const { useWorkoutStore } = await import('../workout')
  return useWorkoutStore()
}

beforeEach(() => {
  localStorageMock.clear()
  setActivePinia(createPinia())
})

afterEach(() => {
  process.env.TZ = prevTZ
})

describe('workoutDates day bucketing (LIFT-1247)', () => {
  it('buckets a real-time UTC stamp to the LOCAL day west of UTC', async () => {
    setTZ('America/Los_Angeles')
    // 2026-06-10 19:00 PDT — a normal evening session. The UTC instant has
    // already rolled to the 11th, so the raw prefix reports the wrong day.
    const store = await storeWith([makeSet('s1', '2026-06-11T02:00:00.000Z', 200)])
    expect(store.workoutDates).toEqual(['2026-06-10'])
  })

  it('keeps endOfDayISO stamps on their prefix day east of UTC', async () => {
    setTZ('Asia/Tokyo')
    // `…T23:59Z` is the signature of endOfDayISO: the prefix IS the chosen
    // local day. A blanket toLocalDateKey would shift this to the 13th.
    const store = await storeWith([makeSet('s1', '2026-06-12T23:59:12.345Z', 200)])
    expect(store.workoutDates).toEqual(['2026-06-12'])
  })

  it('merges both conventions onto one sorted local-day list', async () => {
    setTZ('America/Los_Angeles')
    const store = await storeWith([
      makeSet('s1', '2026-06-10T23:59:07.000Z', 200), // endOfDayISO → Jun 10
      makeSet('s2', '2026-06-11T02:00:00.000Z', 210), // real-time evening → Jun 10
      makeSet('s3', '2026-06-12T23:59:03.000Z', 205), // endOfDayISO → Jun 12
    ])
    expect(store.workoutDates).toEqual(['2026-06-10', '2026-06-12'])
  })
})

describe('PR baseline cutoff day bucketing (LIFT-1247)', () => {
  it('excludes a real-time set logged the evening BEFORE the baseline', async () => {
    setTZ('America/Los_Angeles')
    // 2026-06-09 19:00 PDT (UTC prefix reads 2026-06-10, the baseline day).
    const stale = makeSet('s-stale', '2026-06-10T02:00:00.000Z', 300)
    const current = makeSet('s-current', '2026-06-15T23:59:04.000Z', 225)
    const store = await storeWith([stale, current])

    expect(store.getExercisePR('ex-1', '2026-06-10')).toBe(225)
    expect(store.getExercisePRSet('ex-1', '2026-06-10')?.id).toBe('s-current')
  })

  it('still includes an endOfDayISO set stamped ON the baseline day', async () => {
    setTZ('Asia/Tokyo')
    const onBaseline = makeSet('s-on', '2026-06-10T23:59:31.000Z', 315)
    const store = await storeWith([
      makeSet('s-old', '2026-06-01T23:59:02.000Z', 400),
      onBaseline,
    ])

    expect(store.getExercisePR('ex-1', '2026-06-10')).toBe(315)
    expect(store.getExercisePRSet('ex-1', '2026-06-10')?.id).toBe('s-on')
  })

  it('agrees with filterSetsSinceBaseline on the same sets and baseline', async () => {
    setTZ('America/Los_Angeles')
    const sets = [
      makeSet('s-stale', '2026-06-10T02:00:00.000Z', 300), // local Jun 9 → excluded
      makeSet('s-a', '2026-06-10T23:59:09.000Z', 210),
      makeSet('s-b', '2026-06-14T23:59:44.000Z', 250),
    ]
    const store = await storeWith(sets)

    const scored = filterSetsSinceBaseline(sets, '2026-06-10')
    const scoredBest = Math.max(...scored.map(s => s.estimated1RM))
    expect(store.getExercisePR('ex-1', '2026-06-10')).toBe(scoredBest)
    expect(scored.map(s => s.id)).toEqual(['s-a', 's-b'])
  })
})
