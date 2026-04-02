import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePreferencesStore } from '../preferences'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

describe('usePreferencesStore', () => {
  let store: ReturnType<typeof usePreferencesStore>

  beforeEach(() => {
    localStorageMock.clear()
    setActivePinia(createPinia())
    store = usePreferencesStore()
  })

  describe('default values', () => {
    it('has all features enabled by default', () => {
      expect(store.features.workouts).toBe(true)
      expect(store.features.calendar).toBe(true)
      expect(store.features.weight).toBe(true)
    })

    it('reports correct enabledCount', () => {
      expect(store.enabledCount).toBe(3)
    })
  })

  describe('toggleFeature', () => {
    it('disables a feature when toggled off', () => {
      store.toggleFeature('calendar')
      expect(store.features.calendar).toBe(false)
      expect(store.enabledCount).toBe(2)
    })

    it('re-enables a feature when toggled on', () => {
      store.toggleFeature('calendar')
      store.toggleFeature('calendar')
      expect(store.features.calendar).toBe(true)
    })

    it('prevents disabling the last enabled feature', () => {
      store.toggleFeature('calendar')
      store.toggleFeature('weight')
      // Now only workouts is enabled — toggling it should be blocked
      store.toggleFeature('workouts')
      expect(store.features.workouts).toBe(true)
      expect(store.enabledCount).toBe(1)
    })
  })

  describe('setFeature', () => {
    it('explicitly sets a feature to disabled', () => {
      store.setFeature('weight', false)
      expect(store.features.weight).toBe(false)
    })

    it('explicitly sets a feature to enabled', () => {
      store.setFeature('weight', false)
      store.setFeature('weight', true)
      expect(store.features.weight).toBe(true)
    })
  })

  describe('persistence', () => {
    it('persists feature state to localStorage', () => {
      store.toggleFeature('calendar')
      const stored = JSON.parse(localStorageMock.getItem('user-preferences')!)
      expect(stored.features.calendar).toBe(false)
    })

    it('loads persisted state from localStorage on init', async () => {
      localStorageMock.setItem('user-preferences', JSON.stringify({
        features: { workouts: true, calendar: false, weight: true }
      }))

      const pinia = createPinia()
      setActivePinia(pinia)
      const freshStore = usePreferencesStore()
      await freshStore.init('test-user')

      expect(freshStore.features.calendar).toBe(false)
      expect(freshStore.features.workouts).toBe(true)
    })
  })
})
