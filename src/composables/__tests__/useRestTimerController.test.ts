import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getLocalStorageMock, mockRestTimer } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

vi.mock('../useRestTimer', () => mockRestTimer())
vi.mock('../useUndoToast', () => ({
  useUndoToast: () => ({ show: vi.fn() }),
}))
vi.mock('../useNotification', () => ({
  useNotification: () => ({
    notify: vi.fn(),
    requestPermission: vi.fn(),
  }),
  useBackgroundTracker: () => ({
    wasBackgrounded: { value: false },
    startTracking: vi.fn(),
    stopTracking: vi.fn(),
  }),
}))
vi.mock('../../stores/preferences', () => ({
  usePreferencesStore: () => ({
    experience: { restTimerNotification: false },
  }),
}))

const { useRestTimerController, _resetForTesting } = await import('../useRestTimerController')

describe('useRestTimerController', () => {
  describe('drift correction', () => {
    let ctrl: ReturnType<typeof useRestTimerController>

    beforeEach(() => {
      _resetForTesting()
      localStorageMock.clear()
      localStorageMock.setItem.mockClear()
      localStorage.setItem('rest-timer', 'on')
      localStorage.setItem('rest-duration', '90')
      const mockOsc = { connect: vi.fn(), frequency: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, start: vi.fn(), stop: vi.fn() }
      const mockGain = { connect: vi.fn(), gain: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } }
      vi.stubGlobal('AudioContext', class {
        state = 'running'
        currentTime = 0
        destination = {}
        resume = vi.fn()
        createOscillator = vi.fn(() => mockOsc)
        createGain = vi.fn(() => mockGain)
      })
      vi.useFakeTimers({ shouldAdvanceTime: false })
      ctrl = useRestTimerController()
    })

    afterEach(() => {
      ctrl.cleanup()
      vi.useRealTimers()
    })

    it('uses wall-clock time so backgrounding the app does not cause drift', () => {
      const startTime = Date.now()
      vi.setSystemTime(startTime)
      ctrl.startTimer()
      expect(ctrl.timerSeconds.value).toBe(90)

      // Simulate 30 real seconds passing (as if phone was backgrounded)
      vi.setSystemTime(startTime + 30_000)
      vi.advanceTimersByTime(250) // one tick
      expect(ctrl.timerSeconds.value).toBe(60)

      // Simulate 55 more seconds — only 5s should remain
      vi.setSystemTime(startTime + 85_000)
      vi.advanceTimersByTime(250)
      expect(ctrl.timerSeconds.value).toBe(5)
    })

    it('timer reaches zero even if intervals were throttled', () => {
      const startTime = Date.now()
      vi.setSystemTime(startTime)
      ctrl.startTimer()

      // Jump past the full duration in one step
      vi.setSystemTime(startTime + 91_000)
      vi.advanceTimersByTime(250)
      expect(ctrl.timerSeconds.value).toBe(0)
    })
  })

  describe('singleton behavior', () => {
    beforeEach(() => {
      _resetForTesting()
      localStorage.setItem('rest-timer', 'on')
      localStorage.setItem('rest-duration', '60')
    })

    it('returns shared state across multiple calls', () => {
      const ctrl1 = useRestTimerController()
      const ctrl2 = useRestTimerController()
      expect(ctrl1.timerActive).toBe(ctrl2.timerActive)
      expect(ctrl1.restDuration).toBe(ctrl2.restDuration)
      expect(ctrl1.restDuration.value).toBe(60)
    })
  })
})
