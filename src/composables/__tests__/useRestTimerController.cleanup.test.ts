/**
 * Regression test for #877 — the rest-timer countdown interval must stop when
 * its owning component unmounts, rather than ticking on against torn-down state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'

getLocalStorageMock()

// Silence notifications — irrelevant to interval lifecycle.
vi.mock('../useNotification', () => ({
  useNotification: () => ({ notify: vi.fn(), requestPermission: vi.fn() }),
  useBackgroundTracker: () => ({
    wasBackgrounded: { value: false },
    startTracking: vi.fn(),
    stopTracking: vi.fn(),
  }),
}))

import { useRestTimerController } from '../useRestTimerController'

function mountController() {
  let ctrl!: ReturnType<typeof useRestTimerController>
  const onComplete = vi.fn()
  const wrapper = mount(
    defineComponent({
      setup() {
        ctrl = useRestTimerController(onComplete, vi.fn())
        return () => null
      },
    }),
  )
  return { wrapper, get ctrl() { return ctrl }, onComplete }
}

describe('useRestTimerController — interval cleanup (#877)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    // Minimal AudioContext stub so startRestTimer's ensureAudioCtx() no-ops.
    vi.stubGlobal('AudioContext', class {
      state = 'running'
      currentTime = 0
      destination = {}
      resume() {}
      createOscillator() {
        return { connect: vi.fn(), frequency: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, start: vi.fn(), stop: vi.fn() }
      }
      createGain() {
        return { connect: vi.fn(), gain: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } }
      }
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    // NB: don't call vi.unstubAllGlobals() — it would also drop the shared
    // localStorage mock installed by src/__tests__/setup.ts.
  })

  it('ticks the countdown down while mounted', () => {
    const { wrapper, ctrl } = mountController()
    ctrl.setRestDuration(60)
    ctrl.startRestTimer()
    expect(ctrl.timerSeconds.value).toBe(60)
    vi.advanceTimersByTime(3000)
    expect(ctrl.timerSeconds.value).toBeLessThan(60)
    wrapper.unmount()
  })

  it('stops ticking after the owning component unmounts', () => {
    const { wrapper, ctrl } = mountController()
    ctrl.setRestDuration(60)
    ctrl.startRestTimer()
    vi.advanceTimersByTime(2000)
    const secondsAtUnmount = ctrl.timerSeconds.value
    expect(secondsAtUnmount).toBeLessThan(60)

    wrapper.unmount()

    // The interval must have been cleared — advancing time further must not
    // mutate the (now orphaned) countdown ref.
    vi.advanceTimersByTime(10000)
    expect(ctrl.timerSeconds.value).toBe(secondsAtUnmount)
  })
})
