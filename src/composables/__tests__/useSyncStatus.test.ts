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
import { reactive, nextTick } from 'vue'

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
import { useSyncStatus, _resetSyncStatus } from '../useSyncStatus'

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
  })

  describe('plain-language copy', () => {
    it('names an expired session rather than a generic failure', async () => {
      const sync = useSyncStatus()
      reactiveStores.preferences.lastSyncError = 'auth'
      await nextTick()

      expect(sync.headline.value).toBe('Sign-in expired')
      expect(sync.detail.value).toContain('Sign in again')
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
     * `reportFetchError` writes a READ failure into the shared write-queue
     * status ref, and only a successful FLUSH clears it — which returns early
     * on an empty queue. So a user who only browses history could recover
     * completely and keep a lit indicator forever. The manual pass verifies
     * both halves, so it must not report a failure that no longer exists.
     */
    it('retires a stale read-driven error once the retry proves reads are clean', async () => {
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
