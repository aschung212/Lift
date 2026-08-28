/**
 * Regression test for #503: Supabase fetch failures must not clobber local data.
 *
 * When Supabase is unreachable (offline, auth expired, DNS failure), the
 * workout and bodyweight stores must preserve locally-cached data rather
 * than replacing it with empty state.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

// ── Shared Supabase test double (LIFT-1009), reject mode ─────────────
// Every query rejects (offline / auth expired / DNS failure). Stores must
// preserve locally-cached data rather than replacing it with empty state.
const { fakeSupabase } = await vi.hoisted(async () => {
  const { createFakeSupabase } = await import('../../__tests__/fakeSupabase')
  return { fakeSupabase: createFakeSupabase({ mode: 'reject' }) }
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
import { useProgressionStore } from '../progression'
import { logWarn } from '../../lib/logger'

describe('Supabase fetch resilience (#503)', () => {
  beforeEach(() => {
    localStorageMock.clear()
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('workout store preserves local exercises when Supabase fetch throws', async () => {
    // Seed localStorage with cached workout data
    const cachedExercises = [
      {
        id: 'ex-1',
        name: 'Bench Press',
        tags: ['Push'],
        sets: [{ id: 's-1', date: '2026-05-01T23:59:59.000Z', weight: 185, reps: 5, estimated1RM: 216 }],
        updated_at: '2026-05-01T00:00:00.000Z',
      },
    ]
    localStorageMock.setItem('workout-exercises', JSON.stringify(cachedExercises))

    // Re-create pinia so the store reads from seeded localStorage
    setActivePinia(createPinia())
    const store = useWorkoutStore()

    // Verify local data loaded
    expect(store.exercises).toHaveLength(1)
    expect(store.exercises[0].name).toBe('Bench Press')

    // init() calls _fetchFromSupabase() which will reject — should NOT throw
    await store.init('user-123')

    // Local data must survive
    expect(store.exercises).toHaveLength(1)
    expect(store.exercises[0].name).toBe('Bench Press')
    expect(store.exercises[0].sets).toHaveLength(1)

    // Warning should be logged
    expect(logWarn).toHaveBeenCalledWith(
      expect.stringContaining('Supabase fetch failed in workout store'),
      expect.objectContaining({ error: expect.any(String) }),
    )
  })

  it('bodyweight store preserves local entries when Supabase fetch throws', async () => {
    // Seed localStorage with cached bodyweight data
    const cachedEntries = [
      { id: 'bw-1', date: '2026-05-01T23:59:59.000Z', weight: 180, updated_at: '2026-05-01T00:00:00.000Z' },
      { id: 'bw-2', date: '2026-05-02T23:59:59.000Z', weight: 179, updated_at: '2026-05-02T00:00:00.000Z' },
    ]
    localStorageMock.setItem('bodyweight-entries', JSON.stringify(cachedEntries))

    // Re-create pinia so the store reads from seeded localStorage
    setActivePinia(createPinia())
    const store = useBodyweightStore()

    // Verify local data loaded
    expect(store.entries).toHaveLength(2)

    // init() calls _fetchFromSupabase() which will reject — should NOT throw
    await store.init('user-123')

    // Local data must survive
    expect(store.entries).toHaveLength(2)
    expect(store.entries[0].weight).toBe(180)
    expect(store.entries[1].weight).toBe(179)

    // Warning should be logged
    expect(logWarn).toHaveBeenCalledWith(
      expect.stringContaining('Supabase fetch failed in bodyweight store'),
      expect.objectContaining({ error: expect.any(String) }),
    )
  })

  it('progression store does not reject and preserves local XP when Supabase fetch throws (LIFT-820)', async () => {
    // Seed localStorage with cached progression data
    const cachedProgression = {
      totalXP: 12_345,
      streakWeeks: 3,
      weeklyTarget: 4,
      progressionEnabled: true,
      starterTheme: 'fire',
      unlockedThemes: [{ id: 'pearl', unlockedAt: '2026-01-01T00:00:00.000Z' }],
    }
    localStorageMock.setItem('user-progression', JSON.stringify(cachedProgression))

    setActivePinia(createPinia())
    const store = useProgressionStore()
    expect(store.totalXP).toBe(12_345)

    // _fetchFromSupabase awaits .single(), which rejects here — previously this
    // had no try/catch and would reject init(), aborting Promise.allSettled.
    await expect(store.init('user-123')).resolves.toBeUndefined()

    // Local data survives and the failure is observable, not silent
    expect(store.totalXP).toBe(12_345)
    expect(store.streakWeeks).toBe(3)
    expect(store.lastSyncError).toBe('network')
    expect(store.syncing).toBe(false)
    expect(logWarn).toHaveBeenCalledWith(
      expect.stringContaining('Supabase fetch failed in progression store'),
      expect.objectContaining({ error: expect.any(String) }),
    )
  })

  it('a rejecting fetch in one store does not abort hydration of the others (LIFT-820)', async () => {
    localStorageMock.setItem('workout-exercises', JSON.stringify([
      { id: 'ex-1', name: 'Squat', tags: [], sets: [], updated_at: '2026-05-01T00:00:00.000Z' },
    ]))
    localStorageMock.setItem('user-progression', JSON.stringify({ totalXP: 999 }))
    setActivePinia(createPinia())

    const workout = useWorkoutStore()
    const bodyweight = useBodyweightStore()
    const progression = useProgressionStore()

    // Mirror initStores: even though every store rejects its fetch, allSettled
    // must let each finish hydrating from local state.
    const results = await Promise.allSettled([
      workout.init('user-123'),
      bodyweight.init('user-123'),
      progression.init('user-123'),
    ])
    expect(results.every(r => r.status === 'fulfilled')).toBe(true)
    expect(workout.exercises).toHaveLength(1)
    expect(progression.totalXP).toBe(999)
  })

  it('workout init() does not reject (caller does not need try/catch)', async () => {
    localStorageMock.setItem('workout-exercises', JSON.stringify([]))
    setActivePinia(createPinia())
    const store = useWorkoutStore()

    // Must resolve, not reject — this is the critical behavioral contract
    await expect(store.init('user-123')).resolves.toBeUndefined()
  })

  it('bodyweight init() does not reject (caller does not need try/catch)', async () => {
    localStorageMock.setItem('bodyweight-entries', JSON.stringify([]))
    setActivePinia(createPinia())
    const store = useBodyweightStore()

    // Must resolve, not reject
    await expect(store.init('user-123')).resolves.toBeUndefined()
  })
})
