/**
 * Regression test for #503 (P2): Supabase API errors (non-throwing) must not
 * clobber local data.
 *
 * The Supabase JS client resolves with { data: null, error: {...} } for
 * API-level errors (500s, RLS failures, etc.) instead of rejecting. The stores
 * must check .error and bail out, preserving local state.
 *
 * LIFT-786: an RLS denial (Postgres 42501) is a SERVER error, not offline, so
 * it must now be observable — routed to logError (Sentry) and reflected as a
 * degraded sync status — rather than silently swallowed with a console warn.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

// ── Shared Supabase test double (LIFT-1009), apiError mode ──────────
// Every query resolves { data: null, error } (a non-throwing RLS/API error),
// matching what the real supabase-js client does for 500s/RLS denials.
const { fakeSupabase } = await vi.hoisted(async () => {
  const { createFakeSupabase } = await import('../../__tests__/fakeSupabase')
  return { fakeSupabase: createFakeSupabase({ mode: 'apiError' }) }
})

vi.mock('../../lib/supabase', () => ({
  supabase: fakeSupabase,
  isPreviewMode: { value: false },
}))

vi.mock('../../lib/syncQueue', () => ({
  syncQueue: { enqueue: vi.fn(), enqueueDelete: vi.fn(), clear: vi.fn() },
  syncStatus: { value: 'synced' },
}))

vi.mock('../../lib/crossTabSync', () => ({
  broadcastStoreUpdate: vi.fn(),
  broadcastSyncStatus: vi.fn(),
}))

vi.mock('../../lib/logger', () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}))

import { useWorkoutStore } from '../workout'
import { useBodyweightStore } from '../bodyweight'
import { logError } from '../../lib/logger'
import { syncStatus } from '../../lib/syncQueue'

describe('Supabase API error resilience (#503)', () => {
  beforeEach(() => {
    localStorageMock.clear()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    syncStatus.value = 'synced'
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

    // LIFT-786: RLS/server error is observable, not silently warned
    expect(logError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ store: 'workout', category: 'server' }),
    )
    expect(syncStatus.value).toBe('error')
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

    // LIFT-786: RLS/server error is observable, not silently warned
    expect(logError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ store: 'bodyweight', category: 'server' }),
    )
    expect(syncStatus.value).toBe('error')
  })
})
