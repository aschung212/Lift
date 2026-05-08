/**
 * Regression test for #503 (P2): Supabase API errors (non-throwing) must not
 * clobber local data.
 *
 * The Supabase JS client resolves with { data: null, error: {...} } for
 * API-level errors (500s, RLS failures, etc.) instead of rejecting. The stores
 * must check .error and bail out, preserving local state.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

// ── Supabase mock: resolves with error object (no throw) ────────────
vi.mock('../../lib/supabase', () => {
  function errorChain(): Record<string, unknown> {
    const result = { data: null, error: { message: 'permission denied for table exercises', code: '42501' } }
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      order: () => chain,
      single: () => chain,
      then: (resolve: (val: typeof result) => void) => Promise.resolve(result).then(resolve),
    }
    return chain
  }

  return {
    supabase: { from: () => errorChain() },
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

describe('Supabase API error resilience (#503)', () => {
  beforeEach(() => {
    localStorageMock.clear()
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('workout store preserves local data when Supabase returns API error', async () => {
    const cachedExercises = [
      {
        id: 'ex-1',
        name: 'Squat',
        tags: ['Legs'],
        sets: [{ id: 's-1', date: '2026-05-01T23:59:59.000Z', weight: 315, reps: 3, estimated1RM: 344 }],
        updated_at: '2026-05-01T00:00:00.000Z',
      },
    ]
    localStorageMock.setItem('workout-exercises', JSON.stringify(cachedExercises))

    setActivePinia(createPinia())
    const store = useWorkoutStore()
    expect(store.exercises).toHaveLength(1)

    await store.init('user-456')

    // Local data must survive API error
    expect(store.exercises).toHaveLength(1)
    expect(store.exercises[0].name).toBe('Squat')

    expect(logWarn).toHaveBeenCalledWith(
      expect.stringContaining('Supabase fetch failed in workout store'),
      expect.any(Object),
    )
  })

  it('bodyweight store preserves local data when Supabase returns API error', async () => {
    const cachedEntries = [
      { id: 'bw-1', date: '2026-05-01T23:59:59.000Z', weight: 185, updated_at: '2026-05-01T00:00:00.000Z' },
    ]
    localStorageMock.setItem('bodyweight-entries', JSON.stringify(cachedEntries))

    setActivePinia(createPinia())
    const store = useBodyweightStore()
    expect(store.entries).toHaveLength(1)

    await store.init('user-456')

    // Local data must survive API error
    expect(store.entries).toHaveLength(1)
    expect(store.entries[0].weight).toBe(185)

    expect(logWarn).toHaveBeenCalledWith(
      expect.stringContaining('Supabase fetch failed in bodyweight store'),
      expect.any(Object),
    )
  })
})
