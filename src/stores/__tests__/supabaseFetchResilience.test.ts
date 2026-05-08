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

// ── Supabase mock: rejects all queries ──────────────────────────────
vi.mock('../../lib/supabase', () => {
  function rejectingChain(): Record<string, unknown> {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      order: () => chain,
      single: () => chain,
      then: (_resolve: unknown, reject: (err: Error) => void) => {
        const err = new Error('Network request failed')
        return Promise.reject(err).catch(reject || ((e: unknown) => { throw e }))
      },
    }
    return chain
  }

  return {
    supabase: { from: () => rejectingChain() },
    isPreviewMode: { value: false },
  }
})

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
