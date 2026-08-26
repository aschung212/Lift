import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePreferencesStore } from '../preferences'
import { getLocalStorageMock } from '../../__tests__/helpers'

vi.mock('../../lib/durableStorage', () => ({
  backupToIDB: vi.fn(),
}))

const localStorageMock = getLocalStorageMock()

describe('preferences supporter entitlement (LIFT-1204)', () => {
  let store: ReturnType<typeof usePreferencesStore>

  beforeEach(() => {
    localStorageMock.clear()
    vi.stubEnv('VITE_SUPPORTER_CODE', 'GOLD2026')
    setActivePinia(createPinia())
    store = usePreferencesStore()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('defaults to not a supporter', () => {
    expect(store.isSupporter).toBe(false)
  })

  it('redeemSupporterCode grants + persists the entitlement for a valid code', () => {
    expect(store.redeemSupporterCode('gold2026')).toBe(true)
    expect(store.isSupporter).toBe(true)
    const persisted = JSON.parse(localStorageMock.getItem('user-preferences')!)
    expect(persisted.isSupporter).toBe(true)
  })

  it('rejects an invalid code and leaves the entitlement off', () => {
    expect(store.redeemSupporterCode('WRONG')).toBe(false)
    expect(store.isSupporter).toBe(false)
  })

  it('is idempotent — re-redeeming a valid code stays granted and returns true', () => {
    expect(store.redeemSupporterCode('GOLD2026')).toBe(true)
    expect(store.redeemSupporterCode('GOLD2026')).toBe(true)
    expect(store.isSupporter).toBe(true)
  })

  it('hydrates the synced flag from the blob at instantiation (cross-device)', () => {
    localStorageMock.setItem('user-preferences', JSON.stringify({ isSupporter: true }))
    setActivePinia(createPinia())
    const fresh = usePreferencesStore()
    expect(fresh.isSupporter).toBe(true)
  })

  it('$reset wipes the entitlement so it never leaks to the next account', () => {
    store.redeemSupporterCode('GOLD2026')
    expect(store.isSupporter).toBe(true)
    store.$reset()
    expect(store.isSupporter).toBe(false)
    const persisted = JSON.parse(localStorageMock.getItem('user-preferences')!)
    expect(persisted.isSupporter).toBe(false)
  })
})
