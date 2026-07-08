import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TipPurchaseStatus } from '../../lib/tipJar'

// Native by default so the flow runs; the web no-op path re-mocks this.
vi.mock('../../lib/platform', () => ({ isNative: true, isIOS: true, platform: 'ios' }))

// Capture analytics without touching Vercel.
const logEvent = vi.fn()
vi.mock('../useAnalytics', () => ({ useAnalytics: () => ({ logEvent, tabSwitch: vi.fn(), flushEngagement: vi.fn() }) }))

let useTipJar: typeof import('../useTipJar').useTipJar

async function load(native = true) {
  vi.resetModules()
  vi.clearAllMocks()
  localStorage.clear()
  vi.doMock('../../lib/platform', () => ({ isNative: native, isIOS: native, platform: native ? 'ios' : 'web' }))
  vi.doMock('../useAnalytics', () => ({ useAnalytics: () => ({ logEvent, tabSwitch: vi.fn(), flushEngagement: vi.fn() }) }))
  useTipJar = (await import('../useTipJar')).useTipJar
}

/** A purchase fn that always resolves the given status. */
const resolving = (status: TipPurchaseStatus) => vi.fn(() => Promise.resolve({ status }))

beforeEach(async () => {
  await load(true)
})

describe('useTipJar availability', () => {
  it('is available on native', () => {
    expect(useTipJar().available).toBe(true)
  })

  it('is unavailable on web', async () => {
    await load(false)
    expect(useTipJar().available).toBe(false)
  })

  it('exposes the tip catalog', () => {
    expect(useTipJar().tiers.map(t => t.id)).toEqual(['small', 'medium', 'large'])
  })
})

describe('useTipJar impression', () => {
  it('logs an impression on native', () => {
    useTipJar().logImpression()
    expect(logEvent).toHaveBeenCalledWith('tip_jar_impression', {})
  })

  it('does not log an impression on web', async () => {
    await load(false)
    useTipJar().logImpression()
    expect(logEvent).not.toHaveBeenCalled()
  })
})

describe('useTipJar purchase flow', () => {
  it('walks idle → purchasing → thanks on a completed tip', async () => {
    const purchase = resolving('completed')
    const jar = useTipJar(purchase)
    expect(jar.status.value).toBe('idle')
    const result = await jar.tip('medium')
    expect(result).toBe('completed')
    expect(jar.status.value).toBe('thanks')
    expect(purchase).toHaveBeenCalledWith('com.aschung212.lift.tip.medium')
  })

  it('records the completed tip in device history', async () => {
    const jar = useTipJar(resolving('completed'))
    expect(jar.tipCount.value).toBe(0)
    await jar.tip('small')
    expect(jar.tipCount.value).toBe(1)
    expect(JSON.parse(localStorage.getItem('tip-jar-history')!).count).toBe(1)
  })

  it('logs attempt + completed analytics with tier + product id', async () => {
    await useTipJar(resolving('completed')).tip('large')
    expect(logEvent).toHaveBeenCalledWith('tip_jar_purchase_attempt', {
      tier: 'large',
      productId: 'com.aschung212.lift.tip.large',
    })
    expect(logEvent).toHaveBeenCalledWith('tip_jar_purchase_completed', {
      tier: 'large',
      productId: 'com.aschung212.lift.tip.large',
    })
  })

  it('returns to idle and logs cancellation when the user backs out', async () => {
    const jar = useTipJar(resolving('cancelled'))
    expect(await jar.tip('small')).toBe('cancelled')
    expect(jar.status.value).toBe('idle')
    expect(jar.tipCount.value).toBe(0)
    expect(logEvent).toHaveBeenCalledWith('tip_jar_purchase_cancelled', {
      tier: 'small',
      productId: 'com.aschung212.lift.tip.small',
    })
  })

  it('enters error state and logs failure on an error outcome', async () => {
    const jar = useTipJar(resolving('error'))
    expect(await jar.tip('small')).toBe('error')
    expect(jar.status.value).toBe('error')
    expect(logEvent).toHaveBeenCalledWith('tip_jar_purchase_failed', {
      tier: 'small',
      productId: 'com.aschung212.lift.tip.small',
      reason: 'error',
    })
  })

  it('treats an unavailable bridge as a failure', async () => {
    const jar = useTipJar(resolving('unavailable'))
    // The raw outcome is returned to the caller, but the UI enters 'error'.
    expect(await jar.tip('small')).toBe('unavailable')
    expect(jar.status.value).toBe('error')
    expect(logEvent).toHaveBeenCalledWith('tip_jar_purchase_failed', {
      tier: 'small',
      productId: 'com.aschung212.lift.tip.small',
      reason: 'unavailable',
    })
  })

  it('never purchases on web', async () => {
    await load(false)
    const purchase = resolving('completed')
    const jar = useTipJar(purchase)
    expect(await jar.tip('small')).toBe('unavailable')
    expect(purchase).not.toHaveBeenCalled()
    expect(jar.status.value).toBe('idle')
  })

  it('ignores a second purchase while one is in flight', async () => {
    let resolveFirst!: (v: { status: TipPurchaseStatus }) => void
    const purchase = vi
      .fn()
      .mockImplementationOnce(() => new Promise(r => { resolveFirst = r }))
    const jar = useTipJar(purchase)
    const first = jar.tip('small')
    // Second tap while 'purchasing' is a no-op.
    expect(await jar.tip('medium')).toBe('unavailable')
    expect(purchase).toHaveBeenCalledTimes(1)
    resolveFirst({ status: 'completed' })
    expect(await first).toBe('completed')
  })

  it('treats a throwing bridge as an error rather than hanging', async () => {
    const purchase = vi.fn(() => Promise.reject(new Error('boom')))
    const jar = useTipJar(purchase)
    expect(await jar.tip('small')).toBe('error')
    expect(jar.status.value).toBe('error')
  })

  it('reset returns the flow to idle', async () => {
    const jar = useTipJar(resolving('error'))
    await jar.tip('small')
    expect(jar.status.value).toBe('error')
    jar.reset()
    expect(jar.status.value).toBe('idle')
  })
})

describe('useTipJar history hydration', () => {
  it('reads an existing tip count from storage on init', async () => {
    vi.resetModules()
    localStorage.setItem('tip-jar-history', JSON.stringify({ count: 3, lastAt: 123 }))
    vi.doMock('../../lib/platform', () => ({ isNative: true, isIOS: true, platform: 'ios' }))
    vi.doMock('../useAnalytics', () => ({ useAnalytics: () => ({ logEvent, tabSwitch: vi.fn(), flushEngagement: vi.fn() }) }))
    const mod = await import('../useTipJar')
    expect(mod.useTipJar().tipCount.value).toBe(3)
  })

  it('tolerates corrupt history', async () => {
    vi.resetModules()
    localStorage.setItem('tip-jar-history', '{not json')
    vi.doMock('../../lib/platform', () => ({ isNative: true, isIOS: true, platform: 'ios' }))
    vi.doMock('../useAnalytics', () => ({ useAnalytics: () => ({ logEvent, tabSwitch: vi.fn(), flushEngagement: vi.fn() }) }))
    const mod = await import('../useTipJar')
    expect(mod.useTipJar().tipCount.value).toBe(0)
  })
})
