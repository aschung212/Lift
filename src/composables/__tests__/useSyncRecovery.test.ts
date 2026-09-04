/**
 * Read-path recovery (LIFT-1226).
 *
 * Before this existed, a failed READ was terminal for the session: each store's
 * `_fetchFromSupabase` recorded `lastSyncError` and returned, and the only
 * reconnect signal in the app (App.vue's `online` listener) merely relabelled
 * the sync indicator. An offline cold start, a network blip, or a mid-session
 * token expiry therefore left the app on local-only data — and left the
 * reconciliation pushes that live inside `_fetchFromSupabase` parked — until a
 * full app relaunch.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const fetchWorkout = vi.fn().mockResolvedValue(undefined)
const fetchBodyweight = vi.fn().mockResolvedValue(undefined)
const fetchPreferences = vi.fn().mockResolvedValue(undefined)
const fetchProgression = vi.fn().mockResolvedValue(undefined)

vi.mock('../../stores/workout', () => ({
  useWorkoutStore: () => ({ _fetchFromSupabase: fetchWorkout }),
}))
vi.mock('../../stores/bodyweight', () => ({
  useBodyweightStore: () => ({ _fetchFromSupabase: fetchBodyweight }),
}))
vi.mock('../../stores/preferences', () => ({
  usePreferencesStore: () => ({ _fetchFromSupabase: fetchPreferences }),
}))
vi.mock('../../stores/progression', () => ({
  useProgressionStore: () => ({ _fetchFromSupabase: fetchProgression }),
}))

const flush = vi.fn().mockResolvedValue(undefined)
const retryNow = vi.fn()
vi.mock('../../lib/syncQueue', () => ({
  syncQueue: {
    flush: (...args: unknown[]) => flush(...args),
    retryNow: (...args: unknown[]) => retryNow(...args),
  },
}))

const logError = vi.fn()
vi.mock('../../lib/logger', () => ({
  logError: (...args: unknown[]) => logError(...args),
  logWarn: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({ supabase: null }))

import { refetchAllStores, syncNow, setupSyncRecovery, _resetSyncRecovery, REFETCH_COOLDOWN_MS } from '../useSyncRecovery'
import { sessionRecoveryTick, _resetSessionHealth } from '../../lib/sessionHealth'

/** Let queued microtasks (the awaited fetches) settle. */
async function settle() {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true })
}

describe('useSyncRecovery', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    _resetSyncRecovery()
    _resetSessionHealth()
    setOnline(true)
    for (const fn of [fetchWorkout, fetchBodyweight, fetchPreferences, fetchProgression, flush, retryNow, logError]) {
      fn.mockClear()
    }
    for (const fn of [fetchWorkout, fetchBodyweight, fetchPreferences, fetchProgression]) {
      fn.mockResolvedValue(undefined)
    }
    flush.mockResolvedValue(undefined)
  })

  afterEach(() => {
    _resetSyncRecovery()
    vi.useRealTimers()
  })

  describe('refetchAllStores', () => {
    it('re-fetches all four stores', async () => {
      await expect(refetchAllStores('online')).resolves.toBe(true)
      expect(fetchWorkout).toHaveBeenCalledTimes(1)
      expect(fetchBodyweight).toHaveBeenCalledTimes(1)
      expect(fetchPreferences).toHaveBeenCalledTimes(1)
      expect(fetchProgression).toHaveBeenCalledTimes(1)
    })

    it('flushes pending writes BEFORE reading', async () => {
      // Ordering is load-bearing: every store read is remote-wins for the fields
      // it carries, so fetching ahead of a queued offline edit would paint the
      // stale server value back over it in the UI.
      const order: string[] = []
      flush.mockImplementation(async () => { order.push('flush') })
      fetchWorkout.mockImplementation(async () => { order.push('fetch') })

      await refetchAllStores('online')

      expect(order).toEqual(['flush', 'fetch'])
    })

    it('still re-fetches when the queue flush fails', async () => {
      flush.mockRejectedValue(new Error('write failed'))

      await expect(refetchAllStores('online')).resolves.toBe(true)

      expect(fetchWorkout).toHaveBeenCalledTimes(1)
      expect(logError).toHaveBeenCalled()
    })

    it('does not let one store rejecting abort the others', async () => {
      fetchWorkout.mockRejectedValue(new Error('boom'))

      await expect(refetchAllStores('online')).resolves.toBe(true)

      expect(fetchBodyweight).toHaveBeenCalledTimes(1)
      expect(fetchPreferences).toHaveBeenCalledTimes(1)
      expect(fetchProgression).toHaveBeenCalledTimes(1)
      expect(logError).toHaveBeenCalled()
    })

    it('reports rather than leaks an unhandled rejection when the run itself breaks', async () => {
      // Callers are fire-and-forget listeners, so a rejected promise here would
      // land on the global unhandledrejection floor instead of anywhere useful.
      const unhandled = vi.fn()
      window.addEventListener('unhandledrejection', unhandled)
      // Promise.allSettled itself rejecting is the shape of "the machinery
      // around the fetches broke" (e.g. no active Pinia when a store is
      // acquired) — simulate it with a non-thenable return.
      fetchWorkout.mockImplementation(() => { throw new Error('no active pinia') })

      await expect(refetchAllStores('online')).resolves.toBe(false)
      await settle()

      expect(logError).toHaveBeenCalled()
      expect(unhandled).not.toHaveBeenCalled()
      window.removeEventListener('unhandledrejection', unhandled)
    })

    it('is a no-op while the device is offline', async () => {
      setOnline(false)

      await expect(refetchAllStores('resume')).resolves.toBe(false)

      expect(flush).not.toHaveBeenCalled()
      expect(fetchWorkout).not.toHaveBeenCalled()
    })

    it('collapses overlapping triggers into a single in-flight run', async () => {
      let release!: () => void
      fetchWorkout.mockImplementation(() => new Promise<void>(r => { release = () => r() }))

      const first = refetchAllStores('online')
      await settle()
      const second = await refetchAllStores('resume')

      expect(second).toBe(false)
      expect(fetchWorkout).toHaveBeenCalledTimes(1)
      release()
      await expect(first).resolves.toBe(true)
    })

    it('rate-limits repeat triggers to one run per cooldown window', async () => {
      await refetchAllStores('resume')
      expect(fetchWorkout).toHaveBeenCalledTimes(1)

      // A resume fires visibilitychange AND focus; a flaky link re-fires online.
      await expect(refetchAllStores('resume')).resolves.toBe(false)
      vi.advanceTimersByTime(REFETCH_COOLDOWN_MS - 1)
      await expect(refetchAllStores('resume')).resolves.toBe(false)
      expect(fetchWorkout).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(1)
      await expect(refetchAllStores('resume')).resolves.toBe(true)
      expect(fetchWorkout).toHaveBeenCalledTimes(2)
    })

    it('defers (does not drop) a session-recovered trigger blocked by the cooldown', async () => {
      // The recovery sequence is: read 401s -> ensureFreshSession() succeeds ->
      // tick. That tick always lands inside the cooldown of the very read that
      // failed, so dropping it would strand exactly the data it exists to
      // re-fetch.
      await refetchAllStores('resume')
      expect(fetchWorkout).toHaveBeenCalledTimes(1)

      await expect(refetchAllStores('session-recovered')).resolves.toBe(false)
      expect(fetchWorkout).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(REFETCH_COOLDOWN_MS)
      await settle()

      expect(fetchWorkout).toHaveBeenCalledTimes(2)
    })

    it('does not stack multiple trailing re-runs for a burst of session ticks', async () => {
      await refetchAllStores('resume')
      await refetchAllStores('session-recovered')
      await refetchAllStores('session-recovered')
      await refetchAllStores('session-recovered')

      await vi.advanceTimersByTimeAsync(REFETCH_COOLDOWN_MS * 2)
      await settle()

      expect(fetchWorkout).toHaveBeenCalledTimes(2)
    })
  })

  /**
   * User-initiated sync (LIFT-1323). Before this there was no manual retry
   * anywhere in the app: a foreground 500 or an RLS regression never re-ran
   * within the session unless the user happened to background the app.
   */
  describe('syncNow', () => {
    it('drags back the writes the automatic path can no longer reach', async () => {
      // `flush()` runs `_queue` only, so a backoff-parked write waits out its
      // delay and a given-up write waits for the next launch. Without this the
      // button is a placebo for exactly the failures behind it.
      const order: string[] = []
      retryNow.mockImplementation(() => { order.push('retryNow') })
      flush.mockImplementation(async () => { order.push('flush') })
      fetchWorkout.mockImplementation(async () => { order.push('fetch') })

      await expect(syncNow()).resolves.toBe(true)

      expect(order).toEqual(['retryNow', 'flush', 'fetch'])
    })

    it('ignores the cooldown, unlike every automatic trigger', async () => {
      // The cooldown collapses machine-generated bursts. A person pressing a
      // button is not a burst — and the moment they press it is overwhelmingly
      // the moment a background attempt just failed, i.e. inside the window.
      await refetchAllStores('resume')
      expect(fetchWorkout).toHaveBeenCalledTimes(1)

      await expect(refetchAllStores('resume')).resolves.toBe(false)
      await expect(syncNow()).resolves.toBe(true)

      expect(fetchWorkout).toHaveBeenCalledTimes(2)
    })

    it('joins an in-flight pass instead of starting a second', async () => {
      let release!: () => void
      fetchWorkout.mockImplementation(() => new Promise<void>(r => { release = () => r() }))

      const background = refetchAllStores('online')
      await settle()
      const manual = syncNow()
      release()

      await expect(manual).resolves.toBe(true)
      await expect(background).resolves.toBe(true)
      expect(fetchWorkout).toHaveBeenCalledTimes(1)
      expect(retryNow).not.toHaveBeenCalled()
    })

    it('answers offline immediately rather than attempting doomed requests', async () => {
      setOnline(false)

      await expect(syncNow()).resolves.toBe(false)

      expect(retryNow).not.toHaveBeenCalled()
      expect(flush).not.toHaveBeenCalled()
      expect(fetchWorkout).not.toHaveBeenCalled()
    })

    it('resolves false rather than rejecting when the run itself breaks', async () => {
      // The caller holds a spinner on this promise, so a rejection would leave
      // the sheet stuck on "Syncing…" forever.
      fetchWorkout.mockImplementation(() => { throw new Error('no active pinia') })

      await expect(syncNow()).resolves.toBe(false)
      expect(logError).toHaveBeenCalled()
    })
  })

  describe('setupSyncRecovery', () => {
    let teardown: (() => void) | null = null

    afterEach(() => {
      teardown?.()
      teardown = null
    })

    it('re-fetches when the connection returns', async () => {
      teardown = setupSyncRecovery()

      window.dispatchEvent(new Event('online'))
      await settle()

      expect(fetchWorkout).toHaveBeenCalledTimes(1)
    })

    it('re-fetches when the app returns to the foreground', async () => {
      teardown = setupSyncRecovery()

      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
      await settle()

      expect(fetchWorkout).toHaveBeenCalledTimes(1)
    })

    it('ignores a background (hidden) visibility change', async () => {
      teardown = setupSyncRecovery()

      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
      await settle()

      expect(fetchWorkout).not.toHaveBeenCalled()
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    })

    it('re-fetches when a broken session is healed', async () => {
      teardown = setupSyncRecovery()

      sessionRecoveryTick.value++
      await settle()

      expect(fetchWorkout).toHaveBeenCalledTimes(1)
    })

    it('stops listening after teardown', async () => {
      const stop = setupSyncRecovery()
      stop()

      window.dispatchEvent(new Event('online'))
      window.dispatchEvent(new Event('focus'))
      sessionRecoveryTick.value++
      await settle()

      expect(fetchWorkout).not.toHaveBeenCalled()
    })
  })
})
