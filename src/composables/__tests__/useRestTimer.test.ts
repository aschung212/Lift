import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

const { useRestTimer } = await import('../useRestTimer')

describe('useRestTimer', () => {
  let timer: ReturnType<typeof useRestTimer>

  beforeEach(() => {
    localStorageMock.clear()
    localStorageMock.setItem.mockClear()
    timer = useRestTimer()
  })

  it('defaults to enabled', () => {
    expect(timer.restTimerEnabled.value).toBe(true)
  })

  it('persists enabled state to localStorage', async () => {
    timer.restTimerEnabled.value = false
    await nextTick()
    expect(localStorageMock.setItem).toHaveBeenCalledWith('rest-timer', 'off')
    timer.restTimerEnabled.value = true
    await nextTick()
    expect(localStorageMock.setItem).toHaveBeenCalledWith('rest-timer', 'on')
  })

  it('persists autostart state to localStorage', async () => {
    timer.restTimerAutoStart.value = false
    await nextTick()
    expect(localStorageMock.setItem).toHaveBeenCalledWith('rest-timer-autostart', 'off')
  })

  it('provides setRestTimerEnabled helper', () => {
    timer.setRestTimerEnabled(false)
    expect(timer.restTimerEnabled.value).toBe(false)
    timer.setRestTimerEnabled(true)
    expect(timer.restTimerEnabled.value).toBe(true)
  })

  it('shares reactive state across multiple calls', () => {
    const a = useRestTimer()
    const b = useRestTimer()
    a.restTimerEnabled.value = false
    expect(b.restTimerEnabled.value).toBe(false)
  })
})
