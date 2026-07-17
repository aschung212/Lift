import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

const { useRestTimer } = await import('../useRestTimer')
const { usePreferencesStore } = await import('../../stores/preferences')

describe('useRestTimer', () => {
  let timer: ReturnType<typeof useRestTimer>

  beforeEach(() => {
    localStorageMock.clear()
    localStorageMock.setItem.mockClear()
    // The preferences store is now the single source of truth (LIFT-821).
    setActivePinia(createPinia())
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

  // LIFT-821: composable and store are one owner — writes through either path
  // are observable through the other.
  describe('single source of truth (preferences store)', () => {
    it('reflects composable writes in the store', () => {
      const prefs = usePreferencesStore()
      timer.restTimerEnabled.value = false
      timer.restTimerAutoStart.value = false
      expect(prefs.restTimerEnabled).toBe(false)
      expect(prefs.restTimerAutoStart).toBe(false)
    })

    it('reflects store writes in the composable', () => {
      const prefs = usePreferencesStore()
      prefs.setRestTimer(false)
      prefs.setRestTimerAutoStart(false)
      expect(timer.restTimerEnabled.value).toBe(false)
      expect(timer.restTimerAutoStart.value).toBe(false)
    })
  })
})
