import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useRestTimerController } from '../useRestTimerController'

/**
 * Unit tests for the rest-timer notification action wiring (LIFT-751):
 * `snoozeTimer` and the service-worker `message` relay that drives it.
 */

vi.mock('../../lib/supabase', () => ({ supabase: null }))

function stubAudio() {
  const osc = { connect: vi.fn(), frequency: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, start: vi.fn(), stop: vi.fn() }
  const gain = { connect: vi.fn(), gain: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } }
  vi.stubGlobal('AudioContext', class {
    state = 'running'
    currentTime = 0
    destination = {}
    resume = vi.fn()
    createOscillator = vi.fn(() => osc)
    createGain = vi.fn(() => gain)
  })
}

describe('useRestTimerController — notification actions', () => {
  let swTarget: EventTarget

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    stubAudio()
    vi.useFakeTimers({ shouldAdvanceTime: false })
    swTarget = new EventTarget()
    Object.defineProperty(navigator, 'serviceWorker', { value: swTarget, configurable: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('snoozeTimer starts a fresh transient countdown without persisting rest-duration', () => {
    localStorage.setItem('rest-duration', '90')
    const ctrl = useRestTimerController(() => {}, () => {})

    ctrl.snoozeTimer(60)

    expect(ctrl.timerActive.value).toBe(true)
    expect(ctrl.timerPaused.value).toBe(false)
    expect(ctrl.timerSeconds.value).toBe(60)
    // The user's chosen default must survive a one-off snooze.
    expect(ctrl.restDuration.value).toBe(90)
    expect(localStorage.getItem('rest-duration')).toBe('90')
  })

  it('snoozeTimer defaults to 60 seconds', () => {
    const ctrl = useRestTimerController(() => {}, () => {})
    ctrl.snoozeTimer()
    expect(ctrl.timerSeconds.value).toBe(60)
  })

  it('relays a "snooze" service-worker message into a snooze countdown', () => {
    const ctrl = useRestTimerController(() => {}, () => {})
    expect(ctrl.timerActive.value).toBe(false)

    const event = new Event('message') as MessageEvent
    Object.defineProperty(event, 'data', { value: { type: 'lift-rest-timer-action', action: 'snooze' } })
    swTarget.dispatchEvent(event)

    expect(ctrl.timerActive.value).toBe(true)
    expect(ctrl.timerSeconds.value).toBe(60)
  })

  it('ignores non-snooze and unrelated service-worker messages', () => {
    const ctrl = useRestTimerController(() => {}, () => {})

    const openEvent = new Event('message') as MessageEvent
    Object.defineProperty(openEvent, 'data', { value: { type: 'lift-rest-timer-action', action: 'open' } })
    swTarget.dispatchEvent(openEvent)
    expect(ctrl.timerActive.value).toBe(false)

    const otherEvent = new Event('message') as MessageEvent
    Object.defineProperty(otherEvent, 'data', { value: { type: 'something-else' } })
    swTarget.dispatchEvent(otherEvent)
    expect(ctrl.timerActive.value).toBe(false)
  })
})
