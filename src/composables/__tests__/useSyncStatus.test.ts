/**
 * The single description of sync health that the indicator and its sheet share
 * (LIFT-1323).
 *
 * Two things the app could not previously say, both covered here: what is
 * wrong in words a lifter can act on, and how many of their changes are still
 * unsent. The third — that they can ask for a retry at all — is `syncNow`,
 * which has to bypass `useSyncRecovery`'s 20s cooldown (a floor built to
 * collapse ambient resume/`online` bursts, not deliberate taps) and has to
 * report an honest outcome rather than optimistically claiming success.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { reactive, nextTick, watch } from 'vue'

// `reactive` (not a plain object) so `lastSyncError` invalidates the folded
// status computed — the same mock-fidelity rule the WorkoutTracker harness
// follows for `mockPrefsState`.
const { stores } = vi.hoisted(() => ({
  stores: {
    workout: { lastSyncError: null as string | null },
    bodyweight: { lastSyncError: null as string | null },
    preferences: { lastSyncError: null as string | null },
    progression: { lastSyncError: null as string | null },
  },
}))
const reactiveStores = reactive(stores)

vi.mock('../../stores/workout', () => ({ useWorkoutStore: () => reactiveStores.workout }))
vi.mock('../../stores/bodyweight', () => ({ useBodyweightStore: () => reactiveStores.bodyweight }))
vi.mock('../../stores/preferences', () => ({ usePreferencesStore: () => reactiveStores.preferences }))
vi.mock('../../stores/progression', () => ({ useProgressionStore: () => reactiveStores.progression }))

const refetchAllStores = vi.fn(async () => true)
vi.mock('../useSyncRecovery', () => ({
  refetchAllStores: (...args: unknown[]) => refetchAllStores(...(args as [])),
}))

vi.mock('../../lib/supabase', () => ({ supabase: {}, isPreviewMode: { value: false } }))
vi.mock('../../lib/crossTabSync', () => ({ broadcastSyncStatus: vi.fn() }))
vi.mock('../../lib/durableStorage', () => ({
  backupToIDB: vi.fn(),
  restoreFromIDB: vi.fn(async () => null),
}))

import { syncStatus } from '../../lib/syncQueue'
import { publishSyncQueueStats, resetSyncQueueStats } from '../../lib/syncActivity'
import { authNeedsReauth, sessionAwaitingRefresh } from '../../lib/sessionHealth'
import { useSyncStatus, _resetSyncStatus, AWAITING_REFRESH_INDICATOR_DELAY_MS } from '../useSyncStatus'

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true })
}

function setStranded(stranded: number, pending = 0) {
  publishSyncQueueStats({ pending, journaled: pending + stranded, stranded })
}

describe('useSyncStatus', () => {
  beforeEach(() => {
    _resetSyncStatus()
    resetSyncQueueStats()
    syncStatus.value = 'synced'
    sessionAwaitingRefresh.value = false
    authNeedsReauth.value = false
    setOnline(true)
    for (const key of ['workout', 'bodyweight', 'preferences', 'progression'] as const) {
      reactiveStores[key].lastSyncError = null
    }
    refetchAllStores.mockClear()
    refetchAllStores.mockResolvedValue(true)
  })

  afterEach(() => {
    _resetSyncStatus()
    setOnline(true)
    vi.useRealTimers()
  })

  describe('folded status', () => {
    it('reports synced when nothing is wrong', () => {
      expect(useSyncStatus().status.value).toBe('synced')
    })

    it('surfaces a store read failure the write queue knows nothing about', async () => {
      const sync = useSyncStatus()
      reactiveStores.workout.lastSyncError = 'network'
      await nextTick()

      expect(sync.status.value).toBe('error')
    })

    // The permanent-divergence case: the write queue reports 'synced' (its last
    // batch was clean) while a journaled write sits unsent with nothing
    // retrying it. Before LIFT-1323 that combination rendered as healthy.
    it('surfaces a stranded write while the write queue reports synced', async () => {
      const sync = useSyncStatus()
      setStranded(1)
      await nextTick()

      expect(syncStatus.value).toBe('synced')
      expect(sync.status.value).toBe('error')
    })

    it('lets an in-progress sync outrank a stranded write', async () => {
      const sync = useSyncStatus()
      setStranded(1)
      syncStatus.value = 'syncing'
      await nextTick()

      expect(sync.status.value).toBe('syncing')
    })

    // LIFT-1545: a session restored from storage that auth has not refreshed
    // binds no store, so the queue, the reads and the journal are all quiet,
    // and on a dead uplink `navigator.onLine` is true as well. Folded as
    // usual that reads "Everything is synced / backed up to your account"
    // while nothing has reached the account at all.
    it('reports offline once the session restored from storage has awaited its refresh too long', async () => {
      vi.useFakeTimers()
      const sync = useSyncStatus()
      sessionAwaitingRefresh.value = true
      await nextTick()

      // Every cold start on a device holding the lifter's data passes through
      // this state for the length of a refresh (#1580), so it is not yet news.
      expect(syncStatus.value).toBe('synced')
      expect(sync.status.value).toBe('synced')

      await vi.advanceTimersByTimeAsync(AWAITING_REFRESH_INDICATOR_DELAY_MS)
      expect(sync.status.value).toBe('offline')
      expect(sync.headline.value).toBe('Offline')
      expect(sync.detail.value).toContain('saved on this device')

      // "Try again" can't do better until the refresh gets through, and says so.
      await expect(sync.syncNow()).resolves.toBe('offline')

      sessionAwaitingRefresh.value = false
      await nextTick()
      expect(sync.status.value).toBe('synced')
    })

    // #1580: the indicator (and the live region App.vue feeds from the same
    // status) must not flash "Offline" on every launch for a refresh that lands
    // in the time a refresh takes.
    it('never reports a stored session whose refresh lands within the window', async () => {
      vi.useFakeTimers()
      const sync = useSyncStatus()
      const seen: string[] = []
      watch(sync.status, (s) => seen.push(s))

      sessionAwaitingRefresh.value = true
      await vi.advanceTimersByTimeAsync(AWAITING_REFRESH_INDICATOR_DELAY_MS - 1)
      sessionAwaitingRefresh.value = false
      await vi.advanceTimersByTimeAsync(AWAITING_REFRESH_INDICATOR_DELAY_MS)

      expect(sync.status.value).toBe('synced')
      expect(seen).toEqual([])
    })

    it('reads offline at once when the browser knows it is, awaiting refresh or not', async () => {
      vi.useFakeTimers()
      const sync = useSyncStatus()
      syncStatus.value = 'offline'
      sessionAwaitingRefresh.value = true
      await nextTick()

      expect(sync.status.value).toBe('offline')
    })
  })

  describe('plain-language copy', () => {
    it('names an expired session rather than a generic failure', async () => {
      const sync = useSyncStatus()
      reactiveStores.preferences.lastSyncError = 'auth'
      // auth-js refused the refresh that 401 asked for: the banner's decision.
      authNeedsReauth.value = true
      await nextTick()

      expect(sync.headline.value).toBe('Sign-in expired')
      expect(sync.detail.value).toContain('Sign in again')
    })

    // LIFT-1549: a 401'd read whose refresh the network blocked. The session is
    // fine, and the only way to "sign in again" is Sign Out, which clears every
    // change not yet synced. Keyed on the read error alone, the sheet asked for
    // exactly that while the banner (correctly) stayed down.
    it('does not call a 401 an expired sign-in while the refresh only waits on the network', async () => {
      const sync = useSyncStatus()
      reactiveStores.preferences.lastSyncError = 'auth'
      await nextTick()

      expect(sync.status.value).toBe('error')
      expect(sync.headline.value).toBe("Couldn't sync")
      expect(sync.detail.value).not.toContain('Sign in again')
      expect(sync.detail.value).toContain('saved on this device')
    })

    // The banner and the sheet read one decision, whichever path found it.
    it('names an expired session that a write found, not only a read', async () => {
      const sync = useSyncStatus()
      setStranded(1)
      authNeedsReauth.value = true
      await nextTick()

      expect(sync.headline.value).toBe('Sign-in expired')
    })

    // A lifter mid-session needs to know their sets are safe before they need
    // to know why the server is unhappy. Every failure state says so.
    it('reassures that local data is intact in every failure state', async () => {
      const sync = useSyncStatus()

      reactiveStores.workout.lastSyncError = 'unknown'
      await nextTick()
      expect(sync.detail.value).toContain('saved on this device')

      reactiveStores.workout.lastSyncError = null
      syncStatus.value = 'offline'
      await nextTick()
      expect(sync.detail.value).toContain('saved on this device')
    })

    it('keeps the short label the live region and the indicator share', async () => {
      const sync = useSyncStatus()
      syncStatus.value = 'offline'
      await nextTick()

      expect(sync.label.value).toBe('Offline — changes saved locally')
    })
  })

  describe('unsent counts', () => {
    it('sums queued and stranded writes, counting each once', async () => {
      const sync = useSyncStatus()
      setStranded(2, 3)
      await nextTick()

      expect(sync.unsentChanges.value).toBe(5)
      expect(sync.strandedChanges.value).toBe(2)
    })
  })

  describe('last synced', () => {
    it('stamps the moment every signal agrees, and freezes when one breaks', async () => {
      vi.useFakeTimers()
      try {
        vi.setSystemTime(new Date('2026-09-16T10:00:00Z'))
        const sync = useSyncStatus()
        expect(sync.lastSyncedAt.value).toBe(Date.now())
        const stamped = sync.lastSyncedAt.value

        vi.setSystemTime(new Date('2026-09-16T10:05:00Z'))
        syncStatus.value = 'error'
        await nextTick()
        sync.refreshAge()

        expect(sync.lastSyncedAt.value).toBe(stamped)
        expect(sync.lastSyncedLabel.value).toBe('5 minutes ago')
      } finally {
        vi.useRealTimers()
      }
    })

    it('re-stamps once the app recovers', async () => {
      vi.useFakeTimers()
      try {
        vi.setSystemTime(new Date('2026-09-16T10:00:00Z'))
        syncStatus.value = 'error'
        const sync = useSyncStatus()
        expect(sync.lastSyncedAt.value).toBeNull()

        vi.setSystemTime(new Date('2026-09-16T10:05:00Z'))
        syncStatus.value = 'synced'
        await nextTick()

        expect(sync.lastSyncedAt.value).toBe(Date.parse('2026-09-16T10:05:00Z'))
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('syncNow', () => {
    it('drives the recovery pass under the manual trigger, past the cooldown', async () => {
      const sync = useSyncStatus()

      await sync.syncNow()

      expect(refetchAllStores).toHaveBeenCalledWith('manual')
    })

    it('reports success only when the folded status actually recovered', async () => {
      const sync = useSyncStatus()
      syncStatus.value = 'error'
      refetchAllStores.mockImplementation(async () => {
        syncStatus.value = 'synced'
        return true
      })

      await expect(sync.syncNow()).resolves.toBe('synced')
      expect(sync.lastRetryResult.value).toBe('synced')
    })

    // The honest half: a retry that changed nothing must not claim it did.
    it('reports failure when the status is unchanged afterwards', async () => {
      const sync = useSyncStatus()
      syncStatus.value = 'error'
      // A queued write is what keeps the failure real — with the queue empty
      // and the reads clean, the label below would be the stale one instead.
      setStranded(1)

      await expect(sync.syncNow()).resolves.toBe('failed')
    })

    /**
     * Only a successful FLUSH moves the shared write-queue status back to
     * 'synced', and flush returns early on an empty queue, so a label can
     * outlive its cause with nothing left to send: here an 'error' mirrored
     * from another tab's failed batch. (A read failure no longer lands there
     * at all since LIFT-1543.) The manual pass verifies both halves, so it
     * must not report a failure that no longer exists.
     */
    it('retires a stale write-queue error once the retry proves nothing is unsent and reads are clean', async () => {
      const sync = useSyncStatus()
      reactiveStores.workout.lastSyncError = 'unknown'
      syncStatus.value = 'error'
      await nextTick()
      refetchAllStores.mockImplementation(async () => {
        reactiveStores.workout.lastSyncError = null
        return true
      })

      await expect(sync.syncNow()).resolves.toBe('synced')
      expect(syncStatus.value).toBe('synced')
    })

    it('retires a stale offline label the same way', async () => {
      const sync = useSyncStatus()
      syncStatus.value = 'offline'

      await expect(sync.syncNow()).resolves.toBe('synced')
      expect(syncStatus.value).toBe('synced')
    })

    // Evidence, not optimism: an unsent change means the write half is still
    // genuinely failing, whatever the reads said.
    it('leaves the failure standing while a change is still unsent', async () => {
      const sync = useSyncStatus()
      syncStatus.value = 'error'
      setStranded(1)

      await sync.syncNow()

      expect(syncStatus.value).toBe('error')
    })

    it('does not attempt a request the browser knows cannot land', async () => {
      const sync = useSyncStatus()
      setOnline(false)

      await expect(sync.syncNow()).resolves.toBe('offline')
      expect(refetchAllStores).not.toHaveBeenCalled()
    })

    it('ignores a second tap while one is in flight', async () => {
      const sync = useSyncStatus()
      let release: (v: boolean) => void = () => {}
      refetchAllStores.mockImplementation(() => new Promise<boolean>((res) => { release = res }))

      const first = sync.syncNow()
      expect(sync.isRetrying.value).toBe(true)
      await sync.syncNow()
      expect(refetchAllStores).toHaveBeenCalledTimes(1)

      release(true)
      await first
      expect(sync.isRetrying.value).toBe(false)
    })
  })

  // App.vue and the sheet both call this; a second instance would mean two
  // `lastSyncedAt` stamps and a sheet that could contradict the icon that
  // opened it.
  it('hands every caller the same instance', () => {
    expect(useSyncStatus()).toBe(useSyncStatus())
  })
})
