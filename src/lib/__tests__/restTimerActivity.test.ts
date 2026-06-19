import { describe, it, expect, vi, beforeEach } from 'vitest'

const start = vi.fn()
const update = vi.fn()
const end = vi.fn()

async function loadModule(isNative: boolean, platform: string) {
  vi.resetModules()
  start.mockReset()
  update.mockReset()
  end.mockReset()
  vi.doMock('../platform', () => ({ isNative, platform }))
  vi.doMock('@capacitor/core', () => ({
    registerPlugin: () => ({ start, update, end }),
  }))
  vi.doMock('../logger', () => ({ logError: vi.fn() }))
  return import('../restTimerActivity')
}

describe('buildRestTimerActivityState', () => {
  it('passes through a normal running state', async () => {
    const { buildRestTimerActivityState } = await loadModule(false, 'web')
    expect(
      buildRestTimerActivityState({
        durationSeconds: 90,
        endTimeMs: 1_000_000,
        remainingSeconds: 45,
        paused: false,
      }),
    ).toEqual({ durationSeconds: 90, endTimeMs: 1_000_000, remainingSeconds: 45, paused: false })
  })

  it('clamps negative and fractional values to non-negative integers', async () => {
    const { buildRestTimerActivityState } = await loadModule(false, 'web')
    expect(
      buildRestTimerActivityState({
        durationSeconds: 90.7,
        endTimeMs: -5,
        remainingSeconds: -10,
        paused: true,
      }),
    ).toEqual({ durationSeconds: 90, endTimeMs: 0, remainingSeconds: 0, paused: true })
  })

  it('never reports remaining larger than the total duration', async () => {
    const { buildRestTimerActivityState } = await loadModule(false, 'web')
    const state = buildRestTimerActivityState({
      durationSeconds: 60,
      endTimeMs: 1_000,
      remainingSeconds: 120,
      paused: false,
    })
    expect(state.remainingSeconds).toBe(60)
  })

  it('coerces NaN inputs to zero', async () => {
    const { buildRestTimerActivityState } = await loadModule(false, 'web')
    expect(
      buildRestTimerActivityState({
        durationSeconds: NaN,
        endTimeMs: NaN,
        remainingSeconds: NaN,
        paused: false,
      }),
    ).toEqual({ durationSeconds: 0, endTimeMs: 0, remainingSeconds: 0, paused: false })
  })
})

const sampleState = {
  durationSeconds: 90,
  endTimeMs: 2_000,
  remainingSeconds: 90,
  paused: false,
}

describe('restTimerActivity off native iOS', () => {
  beforeEach(() => vi.resetModules())

  it('start/update/end are no-ops on web', async () => {
    const { startRestTimerActivity, updateRestTimerActivity, endRestTimerActivity } =
      await loadModule(false, 'web')
    await startRestTimerActivity(sampleState)
    await updateRestTimerActivity(sampleState)
    await endRestTimerActivity()
    expect(start).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(end).not.toHaveBeenCalled()
  })

  it('does nothing on native Android (ActivityKit is iOS-only)', async () => {
    const { startRestTimerActivity } = await loadModule(true, 'android')
    await startRestTimerActivity(sampleState)
    expect(start).not.toHaveBeenCalled()
  })
})

describe('restTimerActivity on native iOS', () => {
  beforeEach(() => vi.resetModules())

  it('forwards start to the plugin', async () => {
    const { startRestTimerActivity } = await loadModule(true, 'ios')
    start.mockResolvedValue(undefined)
    await startRestTimerActivity(sampleState)
    expect(start).toHaveBeenCalledWith(sampleState)
  })

  it('forwards update to the plugin', async () => {
    const { updateRestTimerActivity } = await loadModule(true, 'ios')
    update.mockResolvedValue(undefined)
    const paused = { ...sampleState, paused: true, remainingSeconds: 40 }
    await updateRestTimerActivity(paused)
    expect(update).toHaveBeenCalledWith(paused)
  })

  it('forwards end to the plugin', async () => {
    const { endRestTimerActivity } = await loadModule(true, 'ios')
    end.mockResolvedValue(undefined)
    await endRestTimerActivity()
    expect(end).toHaveBeenCalledTimes(1)
  })

  it('swallows plugin errors so the timer flow never breaks', async () => {
    const { startRestTimerActivity, updateRestTimerActivity, endRestTimerActivity } =
      await loadModule(true, 'ios')
    start.mockRejectedValue(new Error('no activity'))
    update.mockRejectedValue(new Error('no activity'))
    end.mockRejectedValue(new Error('no activity'))
    await expect(startRestTimerActivity(sampleState)).resolves.toBeUndefined()
    await expect(updateRestTimerActivity(sampleState)).resolves.toBeUndefined()
    await expect(endRestTimerActivity()).resolves.toBeUndefined()
  })
})
