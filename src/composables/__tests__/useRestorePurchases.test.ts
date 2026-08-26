import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { RestoreResult } from '../useSupporter'

// Mock the entitlement recovery + analytics so we can drive every outcome and
// assert the funnel event fires.
const mocks = vi.hoisted(() => ({
  restorePurchases: vi.fn<[], Promise<RestoreResult>>(),
  supportFunnel: vi.fn(),
}))
vi.mock('../useSupporter', () => ({
  useSupporter: () => ({ restorePurchases: mocks.restorePurchases }),
}))
vi.mock('../useAnalytics', () => ({
  useAnalytics: () => ({ supportFunnel: mocks.supportFunnel }),
}))

import { useRestorePurchases } from '../useRestorePurchases'

describe('useRestorePurchases (LIFT-1201)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.restorePurchases.mockReset()
    mocks.supportFunnel.mockReset()
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('fires the restore funnel stage exactly once per attempt', async () => {
    mocks.restorePurchases.mockResolvedValue('none')
    const { restore } = useRestorePurchases()
    await restore()
    expect(mocks.supportFunnel).toHaveBeenCalledTimes(1)
    expect(mocks.supportFunnel).toHaveBeenCalledWith('restore')
  })

  it.each<[RestoreResult, string]>([
    ['restored', 'Purchases restored'],
    ['none', 'No purchases to restore'],
    ['unavailable', 'Purchases can only be restored in the App Store version'],
    ['error', 'Could not restore — try again'],
  ])('maps the %s outcome to its status message', async (outcome, message) => {
    mocks.restorePurchases.mockResolvedValue(outcome)
    const { restore, feedback } = useRestorePurchases()
    await restore()
    expect(feedback.value).toBe(message)
  })

  it('toggles isRestoring around the async attempt', async () => {
    let resolve!: (r: RestoreResult) => void
    mocks.restorePurchases.mockReturnValue(new Promise<RestoreResult>((r) => { resolve = r }))
    const { restore, isRestoring } = useRestorePurchases()
    const p = restore()
    expect(isRestoring.value).toBe(true)
    resolve('none')
    await p
    expect(isRestoring.value).toBe(false)
  })

  it('reports an error (and clears the flag) when the restore throws', async () => {
    mocks.restorePurchases.mockRejectedValue(new Error('network'))
    const { restore, feedback, isRestoring } = useRestorePurchases()
    const result = await restore()
    expect(result).toBe('error')
    expect(feedback.value).toBe('Could not restore — try again')
    expect(isRestoring.value).toBe(false)
  })

  it('ignores a re-entrant call while one is already in flight', async () => {
    let resolve!: (r: RestoreResult) => void
    mocks.restorePurchases.mockReturnValue(new Promise<RestoreResult>((r) => { resolve = r }))
    const { restore } = useRestorePurchases()
    const first = restore()
    const second = await restore() // returns immediately, guarded
    expect(second).toBe('error')
    expect(mocks.restorePurchases).toHaveBeenCalledTimes(1)
    expect(mocks.supportFunnel).toHaveBeenCalledTimes(1)
    resolve('none')
    await first
  })

  it('auto-clears the status line after the feedback window', async () => {
    mocks.restorePurchases.mockResolvedValue('none')
    const { restore, feedback } = useRestorePurchases()
    await restore()
    expect(feedback.value).toBe('No purchases to restore')
    vi.advanceTimersByTime(4000)
    expect(feedback.value).toBeNull()
  })
})
