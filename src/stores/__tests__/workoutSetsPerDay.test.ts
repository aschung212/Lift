/**
 * LIFT-1237 — the workout store's sets-per-day index behind `setsLoggedOn`.
 *
 * The count backs the always-visible "Finish workout" affordance and the
 * app-icon badge, and is re-read on every `triggerRef(exercises)` — once per
 * logged set. It used to be answered by rescanning every set of every exercise,
 * so a multi-year account paid an O(total sets) scan per save.
 *
 * The index is only worth having if it can't drift, so this suite asserts the
 * count against a brute-force recount after every kind of mutation, including
 * the paths that deliberately do NOT maintain it incrementally and instead rely
 * on the checksum self-heal (a set-count change forces one rebuild).
 *
 * It also pins the bucketing to `setDayKey` (#746). App.vue's badge previously
 * counted with raw `toLocalDateKey`, which shifts a UI-logged `…T23:59Z` stamp
 * forward a day for every user east of UTC — so the badge reported 0 mid-session
 * in those timezones. Both call sites now share this one implementation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'
import { setDayKey } from '../../lib/dates'

const localStorageMock = getLocalStorageMock()

vi.mock('../../lib/supabase', () => ({
  supabase: null,
  isPreviewMode: { value: false },
}))

vi.mock('../../lib/syncQueue', () => ({
  syncQueue: { enqueue: vi.fn(), enqueueDelete: vi.fn(), clear: vi.fn(), rehydrate: vi.fn() },
}))

vi.mock('../../lib/logger', () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}))

import { useWorkoutStore, type Exercise } from '../workout'

/** Independent O(n) recount — the behavior the index has to keep matching. */
function bruteForceCount(exercises: readonly Exercise[], dayKey: string): number {
  let count = 0
  for (const ex of exercises) {
    for (const s of ex.sets) {
      if (setDayKey(s.date) === dayKey) count++
    }
  }
  return count
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

describe('LIFT-1237 sets-per-day index', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('counts sets logged for a day and ignores other days', () => {
    const store = useWorkoutStore()
    const squat = store.addExercise('Squat')!
    const bench = store.addExercise('Bench Press')!
    store.logSet(squat, 225, 5, '2026-06-20')
    store.logSet(squat, 245, 3, '2026-06-20')
    store.logSet(bench, 185, 8, '2026-06-20')
    store.logSet(squat, 205, 5, '2026-06-19')

    expect(store.setsLoggedOn('2026-06-20')).toBe(3)
    expect(store.setsLoggedOn('2026-06-19')).toBe(1)
    expect(store.setsLoggedOn('2026-06-18')).toBe(0)
  })

  it('stays in step with a brute-force recount across every set mutation', () => {
    const store = useWorkoutStore()
    const id = store.addExercise('Deadlift')!
    const day = '2026-06-20'
    const check = () =>
      expect(store.setsLoggedOn(day)).toBe(bruteForceCount(store.exercises, day))

    store.logSet(id, 315, 5, day)
    check()
    store.logSet(id, 335, 3, day)
    check()

    // Re-dating off the day: total set count is unchanged, so only explicit
    // maintenance in updateSet can keep this right.
    const moved = store.exercises[0].sets[0]
    store.updateSet(id, moved.id, 315, 5, '2026-06-14')
    expect(store.setsLoggedOn(day)).toBe(1)
    check()

    // ...and back onto it.
    store.updateSet(id, moved.id, 315, 5, day)
    expect(store.setsLoggedOn(day)).toBe(2)
    check()

    // An edit with no date argument must not move the set between buckets.
    store.updateSet(id, moved.id, 325, 5)
    expect(store.setsLoggedOn(day)).toBe(2)
    check()

    const removed = store.exercises[0].sets[1]
    store.deleteSet(id, removed.id)
    expect(store.setsLoggedOn(day)).toBe(1)
    check()

    store.restoreSet(id, removed)
    expect(store.setsLoggedOn(day)).toBe(2)
    check()
  })

  it('deleting a set that no longer exists locally leaves the count alone', () => {
    const store = useWorkoutStore()
    const id = store.addExercise('Row')!
    store.logSet(id, 135, 10, '2026-06-20')

    store.deleteSet(id, 'not-a-real-set-id')

    expect(store.setsLoggedOn('2026-06-20')).toBe(1)
  })

  it('self-heals when whole exercises are removed and restored', () => {
    const store = useWorkoutStore()
    const squat = store.addExercise('Squat')!
    const bench = store.addExercise('Bench Press')!
    store.logSet(squat, 225, 5, '2026-06-20')
    store.logSet(squat, 245, 3, '2026-06-20')
    store.logSet(bench, 185, 8, '2026-06-20')
    expect(store.setsLoggedOn('2026-06-20')).toBe(3)

    // deleteExercise takes its sets with it. It does not touch the index — the
    // checksum notices the changed total and rebuilds on the next read.
    const removed = store.exercises.find(e => e.id === squat)!
    store.deleteExercise(squat)
    expect(store.setsLoggedOn('2026-06-20')).toBe(1)

    store.restoreExercise(removed)
    expect(store.setsLoggedOn('2026-06-20')).toBe(3)
  })

  it('rebuilds after a cross-tab reload replaces the exercise list', () => {
    const store = useWorkoutStore()
    const id = store.addExercise('Squat')!
    store.logSet(id, 225, 5, '2026-06-20')
    expect(store.setsLoggedOn('2026-06-20')).toBe(1)

    // Another tab wrote a different payload with the SAME set count, so the
    // checksum cannot detect it — _reloadFromStorage must invalidate outright.
    localStorageMock.setItem('workout-exercises', JSON.stringify([
      {
        id,
        name: 'Squat',
        tags: [],
        sets: [{ id: 's-other', date: '2026-06-21T23:59:30.000Z', weight: 225, reps: 5, estimated1RM: 253 }],
      },
    ]))
    store._reloadFromStorage()

    expect(store.setsLoggedOn('2026-06-20')).toBe(0)
    expect(store.setsLoggedOn('2026-06-21')).toBe(1)
  })

  it('drops to zero after $reset', () => {
    const store = useWorkoutStore()
    const id = store.addExercise('Squat')!
    store.logSet(id, 225, 5, '2026-06-20')
    expect(store.setsLoggedOn('2026-06-20')).toBe(1)

    store.$reset()

    expect(store.setsLoggedOn('2026-06-20')).toBe(0)
  })

  it('buckets end-of-day stamps by their prefix day east of UTC (#746)', () => {
    // Tokyo is UTC+9, so `2026-06-20T23:59:30Z` is the morning of June 21
    // locally. The prefix IS the day the user picked, so it must count as the
    // 20th — this is exactly what the badge's old toLocalDateKey scan got wrong.
    withTZ('Asia/Tokyo', () => {
      const store = useWorkoutStore()
      const id = store.addExercise('Squat')!
      store.logSet(id, 225, 5, '2026-06-20')

      expect(store.exercises[0].sets[0].date).toMatch(/^2026-06-20T23:59:/)
      expect(store.setsLoggedOn('2026-06-20')).toBe(1)
      expect(store.setsLoggedOn('2026-06-21')).toBe(0)
    })
  })

  it('buckets real-time UTC stamps by their LOCAL day in the Americas (#746)', () => {
    // A set logged with no explicit date carries a real UTC instant. 7pm on
    // June 20 in Los Angeles is already June 21 in UTC, so a raw slice(0, 10)
    // would file it under tomorrow.
    withTZ('America/Los_Angeles', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-06-21T02:00:00.000Z'))
      try {
        const store = useWorkoutStore()
        const id = store.addExercise('Squat')!
        store.logSet(id, 225, 5)

        expect(store.exercises[0].sets[0].date).toBe('2026-06-21T02:00:00.000Z')
        expect(store.setsLoggedOn('2026-06-20')).toBe(1)
        expect(store.setsLoggedOn('2026-06-21')).toBe(0)
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
