/**
 * Regression: the startup streak catch-up must survive the progression fetch
 * (#1269).
 *
 * `App.vue` runs `evaluatePendingWeeks` on mount against local state and fires
 * the milestone toast with the number it computed, while
 * `initSupabase().then(initAuth)` — and therefore `_fetchFromSupabase` — is left
 * un-awaited alongside it. The fetch used to adopt `streak_weeks` /
 * `streak_history` remote-wins, so a server row that predated the catch-up
 * reverted it: the header toast said "4-week streak" and the badge under it said
 * "1-week streak", from the same `streakWeeks` field read a few hundred ms apart.
 *
 * It was self-sustaining rather than a one-off flake. `evaluateWeek` enqueues its
 * upsert under the `progression-sync` queue key, and the `_syncToSupabase()` at
 * the tail of `_fetchFromSupabase` enqueues under that SAME key before the
 * debounce flushes — so the reverted payload replaced the fresh one and wrote the
 * stale streak back to the server, re-arming the identical revert (and the
 * identical toast) on the next launch.
 *
 * Why nothing caught it: `progression.test.ts` mocks `syncQueue` and never drives
 * `_fetchFromSupabase`, and the fetch-path suites (`supabaseFetchResilience`,
 * `supabaseApiError`) only assert the failure modes — no test had ever landed a
 * *successful* remote row on top of locally-advanced streak state.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

const { enqueue, remote } = vi.hoisted(() => ({
  enqueue: vi.fn(),
  remote: { row: null as Record<string, unknown> | null },
}))

vi.mock('../../lib/syncQueue', () => ({
  syncQueue: { enqueue, enqueueDelete: vi.fn() },
}))

vi.mock('../../lib/supabase', () => ({
  isPreviewMode: { value: false },
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: remote.row, error: null }),
        }),
      }),
      upsert: () => Promise.resolve({ data: null, error: null }),
    }),
  },
}))

import {
  useProgressionStore,
  mergeStreakHistory,
  latestStreakEntry,
  type StreakWeekEntry,
} from '../progression'

function week(weekStart: string, streakCount: number): StreakWeekEntry {
  return { weekStart, streakCount, weeklyTarget: 4, combinedMultiplier: 1.25 }
}

/** A `user_progression` row as PostgREST returns it. */
function remoteRow(over: Record<string, unknown> = {}) {
  return {
    user_id: 'u1',
    total_xp: 0,
    streak_weeks: 1,
    weekly_target: 4,
    pending_target_change: null,
    show_progression: true,
    progression_enabled: true,
    unlocked_themes: ['pearl'],
    starter_theme: 'fire',
    starter_confirmed: true,
    epoch: 0,
    streak_history: [week('2026-07-27', 1)],
    xp_per_set: {},
    bodyweight_xp_dates: [],
    ...over,
  }
}

describe('streak history merge (#1269)', () => {
  beforeEach(() => {
    localStorageMock.clear()
    setActivePinia(createPinia())
    enqueue.mockClear()
    remote.row = null
  })

  describe('mergeStreakHistory', () => {
    it('keeps the history evaluated furthest into the calendar', () => {
      const local = [week('2026-08-03', 2), week('2026-08-10', 3), week('2026-08-17', 4)]
      const stale = [week('2026-07-27', 1)]
      expect(mergeStreakHistory(local, stale)).toBe(local)
      expect(mergeStreakHistory(stale, local)).toBe(local)
    })

    it('adopts the remote history when the local side has none', () => {
      const remoteHistory = [week('2026-08-17', 4)]
      expect(mergeStreakHistory([], remoteHistory)).toBe(remoteHistory)
    })

    it('breaks a same-week tie toward the longer history, then toward remote', () => {
      const short = [week('2026-08-17', 4)]
      const long = [week('2026-08-10', 3), week('2026-08-17', 4)]
      expect(mergeStreakHistory(long, short)).toBe(long)
      expect(mergeStreakHistory(short, long)).toBe(long)
      // Equal length AND equal latest week — remote keeps the store's default.
      const alsoShort = [week('2026-08-17', 9)]
      expect(mergeStreakHistory(short, alsoShort)).toBe(alsoShort)
    })

    it('finds the latest entry even if the persisted blob is out of order', () => {
      const scrambled = [week('2026-08-17', 4), week('2026-08-03', 2), week('2026-08-10', 3)]
      expect(latestStreakEntry(scrambled)?.weekStart).toBe('2026-08-17')
      expect(latestStreakEntry([])).toBeNull()
    })
  })

  describe('_fetchFromSupabase', () => {
    it('does not revert a catch-up the app just ran (the toast/badge mismatch)', async () => {
      const store = useProgressionStore()
      store._userId = 'u1'
      // What App.vue's startup catch-up leaves behind: three further weeks
      // evaluated, streak advanced to 4.
      store.streakHistory = [
        week('2026-07-27', 1),
        week('2026-08-03', 2),
        week('2026-08-10', 3),
        week('2026-08-17', 4),
      ]
      store.streakWeeks = 4
      // The server still holds the pre-catch-up row.
      remote.row = remoteRow()

      await store._fetchFromSupabase()

      expect(store.streakWeeks).toBe(4)
      expect(store.streakHistory).toHaveLength(4)
    })

    it('writes the surviving streak back rather than pushing the stale one', async () => {
      const store = useProgressionStore()
      store._userId = 'u1'
      store.streakHistory = [week('2026-07-27', 1), week('2026-08-17', 4)]
      store.streakWeeks = 4
      remote.row = remoteRow()

      await store._fetchFromSupabase()

      // Both the catch-up and the fetch enqueue under `progression-sync`, so the
      // last payload for that key is what actually reaches the server.
      const progressionCalls = enqueue.mock.calls.filter(c => c[0] === 'progression-sync')
      expect(progressionCalls.length).toBeGreaterThan(0)
      const descriptor = progressionCalls[progressionCalls.length - 1][2] as { row: { streak_weeks: number } }
      expect(descriptor.row.streak_weeks).toBe(4)
    })

    it('still adopts remote streak state on a device with no local history', async () => {
      const store = useProgressionStore()
      store._userId = 'u1'
      remote.row = remoteRow({ streak_weeks: 6, streak_history: [week('2026-08-17', 6)] })

      await store._fetchFromSupabase()

      expect(store.streakWeeks).toBe(6)
      expect(store.streakHistory).toHaveLength(1)
    })

    it('falls back to the remote scalar when neither side has any history', async () => {
      const store = useProgressionStore()
      store._userId = 'u1'
      remote.row = remoteRow({ streak_weeks: 3, streak_history: [] })

      await store._fetchFromSupabase()

      expect(store.streakWeeks).toBe(3)
      expect(store.streakHistory).toEqual([])
    })
  })
})
