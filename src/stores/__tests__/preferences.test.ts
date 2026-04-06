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

  describe('weight goal', () => {
    it('defaults to lose direction with no targets', () => {
      expect(store.weightGoal.direction).toBe('lose')
      expect(store.weightGoal.loseTarget).toBeNull()
      expect(store.weightGoal.gainTarget).toBeNull()
      expect(store.weightGoal.maintainMin).toBeNull()
      expect(store.weightGoal.maintainMax).toBeNull()
    })

    it('each direction remembers its own target', () => {
      store.setTargetForDirection(150) // lose target
      store.setWeightGoalDirection('gain')
      store.setTargetForDirection(200) // gain target

      expect(store.weightGoal.loseTarget).toBe(150)
      expect(store.weightGoal.gainTarget).toBe(200)
    })

    it('currentTarget getter returns active direction target', () => {
      store.setTargetForDirection(150) // lose
      expect(store.currentTarget).toBe(150)

      store.setWeightGoalDirection('gain')
      expect(store.currentTarget).toBeNull()

      store.setTargetForDirection(200) // gain
      expect(store.currentTarget).toBe(200)

      store.setWeightGoalDirection('lose')
      expect(store.currentTarget).toBe(150)

      store.setWeightGoalDirection('maintain')
      expect(store.currentTarget).toBeNull()
    })

    it('preserves all values when switching direction', () => {
      store.setTargetForDirection(150) // lose
      store.setWeightGoalDirection('gain')
      store.setTargetForDirection(200)
      store.setWeightGoalDirection('maintain')
      store.setMaintainRange(160, 180)

      // Switch around and verify nothing is lost
      store.setWeightGoalDirection('lose')
      expect(store.weightGoal.loseTarget).toBe(150)
      expect(store.weightGoal.gainTarget).toBe(200)
      expect(store.weightGoal.maintainMin).toBe(160)
      expect(store.weightGoal.maintainMax).toBe(180)
    })

    it('clearAllGoalValues clears everything', () => {
      store.setTargetForDirection(150)
      store.setWeightGoalDirection('gain')
      store.setTargetForDirection(200)
      store.setWeightGoalDirection('maintain')
      store.setMaintainRange(160, 180)

      store.clearAllGoalValues()
      expect(store.weightGoal.loseTarget).toBeNull()
      expect(store.weightGoal.gainTarget).toBeNull()
      expect(store.weightGoal.maintainMin).toBeNull()
      expect(store.weightGoal.maintainMax).toBeNull()
    })

    it('hasAnyGoalValue detects any set value', () => {
      expect(store.hasAnyGoalValue).toBe(false)
      store.setTargetForDirection(150)
      expect(store.hasAnyGoalValue).toBe(true)
    })

    it('sets maintain range with both bounds', () => {
      store.setWeightGoalDirection('maintain')
      store.setMaintainRange(150, 175)
      expect(store.weightGoal.maintainMin).toBe(150)
      expect(store.weightGoal.maintainMax).toBe(175)
    })

    it('sets maintain range with min only', () => {
      store.setWeightGoalDirection('maintain')
      store.setMaintainRange(150, null)
      expect(store.weightGoal.maintainMin).toBe(150)
      expect(store.weightGoal.maintainMax).toBeNull()
    })

    it('sets maintain range with max only', () => {
      store.setWeightGoalDirection('maintain')
      store.setMaintainRange(null, 175)
      expect(store.weightGoal.maintainMin).toBeNull()
      expect(store.weightGoal.maintainMax).toBe(175)
    })

    it('persists weight goal to localStorage', () => {
      store.setWeightGoalDirection('gain')
      store.setTargetForDirection(200)
      const stored = JSON.parse(localStorageMock.getItem('user-preferences')!)
      expect(stored.weightGoal.direction).toBe('gain')
      expect(stored.weightGoal.gainTarget).toBe(200)
    })

    it('migrates old string weightGoal format on init', async () => {
      localStorageMock.setItem('user-preferences', JSON.stringify({
        features: { workouts: true, calendar: true, weight: true },
        weightGoal: 'gain',
      }))

      const pinia = createPinia()
      setActivePinia(pinia)
      const freshStore = usePreferencesStore()
      await freshStore.init('test-user')

      expect(freshStore.weightGoal.direction).toBe('gain')
    })

    it('migrates v2 targetWeight to direction-specific field', async () => {
      localStorageMock.setItem('user-preferences', JSON.stringify({
        features: { workouts: true, calendar: true, weight: true },
        weightGoal: { direction: 'lose', targetWeight: 165, maintainMin: null, maintainMax: null },
      }))

      const pinia = createPinia()
      setActivePinia(pinia)
      const freshStore = usePreferencesStore()
      await freshStore.init('test-user')

      expect(freshStore.weightGoal.loseTarget).toBe(165)
      expect(freshStore.weightGoal.gainTarget).toBeNull()
    })

    it('loads full weight goal config on init', async () => {
      localStorageMock.setItem('user-preferences', JSON.stringify({
        features: { workouts: true, calendar: true, weight: true },
        weightGoal: { direction: 'maintain', loseTarget: 150, gainTarget: 200, maintainMin: 160, maintainMax: 180 },
      }))

      const pinia = createPinia()
      setActivePinia(pinia)
      const freshStore = usePreferencesStore()
      await freshStore.init('test-user')

      expect(freshStore.weightGoal.direction).toBe('maintain')
      expect(freshStore.weightGoal.loseTarget).toBe(150)
      expect(freshStore.weightGoal.gainTarget).toBe(200)
      expect(freshStore.weightGoal.maintainMin).toBe(160)
      expect(freshStore.weightGoal.maintainMax).toBe(180)
    })
  })
})
