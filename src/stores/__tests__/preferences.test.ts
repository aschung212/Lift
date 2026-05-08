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

  describe('experience flags', () => {
    it('defaults prCelebrations and haptics to enabled', () => {
      expect(store.experience.prCelebrations).toBe(true)
      expect(store.experience.haptics).toBe(true)
    })

    it('setExperienceFlag updates state and persists', () => {
      store.setExperienceFlag('prCelebrations', false)
      expect(store.experience.prCelebrations).toBe(false)

      const stored = JSON.parse(localStorageMock.getItem('user-preferences') as string)
      expect(stored.experience.prCelebrations).toBe(false)
      expect(stored.experience.haptics).toBe(true)
    })

    it('init() rehydrates experience flags from localStorage', async () => {
      localStorageMock.setItem('user-preferences', JSON.stringify({
        features: { workouts: true, calendar: true, weight: true },
        experience: { prCelebrations: false, haptics: false },
      }))

      const pinia = createPinia()
      setActivePinia(pinia)
      const freshStore = usePreferencesStore()
      await freshStore.init('test-user')

      expect(freshStore.experience.prCelebrations).toBe(false)
      expect(freshStore.experience.haptics).toBe(false)
    })

    it('init() backfills missing experience keys with defaults', async () => {
      // Older clients may have persisted prefs without experience — make sure
      // init() merges defaults rather than leaving the field undefined.
      localStorageMock.setItem('user-preferences', JSON.stringify({
        features: { workouts: true, calendar: true, weight: true },
      }))

      const pinia = createPinia()
      setActivePinia(pinia)
      const freshStore = usePreferencesStore()
      await freshStore.init('test-user')

      expect(freshStore.experience.prCelebrations).toBe(true)
      expect(freshStore.experience.haptics).toBe(true)
    })
  })

  describe('prBaselineDate', () => {
    it('defaults to null', () => {
      expect(store.prBaselineDate).toBeNull()
    })

    it('setPRBaselineDate sets and persists a valid date', () => {
      store.setPRBaselineDate('2026-01-15')
      expect(store.prBaselineDate).toBe('2026-01-15')
      const stored = JSON.parse(localStorageMock.getItem('user-preferences')!)
      expect(stored.prBaselineDate).toBe('2026-01-15')
    })

    it('setPRBaselineDate rejects invalid dates', () => {
      store.setPRBaselineDate('2026-01-15')
      store.setPRBaselineDate('bad-date')
      expect(store.prBaselineDate).toBe('2026-01-15')
    })

    it('setPRBaselineDate accepts null to clear', () => {
      store.setPRBaselineDate('2026-01-15')
      store.setPRBaselineDate(null)
      expect(store.prBaselineDate).toBeNull()
    })

    it('startNewTrainingBlock sets today', () => {
      store.startNewTrainingBlock()
      const d = new Date()
      const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      expect(store.prBaselineDate).toBe(expected)
    })

    it('clearPRBaseline sets to null', () => {
      store.setPRBaselineDate('2026-01-15')
      store.clearPRBaseline()
      expect(store.prBaselineDate).toBeNull()
    })

    it('init loads prBaselineDate from localStorage', async () => {
      localStorageMock.setItem('user-preferences', JSON.stringify({
        features: { workouts: true, calendar: true, weight: true },
        prBaselineDate: '2026-04-01',
      }))

      const pinia = createPinia()
      setActivePinia(pinia)
      const freshStore = usePreferencesStore()
      await freshStore.init('test-user')

      expect(freshStore.prBaselineDate).toBe('2026-04-01')
    })

    it('init migrates from old pr-baseline-date localStorage key', async () => {
      localStorageMock.setItem('pr-baseline-date', '2026-03-15')

      const pinia = createPinia()
      setActivePinia(pinia)
      const freshStore = usePreferencesStore()
      await freshStore.init('test-user')

      expect(freshStore.prBaselineDate).toBe('2026-03-15')
      expect(localStorageMock.getItem('pr-baseline-date')).toBeNull()
    })

    it('init does not migrate invalid legacy values', async () => {
      localStorageMock.setItem('pr-baseline-date', 'not-a-date')

      const pinia = createPinia()
      setActivePinia(pinia)
      const freshStore = usePreferencesStore()
      await freshStore.init('test-user')

      expect(freshStore.prBaselineDate).toBeNull()
    })

    it('prBaselineDate is included in persist payload', () => {
      store.setPRBaselineDate('2026-05-01')
      const stored = JSON.parse(localStorageMock.getItem('user-preferences')!)
      expect(stored.prBaselineDate).toBe('2026-05-01')
      expect(stored.features).toBeDefined()
      expect(stored.weightGoal).toBeDefined()
      expect(stored.experience).toBeDefined()
    })
  })
})
