import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { registerPlugin } from '@capacitor/core'
import type { HealthPlugin } from '@capgo/capacitor-health'
import { HEALTH_SYNC_STATE_KEY, HEALTH_ENTRY_ID_KEY, lbsToKg, healthSampleInstant } from '../../lib/healthSync'
import { APP_BUNDLE_ID } from '../../lib/appMeta'

/**
 * Native half of the Apple Health bodyweight write-sync (#1420), driven against
 * the REAL bodyweight store (so `$onAction` subscriptions and the `sample` flag
 * behave as in production) with the HealthKit plugin faked at the module
 * boundary. Every test re-imports the composable after mocking platform, the
 * same shape as useAppShare.test.ts, because `isHealthSyncSupported` and the
 * singleton instance are module state.
 */

// The fake is registered through Capacitor's REAL `registerPlugin`, so
// `mockHealth` is the same kind of Proxy production hands out: every property
// read — `then` included — becomes a plugin method call that rejects when the
// implementation lacks it. A plain object here (how this file first shipped)
// cannot see the thenable trap that hung `enable()` on the first Simulator run
// (#1420): resolving a promise with the proxy made the engine call
// `Health.then(resolve, reject)`, which rejected natively while the awaiting
// caller waited forever. `mockImpl` is what the tests drive and assert on.
const mockImpl = {
  isAvailable: vi.fn(),
  requestAuthorization: vi.fn(),
  checkAuthorization: vi.fn(),
  readSamples: vi.fn(),
  saveSample: vi.fn(),
}
const mockHealth = registerPlugin<HealthPlugin>('LiftHealthUnderTest', { web: mockImpl })
const mockUser = ref<{ id: string; email: string } | null>({ id: 'user-1', email: 'a@b.c' })
const mockLogEvent = vi.fn()

const GRANTED = { readAuthorized: [], readDenied: [], writeAuthorized: ['weight'], writeDenied: [] }
const DENIED = { readAuthorized: [], readDenied: [], writeAuthorized: [], writeDenied: ['weight'] }
const WRITE_ONLY_WEIGHT = { read: [], write: ['weight'] }

async function load(native = true) {
  vi.resetModules()
  vi.doMock('../../lib/platform', () => ({ isNative: native, isIOS: native, platform: native ? 'ios' : 'web' }))
  vi.doMock('@capgo/capacitor-health', () => ({ Health: mockHealth }))
  vi.doMock('../useAuth', () => ({ useAuth: () => ({ user: mockUser }) }))
  vi.doMock('../useAnalytics', () => ({ useAnalytics: () => ({ logEvent: mockLogEvent }) }))
  const mod = await import('../useHealthSync')
  const { useBodyweightStore } = await import('../../stores/bodyweight')
  return { ...mod, store: useBodyweightStore() }
}

function persisted() {
  return JSON.parse(localStorage.getItem(HEALTH_SYNC_STATE_KEY) ?? 'null')
}

describe('useHealthSync', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.useRealTimers()
    for (const fn of Object.values(mockImpl)) fn.mockReset()
    mockLogEvent.mockReset()
    mockImpl.isAvailable.mockResolvedValue({ available: true })
    mockImpl.requestAuthorization.mockResolvedValue(GRANTED)
    mockImpl.checkAuthorization.mockResolvedValue(GRANTED)
    mockImpl.readSamples.mockResolvedValue({ samples: [] })
    mockImpl.saveSample.mockResolvedValue(undefined)
    mockUser.value = { id: 'user-1', email: 'a@b.c' }
  })

  afterEach(() => {
    vi.doUnmock('../../lib/platform')
    vi.doUnmock('@capgo/capacitor-health')
    vi.doUnmock('../useAuth')
    vi.doUnmock('../useAnalytics')
    vi.useRealTimers()
  })

  it('is unsupported off the native iOS shell: enable answers unavailable and setup is a no-op', async () => {
    vi.useFakeTimers()
    const { isHealthSyncSupported, useHealthSync, setupHealthSync, store } = await load(false)
    expect(isHealthSyncSupported).toBe(false)
    const api = useHealthSync()
    expect(api.isSupported).toBe(false)
    await expect(api.enable()).resolves.toBe('unavailable')
    const teardown = setupHealthSync()
    store.addEntry(185, '2026-09-14')
    await vi.advanceTimersByTimeAsync(1000)
    teardown()
    expect(mockImpl.isAvailable).not.toHaveBeenCalled()
    expect(mockImpl.saveSample).not.toHaveBeenCalled()
    expect(persisted()).toBeNull()
  })

  it('enable requests write-only weight access and backfills every real weigh-in as kilograms, oldest first', async () => {
    const { useHealthSync, store } = await load()
    const b = store.addEntry(185, '2026-09-14')
    const a = store.addEntry(186, '2026-09-13')
    store.addEntry(150, undefined, { sync: false }) // onboarding sample data — never the user's weight
    const api = useHealthSync()
    expect(api.pendingCount.value).toBe(2)

    await expect(api.enable()).resolves.toBe('enabled')
    expect(api.enabled.value).toBe(true)
    expect(mockImpl.requestAuthorization).toHaveBeenCalledWith(WRITE_ONLY_WEIGHT)

    expect(mockImpl.saveSample).toHaveBeenCalledTimes(2)
    const [first, second] = mockImpl.saveSample.mock.calls.map(c => c[0])
    expect(first).toEqual({
      dataType: 'weight',
      value: lbsToKg(186),
      unit: 'kilogram',
      startDate: healthSampleInstant('2026-09-13T23:59:00.000Z'),
      endDate: healthSampleInstant('2026-09-13T23:59:00.000Z'),
      metadata: { [HEALTH_ENTRY_ID_KEY]: a },
    })
    expect(second.metadata).toEqual({ [HEALTH_ENTRY_ID_KEY]: b })
    expect(api.pendingCount.value).toBe(0)
    expect(api.status.value).toBe('idle')
    expect(api.lastSyncedAt.value).toEqual(expect.any(String))
    expect(persisted()).toMatchObject({ ownerId: 'user-1', enabled: true, written: { [a]: true, [b]: true } })
    expect(mockLogEvent).toHaveBeenCalledWith('health_sync', { outcome: 'enabled' })
    expect(mockLogEvent).toHaveBeenCalledWith('health_sync', { outcome: 'synced', written: 2, matched: 0 })
  })

  it('a denied prompt leaves the switch off and reports where access lives', async () => {
    mockImpl.requestAuthorization.mockResolvedValue(DENIED)
    const { useHealthSync, store } = await load()
    store.addEntry(185, '2026-09-14')
    const api = useHealthSync()
    await expect(api.enable()).resolves.toBe('denied')
    expect(api.enabled.value).toBe(false)
    expect(api.status.value).toBe('denied')
    expect(mockImpl.saveSample).not.toHaveBeenCalled()
    expect(persisted()).toBeNull()
    expect(mockLogEvent).toHaveBeenCalledWith('health_sync', { outcome: 'denied' })
  })

  it('reports unavailable where HealthKit does not exist (iPad)', async () => {
    mockImpl.isAvailable.mockResolvedValue({ available: false, reason: 'HealthKit unavailable' })
    const { useHealthSync } = await load()
    const api = useHealthSync()
    await expect(api.enable()).resolves.toBe('unavailable')
    expect(api.status.value).toBe('unavailable')
    expect(api.enabled.value).toBe(false)
    expect(mockImpl.requestAuthorization).not.toHaveBeenCalled()
  })

  it('a weigh-in logged while enabled reaches Health once, and an edit does not re-write it', async () => {
    vi.useFakeTimers()
    const { useHealthSync, setupHealthSync, store } = await load()
    const api = useHealthSync()
    await api.enable()
    await api.syncNow()
    expect(mockImpl.saveSample).not.toHaveBeenCalled()

    const teardown = setupHealthSync()
    await vi.advanceTimersByTimeAsync(600) // the startup run: nothing pending
    const id = store.addEntry(190, '2026-09-15')
    expect(mockImpl.saveSample).not.toHaveBeenCalled() // debounced, not synchronous
    await vi.advanceTimersByTimeAsync(600)
    expect(mockImpl.saveSample).toHaveBeenCalledTimes(1)
    expect(mockImpl.saveSample.mock.calls[0][0].metadata).toEqual({ [HEALTH_ENTRY_ID_KEY]: id })

    // Write-once: neither a manual run nor an edit produces a second sample.
    await api.syncNow()
    store.updateEntry(id, 191)
    await vi.advanceTimersByTimeAsync(600)
    expect(mockImpl.saveSample).toHaveBeenCalledTimes(1)

    teardown()
    store.addEntry(192, '2026-09-16')
    await vi.advanceTimersByTimeAsync(600)
    expect(mockImpl.saveSample).toHaveBeenCalledTimes(1) // unsubscribed
    expect(api.pendingCount.value).toBe(1)
  })

  it('marks entries Health already holds from Logbook without writing them again', async () => {
    const { useHealthSync, store } = await load()
    const api = useHealthSync()
    await api.enable() // nothing logged yet: an empty backfill
    const a = store.addEntry(185, '2026-09-14')
    const b = store.addEntry(186, '2026-09-13')
    mockImpl.readSamples.mockResolvedValue({
      samples: [
        // A previous install (or another iPhone on this account) already wrote `a`.
        { dataType: 'weight', value: lbsToKg(185), unit: 'kilogram', startDate: healthSampleInstant('2026-09-14T23:59:00.000Z'), endDate: healthSampleInstant('2026-09-14T23:59:00.000Z'), sourceId: APP_BUNDLE_ID },
        // A scale logged the same number as `b` — that is not Logbook's sample.
        { dataType: 'weight', value: lbsToKg(186), unit: 'kilogram', startDate: healthSampleInstant('2026-09-13T23:59:00.000Z'), endDate: healthSampleInstant('2026-09-13T23:59:00.000Z'), sourceId: 'com.example.scale' },
      ],
    })
    const result = await api.syncNow()

    expect(mockImpl.readSamples).toHaveBeenCalledWith(expect.objectContaining({ dataType: 'weight', limit: 10_000, ascending: true }))
    expect(result).toMatchObject({ kind: 'synced', written: 1, matched: 1, pending: 0 })
    expect(mockImpl.saveSample).toHaveBeenCalledTimes(1)
    expect(mockImpl.saveSample.mock.calls[0][0].metadata).toEqual({ [HEALTH_ENTRY_ID_KEY]: b })
    expect(persisted().written).toEqual({ [a]: true, [b]: true })
  })

  it('a failed write stops the backfill, keeps the rest pending, and a retry writes only those', async () => {
    const { useHealthSync, store } = await load()
    store.addEntry(185, '2026-09-12')
    store.addEntry(186, '2026-09-13')
    store.addEntry(187, '2026-09-14')
    mockImpl.saveSample.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('HKErrorDomain 5'))
    const api = useHealthSync()
    // Authorization succeeded, so the switch is on; the backfill's failure is
    // reported through status/lastError rather than the enable result.
    await expect(api.enable()).resolves.toBe('enabled')
    expect(mockImpl.saveSample).toHaveBeenCalledTimes(2)
    expect(api.status.value).toBe('error')
    expect(api.lastError.value?.message).toBe('HKErrorDomain 5')
    expect(api.pendingCount.value).toBe(2)
    expect(api.enabled.value).toBe(true)

    const retried = await api.syncNow()
    expect(retried).toMatchObject({ kind: 'synced', written: 2, pending: 0 })
    expect(api.status.value).toBe('idle')
    expect(api.lastError.value).toBeNull()
    // 1 ok + 1 failed + 2 retried; the first entry was never written twice.
    expect(mockImpl.saveSample).toHaveBeenCalledTimes(4)
    const ids = mockImpl.saveSample.mock.calls.map(c => c[0].metadata[HEALTH_ENTRY_ID_KEY])
    expect(new Set(ids).size).toBe(3)
  })

  it('access revoked in the Health app later: the switch stays on, status is denied, nothing is written', async () => {
    const { useHealthSync, store } = await load()
    const api = useHealthSync()
    await api.enable()
    await api.syncNow()
    mockImpl.checkAuthorization.mockResolvedValue(DENIED)
    store.addEntry(185, '2026-09-14')
    const result = await api.syncNow()
    expect(result.kind).toBe('denied')
    expect(api.status.value).toBe('denied')
    expect(api.enabled.value).toBe(true)
    expect(api.pendingCount.value).toBe(1)
    expect(mockImpl.saveSample).not.toHaveBeenCalled()
  })

  it('binds the switch to the user who turned it on', async () => {
    const { useHealthSync, store } = await load()
    store.addEntry(185, '2026-09-14')
    const api = useHealthSync()
    await api.enable()
    await api.syncNow()
    expect(api.enabled.value).toBe(true)

    mockUser.value = { id: 'user-2', email: 'b@c.d' }
    await nextTick()
    expect(api.enabled.value).toBe(false)
    expect(api.pendingCount.value).toBe(1) // user-2's own fresh ledger

    mockUser.value = { id: 'user-1', email: 'a@b.c' }
    await nextTick()
    expect(api.enabled.value).toBe(true)
    expect(api.pendingCount.value).toBe(0) // user-1's ledger came back intact
  })

  it('disable keeps the ledger, so re-enabling does not rewrite what Health holds', async () => {
    const { useHealthSync, store } = await load()
    store.addEntry(185, '2026-09-14')
    const api = useHealthSync()
    await api.enable()
    await api.syncNow()
    expect(mockImpl.saveSample).toHaveBeenCalledTimes(1)

    api.disable()
    expect(api.enabled.value).toBe(false)
    expect(persisted()).toMatchObject({ enabled: false })
    expect(persisted().written).toEqual(expect.objectContaining({}))
    expect(mockLogEvent).toHaveBeenCalledWith('health_sync', { outcome: 'disabled' })

    await api.enable()
    await api.syncNow()
    expect(mockImpl.saveSample).toHaveBeenCalledTimes(1)
  })

  it('concurrent syncNow calls share one run', async () => {
    const { useHealthSync, store } = await load()
    const api = useHealthSync()
    await api.enable()
    store.addEntry(185, '2026-09-13')
    store.addEntry(186, '2026-09-14')
    const results = await Promise.all([api.syncNow(), api.syncNow(), api.syncNow()])
    expect(results.every(r => r.kind === 'synced' && r.written === 2)).toBe(true)
    expect(mockImpl.saveSample).toHaveBeenCalledTimes(2)
    // The joins requested ONE trailing re-run; let it finish inside this test
    // (a run that outlives the test would race the next test's mock resets)
    // and check it found nothing left to write.
    await vi.waitFor(() => expect(api.busy.value).toBe(false))
    expect(mockImpl.saveSample).toHaveBeenCalledTimes(2)
    expect(api.status.value).toBe('idle')
  })

  it('never resolves a promise with the plugin proxy — the thenable trap that hung the first Simulator run (#1420)', async () => {
    // A Capacitor plugin proxy answers `.then` with a method call, so a promise
    // resolved with it (`.then(m => m.Health)`) never settles and the native
    // `then` rejects unhandled. With the real proxy above, the old loader makes
    // this race report 'hung'; the fixed one enables within the tick budget.
    const { useHealthSync } = await load()
    const api = useHealthSync()
    const outcome = await Promise.race([
      api.enable(),
      new Promise<'hung'>(resolve => setTimeout(() => resolve('hung'), 1000)),
    ])
    expect(outcome).toBe('enabled')
    expect(mockImpl.requestAuthorization).toHaveBeenCalledTimes(1)
  })

  it('a plugin failure while enabling is surfaced as an error, not a crash', async () => {
    mockImpl.requestAuthorization.mockRejectedValue(new Error('Authorization request was not granted.'))
    const { useHealthSync } = await load()
    const api = useHealthSync()
    await expect(api.enable()).resolves.toBe('error')
    expect(api.status.value).toBe('error')
    expect(api.enabled.value).toBe(false)
    expect(api.lastError.value?.message).toContain('not granted')
  })
})
