import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePreferencesStore, _migrateWeightGoal } from '../preferences'
import { getLocalStorageMock } from '../../__tests__/helpers'

vi.mock('../../lib/durableStorage', () => ({
  backupToIDB: vi.fn(),
}))

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

    it('backs up to IndexedDB on persist', async () => {
      const { backupToIDB } = await import('../../lib/durableStorage')
      vi.mocked(backupToIDB).mockClear()

      store.toggleFeature('calendar')

      expect(backupToIDB).toHaveBeenCalledWith(
        'user-preferences',
        expect.stringContaining('"calendar":false'),
      )
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

  describe('_migrateWeightGoal runtime validation', () => {
    it('migrates valid v1 string direction', () => {
      expect(_migrateWeightGoal('gain')).toEqual({
        direction: 'gain',
        loseTarget: null,
        gainTarget: null,
        maintainMin: null,
        maintainMax: null,
      })
    })

    it('returns default for unrecognized v1 string', () => {
      const result = _migrateWeightGoal('bulking')
      expect(result.direction).toBe('lose') // default
    })

    it('returns default for null input', () => {
      const result = _migrateWeightGoal(null)
      expect(result.direction).toBe('lose')
      expect(result.loseTarget).toBeNull()
    })

    it('returns default for undefined input', () => {
      const result = _migrateWeightGoal(undefined)
      expect(result.direction).toBe('lose')
    })

    it('returns default for numeric input', () => {
      const result = _migrateWeightGoal(42)
      expect(result.direction).toBe('lose')
    })

    it('returns default for boolean input', () => {
      const result = _migrateWeightGoal(true)
      expect(result.direction).toBe('lose')
    })

    it('returns default for array input', () => {
      const result = _migrateWeightGoal([1, 2, 3])
      expect(result.direction).toBe('lose')
    })

    it('migrates valid v3 object with all fields', () => {
      const result = _migrateWeightGoal({
        direction: 'maintain',
        loseTarget: 150,
        gainTarget: 200,
        maintainMin: 160,
        maintainMax: 180,
      })
      expect(result).toEqual({
        direction: 'maintain',
        loseTarget: 150,
        gainTarget: 200,
        maintainMin: 160,
        maintainMax: 180,
      })
    })

    it('fills defaults for missing fields in v3 object', () => {
      const result = _migrateWeightGoal({ direction: 'gain' })
      expect(result).toEqual({
        direction: 'gain',
        loseTarget: null,
        gainTarget: null,
        maintainMin: null,
        maintainMax: null,
      })
    })

    it('uses default direction when object has invalid direction', () => {
      const result = _migrateWeightGoal({ direction: 'shred', loseTarget: 150 })
      expect(result.direction).toBe('lose')
      expect(result.loseTarget).toBe(150)
    })

    it('ignores non-number target values', () => {
      const result = _migrateWeightGoal({
        direction: 'lose',
        loseTarget: 'heavy',
        gainTarget: true,
        maintainMin: {},
      })
      expect(result.loseTarget).toBeNull()
      expect(result.gainTarget).toBeNull()
      expect(result.maintainMin).toBeNull()
    })

    it('migrates v2 object with targetWeight to loseTarget', () => {
      const result = _migrateWeightGoal({
        direction: 'lose',
        targetWeight: 165,
      })
      expect(result.loseTarget).toBe(165)
    })

    it('migrates v2 object with targetWeight to gainTarget when direction is gain', () => {
      const result = _migrateWeightGoal({
        direction: 'gain',
        targetWeight: 200,
      })
      expect(result.gainTarget).toBe(200)
    })

    it('ignores non-number targetWeight in v2 migration', () => {
      const result = _migrateWeightGoal({
        direction: 'lose',
        targetWeight: 'heavy',
      })
      expect(result.loseTarget).toBeNull()
    })

    it('handles empty object gracefully', () => {
      const result = _migrateWeightGoal({})
      expect(result.direction).toBe('lose')
      expect(result.loseTarget).toBeNull()
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

  describe('synced settings (theme, colorMode, weightUnit, restTimer)', () => {
    it('defaults to expected values', () => {
      expect(store.theme).toBe('eternal')
      expect(store.colorMode).toBe('dark')
      expect(store.weightUnit).toBe('lbs')
      expect(store.restTimerEnabled).toBe(true)
      expect(store.restTimerAutoStart).toBe(true)
    })

    it('setTheme updates and persists', () => {
      store.setTheme('fire')
      expect(store.theme).toBe('fire')
      const stored = JSON.parse(localStorageMock.getItem('user-preferences')!)
      expect(stored.theme).toBe('fire')
    })

    it('setColorMode updates and persists', () => {
      store.setColorMode('light')
      expect(store.colorMode).toBe('light')
      const stored = JSON.parse(localStorageMock.getItem('user-preferences')!)
      expect(stored.colorMode).toBe('light')
    })

    it('setWeightUnit updates and persists', () => {
      store.setWeightUnit('kg')
      expect(store.weightUnit).toBe('kg')
      const stored = JSON.parse(localStorageMock.getItem('user-preferences')!)
      expect(stored.weightUnit).toBe('kg')
    })

    it('setRestTimer updates and persists', () => {
      store.setRestTimer(false)
      expect(store.restTimerEnabled).toBe(false)
      const stored = JSON.parse(localStorageMock.getItem('user-preferences')!)
      expect(stored.restTimerEnabled).toBe(false)
    })

    it('setRestTimerAutoStart updates and persists', () => {
      store.setRestTimerAutoStart(false)
      expect(store.restTimerAutoStart).toBe(false)
      const stored = JSON.parse(localStorageMock.getItem('user-preferences')!)
      expect(stored.restTimerAutoStart).toBe(false)
    })

    it('_persist writes individual localStorage keys for FOUC prevention', () => {
      store.setTheme('water')
      store.setColorMode('auto')
      store.setWeightUnit('kg')
      store.setRestTimer(false)
      store.setRestTimerAutoStart(false)

      expect(localStorageMock.getItem('app-theme')).toBe('water')
      expect(localStorageMock.getItem('app-mode')).toBe('auto')
      expect(localStorageMock.getItem('weight-unit')).toBe('kg')
      expect(localStorageMock.getItem('rest-timer')).toBe('off')
      expect(localStorageMock.getItem('rest-timer-autostart')).toBe('off')
    })

    it('init loads synced settings from JSON blob', async () => {
      localStorageMock.setItem('user-preferences', JSON.stringify({
        features: { workouts: true, calendar: true, weight: true },
        theme: 'midnight',
        colorMode: 'light',
        weightUnit: 'kg',
        restTimerEnabled: false,
        restTimerAutoStart: false,
      }))

      const pinia = createPinia()
      setActivePinia(pinia)
      const freshStore = usePreferencesStore()
      await freshStore.init('test-user')

      expect(freshStore.theme).toBe('midnight')
      expect(freshStore.colorMode).toBe('light')
      expect(freshStore.weightUnit).toBe('kg')
      expect(freshStore.restTimerEnabled).toBe(false)
      expect(freshStore.restTimerAutoStart).toBe(false)
    })

    it('init migrates from standalone localStorage keys when JSON blob lacks them', async () => {
      // Simulate an old client that stored settings as individual keys
      localStorageMock.setItem('user-preferences', JSON.stringify({
        features: { workouts: true, calendar: true, weight: true },
      }))
      localStorageMock.setItem('app-theme', 'fire')
      localStorageMock.setItem('app-mode', 'light')
      localStorageMock.setItem('weight-unit', 'kg')
      localStorageMock.setItem('rest-timer', 'off')
      localStorageMock.setItem('rest-timer-autostart', 'off')

      const pinia = createPinia()
      setActivePinia(pinia)
      const freshStore = usePreferencesStore()
      await freshStore.init('test-user')

      expect(freshStore.theme).toBe('fire')
      expect(freshStore.colorMode).toBe('light')
      expect(freshStore.weightUnit).toBe('kg')
      expect(freshStore.restTimerEnabled).toBe(false)
      expect(freshStore.restTimerAutoStart).toBe(false)
    })

    it('_reloadFromStorage picks up synced settings', () => {
      localStorageMock.setItem('user-preferences', JSON.stringify({
        features: { workouts: true, calendar: true, weight: true },
        theme: 'love',
        colorMode: 'auto',
        weightUnit: 'kg',
        restTimerEnabled: false,
        restTimerAutoStart: false,
      }))

      store._reloadFromStorage()

      expect(store.theme).toBe('love')
      expect(store.colorMode).toBe('auto')
      expect(store.weightUnit).toBe('kg')
      expect(store.restTimerEnabled).toBe(false)
      expect(store.restTimerAutoStart).toBe(false)
    })

    it('synced settings are included in persist payload alongside existing fields', () => {
      store.setTheme('earth')
      const stored = JSON.parse(localStorageMock.getItem('user-preferences')!)
      expect(stored.theme).toBe('earth')
      expect(stored.features).toBeDefined()
      expect(stored.weightGoal).toBeDefined()
      expect(stored.experience).toBeDefined()
      expect(stored.filters).toBeDefined()
    })
  })
})
