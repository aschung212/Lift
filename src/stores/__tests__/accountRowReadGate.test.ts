/**
 * Regression: a whole-row store may not push until this device has read the
 * account's row (LIFT-1515).
 *
 * `user_preferences` and `user_progression` hold one row per user and each
 * store upserts it WHOLE — preferences its entire JSONB blob on
 * `unique(user_id)`, progression every column on its `user_id` primary key. On
 * a device whose local copy was never reconciled with the account's — a fresh
 * install, a new sign-in, the first sign-in after the sign-out wipe — that copy
 * is defaults, and nothing waited for the read. So when the first read failed
 * (a 503, an offline blip, an expired token):
 *
 *  - the first settings change upserted the default blob over the account's
 *    gyms, coach profile, weight unit, presets and PR baseline, and every other
 *    device adopted it remote-wins on its next fetch;
 *  - a committed set delete ran `removeSetXP`, whose upsert replaced the
 *    account's XP history, streak history and theme unlocks — and switched
 *    progression OFF on every other device, since `progression_enabled` is
 *    adopted remote-wins and the default is `false`.
 *
 * Why nothing caught it: every store test binds a user by assigning `_userId`
 * or by an `init()` whose read SUCCEEDS, so a push never happened from a device
 * that had not first adopted the account's row. And the suites that do fail a
 * read (`storeFetchAuthRecovery`, `supabaseFetchResilience`) assert what the
 * read reports, never what the next write sends.
 *
 * These tests run the REAL sync queue against a fake server that keeps the
 * account's row, and assert on that row — what production would hold — rather
 * than on enqueued intentions.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ── A server holding one account's rows, whose reads can fail or stall ──
const { server } = vi.hoisted(() => {
  type Row = Record<string, unknown>
  type Result = { data: unknown; error: unknown; status?: number }
  // JSON, not structuredClone: a request body is JSON-serialized on the way to
  // PostgREST, and the preferences payload carries Vue reactive proxies that
  // structuredClone refuses to copy.
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
  const server = {
    rows: {} as Record<string, Map<string, Row>>,
    /** Every select answers a 503 — the read that fails on a fresh sign-in. */
    failReads: false,
    /** Selects wait for `release()` — to land a read after a sign-out. */
    stallReads: false,
    stalled: [] as (() => void)[],
    upserts: [] as { table: string; row: Row }[],
    reset() {
      this.rows = { user_preferences: new Map(), user_progression: new Map() }
      this.failReads = false
      this.stallReads = false
      this.stalled = []
      this.upserts = []
    },
    seed(table: string, row: Row) {
      this.rows[table].set(row.user_id as string, clone(row))
    },
    row(table: string, userId = 'u1'): Row | undefined {
      return this.rows[table].get(userId)
    },
    release() {
      const pending = this.stalled
      this.stalled = []
      for (const resume of pending) resume()
    },
    from(table: string) { return new Builder(this, table) },
  }
  class Builder {
    private op: 'select' | 'upsert' = 'select'
    private cols = '*'
    private filters: Record<string, unknown> = {}
    private payload: Row | null = null
    constructor(private s: typeof server, private table: string) {}
    select(cols = '*') { this.op = 'select'; this.cols = cols; return this }
    eq(col: string, val: unknown) { this.filters[col] = val; return this }
    single() { return this }
    upsert(row: Row) { this.op = 'upsert'; this.payload = row; return this }
    private answer(): Result {
      if (this.op === 'upsert') {
        const row = clone(this.payload!)
        const key = row.user_id as string
        // ON CONFLICT DO UPDATE: the payload's columns replace the existing ones.
        this.s.rows[this.table].set(key, { ...(this.s.rows[this.table].get(key) ?? {}), ...row })
        this.s.upserts.push({ table: this.table, row })
        return { data: null, error: null, status: 201 }
      }
      if (this.s.failReads) {
        return { data: null, error: { message: 'upstream connect error', details: '', hint: '', code: '' }, status: 503 }
      }
      const found = this.s.rows[this.table].get(this.filters.user_id as string)
      if (!found) {
        return {
          data: null,
          error: { message: 'JSON object requested, multiple (or no) rows returned', details: 'The result contains 0 rows', hint: null, code: 'PGRST116' },
          status: 406,
        }
      }
      const picked = this.cols === '*'
        ? found
        : Object.fromEntries(this.cols.split(',').map(c => [c.trim(), found[c.trim()]]))
      return { data: clone(picked), error: null, status: 200 }
    }
    then<T1, T2>(onfulfilled?: (v: Result) => T1, onrejected?: (e: unknown) => T2): Promise<T1 | T2> {
      if (this.op === 'select' && this.s.stallReads) {
        return new Promise<Result>(resolve => { this.s.stalled.push(() => resolve(this.answer())) })
          .then(onfulfilled, onrejected)
      }
      return Promise.resolve(this.answer()).then(onfulfilled, onrejected)
    }
  }
  return { server }
})

vi.mock('../../lib/supabase', () => ({ supabase: server, isPreviewMode: { value: false } }))
vi.mock('../../lib/durableStorage', () => ({
  backupToIDB: vi.fn(),
  restoreFromIDB: vi.fn(async () => null),
  clearIDB: vi.fn(async () => {}),
  closeDB: vi.fn(),
}))
vi.mock('../../lib/crossTabSync', () => ({ broadcastSyncStatus: vi.fn(), broadcastStoreUpdate: vi.fn() }))
vi.mock('../../lib/logger', () => ({ logError: vi.fn(), logWarn: vi.fn(), logInfo: vi.fn() }))

import { syncQueue, _resetRateLimit, _resetCircuitBreaker } from '../../lib/syncQueue'
import { hasReadAccountRow } from '../../lib/accountRowRead'
import { sanitizeCoachProfile } from '../../lib/coachProfile'
import { usePreferencesStore } from '../preferences'
import { useProgressionStore } from '../progression'

/** Let every queued write drain against the fake server. */
async function flushWrites(): Promise<void> {
  await vi.runAllTimersAsync()
}

/** A new app launch on the same device: fresh Pinia, same localStorage. */
function relaunch(): void {
  setActivePinia(createPinia())
}

beforeEach(() => {
  vi.useFakeTimers()
  server.reset()
  localStorage.clear()
  _resetRateLimit()
  _resetCircuitBreaker()
  syncQueue.clear()
  setActivePinia(createPinia())
})

afterEach(() => {
  syncQueue.clear()
  vi.useRealTimers()
})

// ── Preferences ─────────────────────────────────────────────────────

/** The account's settings, as another device left them — already sanitized, so adoption round-trips. */
const ACCOUNT_PREFERENCES = {
  features: { workouts: true, calendar: true, weight: false },
  weightGoal: { direction: 'gain', loseTarget: null, gainTarget: 185, maintainMin: null, maintainMax: null },
  experience: { prCelebrations: false, haptics: false, screenWakeLock: true, restTimerNotification: true },
  filters: { warmupThreshold: 0.7 },
  prBaselineDate: '2026-06-01',
  strengthBaselineMode: 'recent',
  recentBaselineWeeks: 12,
  theme: 'water',
  colorMode: 'light',
  weightUnit: 'kg',
  restTimerEnabled: true,
  restTimerAutoStart: false,
  appIcon: 'water',
  intensityPresets: [60, 75, 90],
  coachProfile: sanitizeCoachProfile({ sex: 'female', age: 34, injuries: 'left shoulder impingement' }),
  gyms: ['Home Gym', 'Iron Works'],
}

function seedAccountPreferences(): void {
  server.seed('user_preferences', {
    user_id: 'u1',
    preferences: structuredClone(ACCOUNT_PREFERENCES),
    updated_at: '2026-09-01T00:00:00.000Z',
  })
}

function accountPreferences(): Record<string, unknown> {
  return server.row('user_preferences')!.preferences as Record<string, unknown>
}

describe('preferences: the first push waits for the first read (LIFT-1515)', () => {
  it('a settings change after a failed first read does not overwrite the account\'s blob', async () => {
    seedAccountPreferences()
    server.failReads = true
    const store = usePreferencesStore()
    await store.init('u1')

    store.setTheme('fire')
    await flushWrites()

    // The account's row is exactly as the other device left it. Before the fix
    // this upsert carried the default blob: no gyms, no coach profile, lbs.
    expect(server.upserts).toEqual([])
    expect(accountPreferences()).toEqual(ACCOUNT_PREFERENCES)
    // …and the edit is kept locally, not discarded.
    expect(store.theme).toBe('fire')
  })

  it('replays the held edit over the account\'s copy once the read lands', async () => {
    seedAccountPreferences()
    server.failReads = true
    const store = usePreferencesStore()
    await store.init('u1')
    store.setTheme('fire')
    // A nested edit: one experience flag, not the defaults sitting beside it.
    store.setExperienceFlag('screenWakeLock', false)

    server.failReads = false
    await store._fetchFromSupabase()
    await flushWrites()

    const expected = {
      ...ACCOUNT_PREFERENCES,
      theme: 'fire',
      experience: { ...ACCOUNT_PREFERENCES.experience, screenWakeLock: false },
    }
    expect(accountPreferences()).toEqual(expected)
    // Local state is the same merge: the account's gyms and unit, the user's edits.
    expect(store.gyms).toEqual(['Home Gym', 'Iron Works'])
    expect(store.weightUnit).toBe('kg')
    expect(store.coachProfile.age).toBe(34)
    expect(store.theme).toBe('fire')
    expect(store.experience).toEqual(expected.experience)
    expect(JSON.parse(localStorage.getItem('user-preferences')!)).toEqual(expected)
    expect(hasReadAccountRow('preferences', 'u1')).toBe(true)
  })

  it('pushes nothing back when nothing was changed while holding', async () => {
    seedAccountPreferences()
    server.failReads = true
    const store = usePreferencesStore()
    await store.init('u1')

    server.failReads = false
    await store._fetchFromSupabase()
    await flushWrites()

    // Same as any launch-time read: the adopted row is not echoed (LIFT-1243).
    expect(server.upserts).toEqual([])
    expect(store.gyms).toEqual(['Home Gym', 'Iron Works'])
    // And from here on, an edit is pushed as normal.
    store.setTheme('fire')
    await flushWrites()
    expect(accountPreferences()).toEqual({ ...ACCOUNT_PREFERENCES, theme: 'fire' })
  })

  it('replays an edit from a launch whose read never succeeded on the launch whose read does', async () => {
    seedAccountPreferences()
    server.failReads = true
    usePreferencesStore().init('u1')
    await flushWrites()
    usePreferencesStore().setRestTimer(false)
    await flushWrites()
    expect(server.upserts).toEqual([])

    // The app is closed before any read succeeds; the next launch reaches the server.
    relaunch()
    server.failReads = false
    const store = usePreferencesStore()
    await store.init('u1')
    await flushWrites()

    // The persisted base still knows restTimerEnabled was the device's default,
    // so the change is replayed rather than mistaken for part of the base.
    expect(accountPreferences()).toEqual({ ...ACCOUNT_PREFERENCES, restTimerEnabled: false })
    expect(store.restTimerEnabled).toBe(false)
    expect(store.gyms).toEqual(['Home Gym', 'Iron Works'])
  })

  it('a device that has read the row keeps pushing immediately, even when this launch\'s read fails', async () => {
    // Launch 1 reads the account's row.
    seedAccountPreferences()
    await usePreferencesStore().init('u1')
    await flushWrites()

    // Launch 2 cannot read — but its local copy IS the account's, so an edit is
    // safe to push at once (and journaled, LIFT-1239): the steady state is
    // unchanged by the gate.
    relaunch()
    server.failReads = true
    const store = usePreferencesStore()
    await store.init('u1')
    store.setTheme('fire')
    await flushWrites()

    expect(server.upserts).toHaveLength(1)
    expect(accountPreferences()).toEqual({ ...ACCOUNT_PREFERENCES, theme: 'fire' })
  })

  it('a new account (no row) opens on the read and pushes what was held as its first row', async () => {
    server.failReads = true
    const store = usePreferencesStore()
    await store.init('u1')
    store.setGyms(['Garage'])
    await flushWrites()
    expect(server.upserts).toEqual([])

    server.failReads = false
    await store._fetchFromSupabase()
    await flushWrites()

    // PGRST116 is a successful read — there is no row for the push to overwrite.
    expect(accountPreferences()).toMatchObject({ gyms: ['Garage'], theme: 'eternal' })
    expect(hasReadAccountRow('preferences', 'u1')).toBe(true)
  })

  it('the sign-out wipe forgets the read, so the next sign-in holds again', async () => {
    seedAccountPreferences()
    const store = usePreferencesStore()
    await store.init('u1')
    expect(hasReadAccountRow('preferences', 'u1')).toBe(true)

    store.$reset()
    expect(hasReadAccountRow('preferences', 'u1')).toBe(false)

    // Same user, same device, failed read: the wiped copy is defaults again.
    server.failReads = true
    await store.init('u1')
    store.setTheme('fire')
    await flushWrites()
    expect(server.upserts).toEqual([])
    expect(accountPreferences()).toEqual(ACCOUNT_PREFERENCES)
  })

  it('drops a read that lands after the user signed out', async () => {
    seedAccountPreferences()
    server.stallReads = true
    const store = usePreferencesStore()
    const pending = store.init('u1')
    await vi.advanceTimersByTimeAsync(0)

    store.$reset()
    server.release()
    await pending

    // Neither the signed-out user's settings nor their "read" survive the wipe.
    expect(store.gyms).toEqual([])
    expect(store.theme).toBe('eternal')
    expect(store._accountRowRead).toBe(false)
    expect(hasReadAccountRow('preferences', 'u1')).toBe(false)
  })

  it('a tab that reloads another tab\'s successful read may push again', async () => {
    seedAccountPreferences()
    server.failReads = true
    const piniaA = createPinia()
    const piniaB = createPinia()
    setActivePinia(piniaA)
    const tabA = usePreferencesStore()
    await tabA.init('u1')
    setActivePinia(piniaB)
    const tabB = usePreferencesStore()
    await tabB.init('u1')

    server.failReads = false
    await tabA._fetchFromSupabase()
    // Tab B hears about it through the cross-tab reload of the shared storage.
    tabB._reloadFromStorage()
    expect(tabB._accountRowRead).toBe(true)
    expect(tabB.gyms).toEqual(['Home Gym', 'Iron Works'])

    tabB.setTheme('luck')
    await flushWrites()
    expect(accountPreferences()).toEqual({ ...ACCOUNT_PREFERENCES, theme: 'luck' })
  })
})

// ── Progression ─────────────────────────────────────────────────────

function xpEntry(xp: number) {
  return { xp, theme: 'fire', epoch: 2, zone: 'working', isPR: false, isRepPR: false }
}

const ACCOUNT_PROGRESSION = {
  user_id: 'u1',
  total_xp: 9000,
  streak_weeks: 3,
  weekly_target: 5,
  pending_target_change: null,
  show_progression: true,
  progression_enabled: true,
  unlocked_themes: [
    { id: 'pearl', unlockedAt: '2026-05-01T00:00:00.000Z' },
    { id: 'fire', unlockedAt: '2026-05-02T00:00:00.000Z' },
    { id: 'air', unlockedAt: '2026-08-15T00:00:00.000Z' },
  ],
  starter_theme: 'fire',
  starter_confirmed: true,
  epoch: 2,
  streak_history: [
    { weekStart: '2026-09-07', streakCount: 1, weeklyTarget: 5, combinedMultiplier: 1.3 },
    { weekStart: '2026-09-14', streakCount: 2, weeklyTarget: 5, combinedMultiplier: 1.43 },
    { weekStart: '2026-09-21', streakCount: 3, weeklyTarget: 5, combinedMultiplier: 1.43 },
  ],
  xp_per_set: { 'set-a': xpEntry(4000), 'set-b': xpEntry(3000), 'set-c': xpEntry(2000) },
  bodyweight_xp_dates: [],
}

describe('progression: the first push waits for the first read (LIFT-1515)', () => {
  it('a set deleted after a failed first read does not replace the account\'s XP, streaks and unlocks', async () => {
    server.seed('user_progression', ACCOUNT_PROGRESSION)
    server.failReads = true
    const store = useProgressionStore()
    await store.init('u1')

    // The undo window closes on a set this device knows about (its workout read
    // succeeded; this one did not): WorkoutTracker's commit calls removeSetXP.
    store.removeSetXP('set-b')
    await flushWrites()

    // Before the fix this upsert carried the defaults: 0 XP, no history, only
    // pearl unlocked — and `progression_enabled: false`, which every other
    // device would then adopt remote-wins.
    expect(server.upserts).toEqual([])
    expect(server.row('user_progression')).toEqual(ACCOUNT_PROGRESSION)
  })

  it('merges the account\'s row when the read lands, keeping the held removal', async () => {
    server.seed('user_progression', ACCOUNT_PROGRESSION)
    server.failReads = true
    const store = useProgressionStore()
    await store.init('u1')
    store.removeSetXP('set-b')

    server.failReads = false
    await store._fetchFromSupabase()
    await flushWrites()

    const row = server.row('user_progression')!
    // The union merge would have handed set-b straight back; the deletion is newer.
    expect(Object.keys(row.xp_per_set as object).sort()).toEqual(['set-a', 'set-c'])
    expect(row.total_xp).toBe(6000)
    expect(store.totalXP).toBe(6000)
    // Everything else is the account's.
    expect(row.streak_history).toEqual(ACCOUNT_PROGRESSION.streak_history)
    expect((row.unlocked_themes as { id: string }[]).map(t => t.id).sort()).toEqual(['air', 'fire', 'pearl'])
    expect(row).toMatchObject({
      progression_enabled: true,
      starter_theme: 'fire',
      weekly_target: 5,
      epoch: 2,
      streak_weeks: 3,
    })
    expect(hasReadAccountRow('progression', 'u1')).toBe(true)
  })

  it('a new account (no row) still creates it from local state on the first read', async () => {
    const store = useProgressionStore()
    store.logSetXP('set-new', 120)
    await store.init('u1')
    await flushWrites()

    expect(server.row('user_progression')).toMatchObject({ user_id: 'u1', total_xp: 120 })
    expect(hasReadAccountRow('progression', 'u1')).toBe(true)
  })

  it('a device that has read the row keeps pushing immediately, even when this launch\'s read fails', async () => {
    server.seed('user_progression', ACCOUNT_PROGRESSION)
    await useProgressionStore().init('u1')
    await flushWrites()

    relaunch()
    server.failReads = true
    const store = useProgressionStore()
    await store.init('u1')
    store.creditSetXP('set-d', 500)
    await flushWrites()

    // Its copy descends from the account's row, so the push carries it forward.
    const row = server.row('user_progression')!
    expect(row.total_xp).toBe(9500)
    expect(row.streak_history).toEqual(ACCOUNT_PROGRESSION.streak_history)
    expect(row.progression_enabled).toBe(true)
  })

  it('the sign-out wipe forgets the read, so the next sign-in holds again', async () => {
    server.seed('user_progression', ACCOUNT_PROGRESSION)
    const store = useProgressionStore()
    await store.init('u1')
    await flushWrites()
    server.upserts = []

    store.$reset()
    expect(hasReadAccountRow('progression', 'u1')).toBe(false)

    server.failReads = true
    await store.init('u1')
    store.removeSetXP('set-a')
    await flushWrites()
    expect(server.upserts).toEqual([])
    expect(server.row('user_progression')!.xp_per_set).toEqual(ACCOUNT_PROGRESSION.xp_per_set)
  })

  it('drops a read that lands after the user signed out', async () => {
    server.seed('user_progression', ACCOUNT_PROGRESSION)
    server.stallReads = true
    const store = useProgressionStore()
    const pending = store.init('u1')
    await vi.advanceTimersByTimeAsync(0)

    store.$reset()
    server.release()
    await pending
    await flushWrites()

    expect(store.totalXP).toBe(0)
    expect(store.xpPerSet).toEqual({})
    expect(store._accountRowRead).toBe(false)
    expect(hasReadAccountRow('progression', 'u1')).toBe(false)
    expect(server.upserts).toEqual([])
  })

  it('never persists or syncs the hold itself', async () => {
    server.failReads = true
    const store = useProgressionStore()
    await store.init('u1')
    store.removeSetXP('set-x')

    const persisted = JSON.parse(localStorage.getItem('user-progression')!)
    expect(persisted).not.toHaveProperty('_accountRowRead')
    expect(persisted).not.toHaveProperty('_heldRemovals')
  })
})
