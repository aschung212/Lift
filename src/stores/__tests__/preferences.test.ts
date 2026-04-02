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

  describe('setFeature edge cases', () => {
    it('allows disabling the last feature (no guard like toggleFeature)', () => {
      store.setFeature('calendar', false)
      store.setFeature('weight', false)
      store.setFeature('workouts', false)
      expect(store.enabledCount).toBe(0)
    })

    it('handles unknown feature keys', () => {
      store.setFeature('analytics', true)
      expect(store.features.analytics).toBe(true)
      expect(store.enabledCount).toBe(4)
    })
  })

  describe('toggleFeature edge cases', () => {
    it('toggling multiple features tracks enabledCount correctly', () => {
      expect(store.enabledCount).toBe(3)
      store.toggleFeature('calendar')
      expect(store.enabledCount).toBe(2)
      store.toggleFeature('weight')
      expect(store.enabledCount).toBe(1)
      // Can't disable the last one
      store.toggleFeature('workouts')
      expect(store.enabledCount).toBe(1)
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

    it('handles corrupt localStorage gracefully on init', async () => {
      localStorageMock.setItem('user-preferences', 'not-valid-json')

      const pinia = createPinia()
      setActivePinia(pinia)
      const freshStore = usePreferencesStore()
      await freshStore.init('test-user')

      // Should fall back to defaults
      expect(freshStore.features.workouts).toBe(true)
      expect(freshStore.features.calendar).toBe(true)
      expect(freshStore.features.weight).toBe(true)
    })

    it('merges persisted state with defaults for missing keys', async () => {
      // Simulate old localStorage with fewer features
      localStorageMock.setItem('user-preferences', JSON.stringify({
        features: { workouts: false }
      }))

      const pinia = createPinia()
      setActivePinia(pinia)
      const freshStore = usePreferencesStore()
      await freshStore.init('test-user')

      expect(freshStore.features.workouts).toBe(false)
      // Missing keys should get defaults
      expect(freshStore.features.calendar).toBe(true)
      expect(freshStore.features.weight).toBe(true)
    })

    it('init sets userId', async () => {
      await store.init('user-123')
      expect(store._userId).toBe('user-123')
    })
  })
})
