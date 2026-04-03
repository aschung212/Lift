import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock platform to control isNative
vi.mock('../platform', () => ({
  isNative: false,
}))

// Mock Capacitor haptics
vi.mock('@capacitor/haptics', () => ({
  Haptics: {
    impact: vi.fn(),
    notification: vi.fn(),
  },
  ImpactStyle: {
    Heavy: 'HEAVY',
    Medium: 'MEDIUM',
    Light: 'LIGHT',
  },
  NotificationType: {
    Success: 'SUCCESS',
    Warning: 'WARNING',
  },
}))

describe('haptics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('no-ops on web (tapLight)', async () => {
    const { tapLight } = await import('../haptics')
    await tapLight()
    const { Haptics } = await import('@capacitor/haptics')
    expect(Haptics.impact).not.toHaveBeenCalled()
  })

  it('no-ops on web (tapMedium)', async () => {
    const { tapMedium } = await import('../haptics')
    await tapMedium()
    const { Haptics } = await import('@capacitor/haptics')
    expect(Haptics.impact).not.toHaveBeenCalled()
  })

  it('no-ops on web (notifySuccess)', async () => {
    const { notifySuccess } = await import('../haptics')
    await notifySuccess()
    const { Haptics } = await import('@capacitor/haptics')
    expect(Haptics.notification).not.toHaveBeenCalled()
  })

  it('triggers haptics when native', async () => {
    // Reset modules to re-evaluate with native=true
    vi.resetModules()
    vi.doMock('../platform', () => ({ isNative: true }))
    vi.doMock('@capacitor/haptics', () => ({
      Haptics: {
        impact: vi.fn(),
        notification: vi.fn(),
      },
      ImpactStyle: {
        Heavy: 'HEAVY',
        Medium: 'MEDIUM',
        Light: 'LIGHT',
      },
      NotificationType: {
        Success: 'SUCCESS',
        Warning: 'WARNING',
      },
    }))

    const { tapLight } = await import('../haptics')
    await tapLight()
    const { Haptics } = await import('@capacitor/haptics')
    expect(Haptics.impact).toHaveBeenCalledWith({ style: 'LIGHT' })
  })

  it('triggers success notification when native', async () => {
    vi.resetModules()
    vi.doMock('../platform', () => ({ isNative: true }))
    vi.doMock('@capacitor/haptics', () => ({
      Haptics: {
        impact: vi.fn(),
        notification: vi.fn(),
      },
      ImpactStyle: {
        Heavy: 'HEAVY',
        Medium: 'MEDIUM',
        Light: 'LIGHT',
      },
      NotificationType: {
        Success: 'SUCCESS',
        Warning: 'WARNING',
      },
    }))

    const { notifySuccess } = await import('../haptics')
    await notifySuccess()
    const { Haptics } = await import('@capacitor/haptics')
    expect(Haptics.notification).toHaveBeenCalledWith({ type: 'SUCCESS' })
  })
})
