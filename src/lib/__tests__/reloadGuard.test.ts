/**
 * guardedReload circuit breaker (#1155).
 *
 * 2026-08-17: the installed iOS PWA hit "A problem repeatedly occurred" —
 * WebKit's kill screen for an app that fails repeatedly at boot. Two boot
 * flows end in an automatic `location.reload()` (IDB restore, SW
 * controllerchange); if their trigger condition recurs after reloading, the
 * page reloads forever and iOS gives up. The guard bounds every automatic
 * reload to one per trigger per browsing session; repeats are suppressed and
 * reported to Sentry so the failure is observable instead of fatal.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { guardedReload } from '../reloadGuard'
import { logError } from '../logger'

vi.mock('../logger', () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}))

/** Minimal in-memory Storage double, injectable per test. */
function makeStorage(): Pick<Storage, 'getItem' | 'setItem'> & { store: Map<string, string> } {
  const store = new Map<string, string>()
  return {
    store,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
  }
}

describe('guardedReload (#1155)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
  })

  it('performs the first reload for a trigger and reports nothing', () => {
    const reload = vi.fn()
    const storage = makeStorage()

    const result = guardedReload('idb-restore', { reload, storage })

    expect(result).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(logError).not.toHaveBeenCalled()
  })

  it('suppresses a repeat reload for the same trigger in the same session and reports to Sentry', () => {
    const reload = vi.fn()
    const storage = makeStorage()

    guardedReload('idb-restore', { reload, storage })
    const second = guardedReload('idb-restore', { reload, storage })

    expect(second).toBe(false)
    // The crash loop is broken: still exactly one reload.
    expect(reload).toHaveBeenCalledTimes(1)
    // The failure became observable instead of a kill screen.
    expect(logError).toHaveBeenCalledTimes(1)
    expect(vi.mocked(logError).mock.calls[0][0]).toBeInstanceOf(Error)
    expect(vi.mocked(logError).mock.calls[0][1]).toMatchObject({
      source: 'reloadGuard',
      reason: 'idb-restore',
    })
  })

  it('gives each trigger an independent budget', () => {
    // A legitimate SW-update reload must not be starved because the IDB
    // restore already used its one reload earlier in the session.
    const reload = vi.fn()
    const storage = makeStorage()

    expect(guardedReload('idb-restore', { reload, storage })).toBe(true)
    expect(guardedReload('sw-controllerchange', { reload, storage })).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)

    // ...and each budget is spent independently too.
    expect(guardedReload('sw-controllerchange', { reload, storage })).toBe(false)
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('a fresh session (empty storage) gets one reload again', () => {
    // sessionStorage dies with the app process — every real launch starts
    // clean, so a killed-and-relaunched app gets exactly one new attempt.
    const reload = vi.fn()
    let storage = makeStorage()

    guardedReload('idb-restore', { reload, storage })
    storage = makeStorage() // app relaunch

    expect(guardedReload('idb-restore', { reload, storage })).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('fails open when storage is unavailable — the legitimate reload still happens', () => {
    // If we cannot count reloads we must not break the settled one-shot
    // flows; an unbounded loop there is no worse than pre-guard behavior.
    const reload = vi.fn()
    const broken: Pick<Storage, 'getItem' | 'setItem'> = {
      getItem: () => { throw new Error('storage disabled') },
      setItem: () => { throw new Error('storage disabled') },
    }

    expect(guardedReload('idb-restore', { reload, storage: broken })).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(logError).not.toHaveBeenCalled()

    // Without a counter there is no suppression — documented trade-off.
    expect(guardedReload('idb-restore', { reload, storage: broken })).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('uses real sessionStorage by default', () => {
    // Only the reload is injected; the counter must land in sessionStorage —
    // the one store that survives a same-tab reload but not an app relaunch.
    const reload = vi.fn()

    expect(guardedReload('idb-restore', { reload })).toBe(true)
    expect(sessionStorage.getItem('auto-reload-guard:idb-restore')).not.toBeNull()

    expect(guardedReload('idb-restore', { reload })).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(logError).toHaveBeenCalledTimes(1)
  })
})
