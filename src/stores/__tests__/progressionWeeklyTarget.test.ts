/**
 * Regression: the weekly target's range is a property of the FIELD, not of the
 * one code path that happened to enforce it (LIFT-1505).
 *
 * `setWeeklyTarget` clamped to [1, 7] — the range `ProgressionState` has always
 * documented — and neither hydration boundary did. `load()` spread
 * `weekly_target` and `pending_target_change` straight out of the
 * `user-progression` blob, and `_fetchFromSupabase` adopted
 * `data.weekly_target ?? …` from a column the migration declares
 * `integer not null default 3` with **no CHECK constraint**, so the server
 * stores and returns whatever any client ever sent.
 *
 * `evaluateWeek` then uses the value as a bare comparison
 * (`daysTrainedThisWeek >= effectiveTarget`), so out of range is silent and
 * permanent in both directions:
 *
 *  - HIGH freezes the streak forever — no amount of training meets a 99-day
 *    goal, so the duration multiplier never tiers up and the goal pill reads
 *    "0 of 99 days" with nothing saying it is unreachable.
 *  - ZERO or negative fakes it — every week counts, untrained ones included, so
 *    a dormant account accrues streak weeks and inflates XP on the first set
 *    logged after a layoff.
 *
 * And it propagates: `_syncToSupabase` pushes `weekly_target` back verbatim, so
 * a value corrupted on one device reaches every other device on its next fetch
 * and survives a reinstall.
 *
 * Why nothing caught it: every progression fixture set the target through
 * `setWeeklyTarget` or to a legal literal (3, 4, 5), where the clamp and its
 * absence are indistinguishable. The tests below seed an out-of-range value in
 * the persisted blob AND in a remote row, then assert what `evaluateWeek` does
 * with it.
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

import { useProgressionStore } from '../progression'
import { MIN_WEEKLY_TARGET, MAX_WEEKLY_TARGET, DEFAULT_WEEKLY_TARGET } from '../../lib/xp'

/** A `user_progression` row as PostgREST returns it. */
function remoteRow(over: Record<string, unknown> = {}) {
  return {
    user_id: 'u1',
    total_xp: 0,
    streak_weeks: 0,
    weekly_target: 3,
    pending_target_change: null,
    show_progression: true,
    progression_enabled: true,
    unlocked_themes: ['pearl'],
    starter_theme: 'fire',
    starter_confirmed: true,
    epoch: 1,
    streak_history: [],
    xp_per_set: {},
    bodyweight_xp_dates: [],
    ...over,
  }
}

/** Seed the persisted blob, then build a store that hydrates from it. */
function storeFromBlob(blob: Record<string, unknown>) {
  localStorage.setItem('user-progression', JSON.stringify(blob))
  setActivePinia(createPinia())
  return useProgressionStore()
}

/** The last `progression-sync` payload enqueued — what actually reaches the server. */
function lastPushedRow(): Record<string, unknown> {
  const calls = enqueue.mock.calls.filter(c => c[0] === 'progression-sync')
  expect(calls.length).toBeGreaterThan(0)
  return (calls[calls.length - 1][2] as { row: Record<string, unknown> }).row
}

describe('weekly target range (LIFT-1505)', () => {
  beforeEach(() => {
    localStorageMock.clear()
    setActivePinia(createPinia())
    enqueue.mockClear()
    remote.row = null
  })

  describe('localStorage hydration', () => {
    it('clamps a high target so the streak can still advance', () => {
      const store = storeFromBlob({ weeklyTarget: 99, progressionEnabled: true })
      expect(store.weeklyTarget).toBe(MAX_WEEKLY_TARGET)

      // The whole point: a week that met the real goal now counts. Unclamped,
      // `7 >= 99` was false and the streak froze at 0 forever.
      store.evaluateWeek(7, '2026-08-17')
      expect(store.streakWeeks).toBe(1)
    })

    it('clamps a zero target so an untrained week still breaks the streak', () => {
      const store = storeFromBlob({ weeklyTarget: 0, streakWeeks: 4, progressionEnabled: true })
      expect(store.weeklyTarget).toBe(MIN_WEEKLY_TARGET)

      // Unclamped, `0 >= 0` was true and a dormant week extended the streak to
      // 5, inflating the duration multiplier on the next set logged.
      store.evaluateWeek(0, '2026-08-17')
      expect(store.streakWeeks).toBe(0)
    })

    it('falls back to the default for a corrupt target, not to the minimum', () => {
      expect(storeFromBlob({ weeklyTarget: 'five' }).weeklyTarget).toBe(DEFAULT_WEEKLY_TARGET)
      expect(storeFromBlob({ weeklyTarget: null }).weeklyTarget).toBe(DEFAULT_WEEKLY_TARGET)
      expect(storeFromBlob({ weeklyTarget: [] }).weeklyTarget).toBe(DEFAULT_WEEKLY_TARGET)
    })

    it('clamps a staged change so it cannot shadow the active target', () => {
      const store = storeFromBlob({
        weeklyTarget: 3,
        pendingTargetChange: 99,
        progressionEnabled: true,
      })
      expect(store.pendingTargetChange).toBe(MAX_WEEKLY_TARGET)

      // `evaluateWeek` evaluates against max(active, pending) as anti-gaming, so
      // an unclamped 99 froze the streak even with a legal active target.
      store.evaluateWeek(7, '2026-08-17')
      expect(store.streakWeeks).toBe(1)
      expect(store.weeklyTarget).toBe(MAX_WEEKLY_TARGET)
      expect(store.pendingTargetChange).toBeNull()
    })

    it('drops a corrupt staged change rather than inventing one', () => {
      // Falling back to the default would stage a change to 3 days the user
      // never made — and next Monday `evaluateWeek` applies it, which for a
      // 5-day lifter reads as a DECREASE and resets the streak outright.
      const store = storeFromBlob({
        weeklyTarget: 5,
        streakWeeks: 6,
        pendingTargetChange: 'three',
        progressionEnabled: true,
      })
      expect(store.pendingTargetChange).toBeNull()

      store.evaluateWeek(5, '2026-08-17')
      expect(store.weeklyTarget).toBe(5)
      expect(store.streakWeeks).toBe(7)
    })

    it('leaves a legal target and a legal staged change untouched', () => {
      const store = storeFromBlob({ weeklyTarget: 5, pendingTargetChange: 6 })
      expect(store.weeklyTarget).toBe(5)
      expect(store.pendingTargetChange).toBe(6)
    })
  })

  describe('remote hydration', () => {
    it('re-narrows a high target from a column with no CHECK constraint', async () => {
      const store = useProgressionStore()
      store._userId = 'u1'
      remote.row = remoteRow({ weekly_target: 99 })

      await store._fetchFromSupabase()

      expect(store.weeklyTarget).toBe(MAX_WEEKLY_TARGET)
      store.evaluateWeek(7, '2026-08-17')
      expect(store.streakWeeks).toBe(1)
    })

    it('re-narrows a zero target', async () => {
      const store = useProgressionStore()
      store._userId = 'u1'
      store.streakWeeks = 4
      remote.row = remoteRow({ weekly_target: 0 })

      await store._fetchFromSupabase()

      expect(store.weeklyTarget).toBe(MIN_WEEKLY_TARGET)
      store.evaluateWeek(0, '2026-08-17')
      expect(store.streakWeeks).toBe(0)
    })

    it('re-narrows a staged change', async () => {
      const store = useProgressionStore()
      store._userId = 'u1'
      remote.row = remoteRow({ weekly_target: 4, pending_target_change: -2 })

      await store._fetchFromSupabase()

      expect(store.weeklyTarget).toBe(4)
      expect(store.pendingTargetChange).toBe(MIN_WEEKLY_TARGET)
    })

    it('does not push the corrupt value back to the server', async () => {
      // The value was pushed back verbatim, so one corrupt device re-infected
      // every other device on its next fetch and survived a reinstall.
      const store = useProgressionStore()
      store._userId = 'u1'
      remote.row = remoteRow({ weekly_target: 99, pending_target_change: 99 })

      await store._fetchFromSupabase()

      const row = lastPushedRow()
      expect(row.weekly_target).toBe(MAX_WEEKLY_TARGET)
      expect(row.pending_target_change).toBe(MAX_WEEKLY_TARGET)
    })

    it('does not push a corrupt local value back either', async () => {
      const store = storeFromBlob({ weeklyTarget: -5 })
      store._userId = 'u1'
      // Remote has no target of its own to override the local one with.
      remote.row = remoteRow({ weekly_target: null, pending_target_change: null })

      await store._fetchFromSupabase()

      expect(store.weeklyTarget).toBe(MIN_WEEKLY_TARGET)
      expect(lastPushedRow().weekly_target).toBe(MIN_WEEKLY_TARGET)
    })

    it('leaves a legal remote target alone', async () => {
      const store = useProgressionStore()
      store._userId = 'u1'
      remote.row = remoteRow({ weekly_target: 6, pending_target_change: 4 })

      await store._fetchFromSupabase()

      expect(store.weeklyTarget).toBe(6)
      expect(store.pendingTargetChange).toBe(4)
    })
  })

  describe('writers', () => {
    it('setWeeklyTarget still clamps, now through the shared guard', () => {
      const store = useProgressionStore()
      store.setWeeklyTarget(99)
      expect(store.pendingTargetChange).toBe(MAX_WEEKLY_TARGET)
      store.setWeeklyTarget(-1)
      expect(store.pendingTargetChange).toBe(MIN_WEEKLY_TARGET)
    })

    it('setWeeklyTarget no longer stages a NaN', () => {
      // `Math.max(1, Math.min(7, Math.round(NaN)))` is NaN, so the old clamp
      // staged one — and `daysTrained >= NaN` is false, i.e. the frozen-streak
      // failure reached through the setter itself.
      const store = storeFromBlob({ weeklyTarget: 5 })
      store.setWeeklyTarget(Number.NaN)
      expect(store.pendingTargetChange).toBe(DEFAULT_WEEKLY_TARGET)
    })

    it('setStarterTheme clamps the goal it is handed', () => {
      // The onboarding / re-pick flow is the one writer that sets the target
      // outright instead of staging it.
      const store = useProgressionStore()
      store.setStarterTheme('fire', 99)
      expect(store.weeklyTarget).toBe(MAX_WEEKLY_TARGET)
    })
  })
})
