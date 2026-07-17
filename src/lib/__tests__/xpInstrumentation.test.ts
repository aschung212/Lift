import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { XPEventData, WeeklySnapshotData } from '../xpInstrumentation'

// Capture the table name and the upserted row for each Supabase call the
// enqueued operation issues. `from` returns an object whose `upsert` records
// its argument so we can assert the exact payload shape (column-name drift or a
// dropped guard would silently stop analytics with zero signal — LIFT-893).
const upsertSpy = vi.fn(() => Promise.resolve({ error: null }))
const fromSpy = vi.fn(() => ({ upsert: upsertSpy }))

const { supabaseRef } = vi.hoisted(() => ({
  supabaseRef: { current: { from: null as unknown } as { from: unknown } | null },
}))

vi.mock('../supabase', () => ({
  get supabase() {
    return supabaseRef.current
  },
  isPreviewMode: { value: false },
}))

// Capture every enqueue call: its idempotency key and the operation closure.
// The closure is what actually builds the Supabase upsert, so invoking it lets
// us assert the payload without running the real debounced queue.
const enqueueSpy = vi.fn()
vi.mock('../syncQueue', () => ({
  syncQueue: {
    enqueue: (key: string, op: () => PromiseLike<unknown>) => enqueueSpy(key, op),
  },
}))

import { logXPEvent, logBodyweightXPEvent, logWeeklySnapshot } from '../xpInstrumentation'

/** Run the operation closure captured by the most recent enqueue call. */
function runEnqueuedOp(): void {
  const op = enqueueSpy.mock.calls.at(-1)?.[1] as () => PromiseLike<unknown>
  op()
}

const baseEvent: XPEventData = {
  userId: 'user-1',
  setId: 'set-42',
  exerciseId: 'ex-bench',
  setDate: '2026-07-06',
  baseXP: 100,
  streakMultiplier: 1.5,
  finalXP: 150,
  isPR: true,
  isTie: false,
  isRepPR: false,
  zone: 'working',
  activeTheme: 'eternal',
  epoch: 2,
}

const baseSnapshot: WeeklySnapshotData = {
  userId: 'user-1',
  weekStart: '2026-07-06',
  totalXP: 5000,
  weekXP: 800,
  streakWeeks: 3,
  trainingDays: 4,
  weeklyTarget: 5,
  themesUnlocked: 6,
}

beforeEach(() => {
  supabaseRef.current = { from: fromSpy }
  fromSpy.mockClear()
  upsertSpy.mockClear()
  enqueueSpy.mockClear()
})

describe('logXPEvent', () => {
  it('enqueues an xp_events upsert keyed by set id', () => {
    logXPEvent(baseEvent)

    expect(enqueueSpy).toHaveBeenCalledOnce()
    expect(enqueueSpy.mock.calls[0][0]).toBe('xp-event:set-42')
  })

  it('upserts the full XP-event payload with the correct column names', () => {
    logXPEvent(baseEvent)
    runEnqueuedOp()

    expect(fromSpy).toHaveBeenCalledWith('xp_events')
    expect(upsertSpy).toHaveBeenCalledWith({
      set_id: 'set-42',
      user_id: 'user-1',
      exercise_id: 'ex-bench',
      set_date: '2026-07-06',
      base_xp: 100,
      streak_multiplier: 1.5,
      final_xp: 150,
      is_pr: true,
      is_tie: false,
      is_rep_pr: false,
      zone: 'working',
      active_theme: 'eternal',
      epoch: 2,
    })
  })

  it('no-ops when userId is null', () => {
    logXPEvent({ ...baseEvent, userId: null })
    expect(enqueueSpy).not.toHaveBeenCalled()
  })

  it('no-ops when supabase is unavailable', () => {
    supabaseRef.current = null
    logXPEvent(baseEvent)
    expect(enqueueSpy).not.toHaveBeenCalled()
  })
})

describe('logBodyweightXPEvent', () => {
  it('enqueues a bodyweight xp event keyed by date', () => {
    logBodyweightXPEvent('user-1', '2026-07-06', 40, 'fire', 1)

    expect(enqueueSpy).toHaveBeenCalledOnce()
    expect(enqueueSpy.mock.calls[0][0]).toBe('xp-event:bw:2026-07-06')
  })

  it('upserts a bodyweight payload with the bw-${date} synthetic set id and bodyweight zone', () => {
    logBodyweightXPEvent('user-1', '2026-07-06', 40, 'fire', 1)
    runEnqueuedOp()

    expect(fromSpy).toHaveBeenCalledWith('xp_events')
    expect(upsertSpy).toHaveBeenCalledWith({
      set_id: 'bw-2026-07-06',
      user_id: 'user-1',
      set_date: '2026-07-06',
      base_xp: 40,
      streak_multiplier: 1,
      final_xp: 40,
      is_pr: false,
      is_tie: false,
      is_rep_pr: false,
      zone: 'bodyweight',
      active_theme: 'fire',
      epoch: 1,
    })
  })

  it('no-ops when userId is null', () => {
    logBodyweightXPEvent(null, '2026-07-06', 40, 'fire', 1)
    expect(enqueueSpy).not.toHaveBeenCalled()
  })

  it('no-ops when supabase is unavailable', () => {
    supabaseRef.current = null
    logBodyweightXPEvent('user-1', '2026-07-06', 40, 'fire', 1)
    expect(enqueueSpy).not.toHaveBeenCalled()
  })
})

describe('logWeeklySnapshot', () => {
  it('enqueues a progression snapshot keyed by week start', () => {
    logWeeklySnapshot(baseSnapshot)

    expect(enqueueSpy).toHaveBeenCalledOnce()
    expect(enqueueSpy.mock.calls[0][0]).toBe('progression-snapshot:2026-07-06')
  })

  it('upserts the snapshot payload into progression_snapshots with the correct columns', () => {
    logWeeklySnapshot(baseSnapshot)
    runEnqueuedOp()

    expect(fromSpy).toHaveBeenCalledWith('progression_snapshots')
    expect(upsertSpy).toHaveBeenCalledWith({
      user_id: 'user-1',
      week_start: '2026-07-06',
      total_xp: 5000,
      week_xp: 800,
      streak_weeks: 3,
      training_days: 4,
      weekly_target: 5,
      themes_unlocked: 6,
    })
  })

  it('no-ops when userId is null', () => {
    logWeeklySnapshot({ ...baseSnapshot, userId: null })
    expect(enqueueSpy).not.toHaveBeenCalled()
  })

  it('no-ops when supabase is unavailable', () => {
    supabaseRef.current = null
    logWeeklySnapshot(baseSnapshot)
    expect(enqueueSpy).not.toHaveBeenCalled()
  })
})
