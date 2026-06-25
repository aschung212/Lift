import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

// Must import after mocks set up by vitest setup
const { useWeightUnit } = await import('../useWeightUnit')
const { usePreferencesStore } = await import('../../stores/preferences')

describe('useWeightUnit', () => {
  let unit: ReturnType<typeof useWeightUnit>

  beforeEach(() => {
    localStorageMock.clear()
    localStorageMock.setItem.mockClear()
    // The preferences store is now the single source of truth (LIFT-821), so a
    // Pinia instance must be active before the composable is used.
    setActivePinia(createPinia())
    unit = useWeightUnit()
  })

  describe('displayWeight', () => {
    it('returns lbs values unchanged when unit is lbs', () => {
      unit.weightUnit.value = 'lbs'
      expect(unit.displayWeight(225)).toBe(225)
    })

    it('converts lbs to kg when unit is kg', () => {
      unit.weightUnit.value = 'kg'
      expect(unit.displayWeight(225)).toBeCloseTo(102.1, 1)
    })
  })

  describe('toLbs', () => {
    it('converts kg input back to lbs', () => {
      unit.weightUnit.value = 'kg'
      expect(unit.toLbs(100)).toBeCloseTo(220.5, 0)
    })

    it('returns value unchanged when unit is lbs', () => {
      unit.weightUnit.value = 'lbs'
      expect(unit.toLbs(225)).toBe(225)
    })
  })

  describe('persistence', () => {
    it('persists unit preference to localStorage', async () => {
      unit.weightUnit.value = 'kg'
      await nextTick()
      expect(localStorageMock.setItem).toHaveBeenCalledWith('weight-unit', 'kg')
    })
  })

  describe('singleton state', () => {
    it('shares reactive state across multiple calls', () => {
      const a = useWeightUnit()
      const b = useWeightUnit()
      a.weightUnit.value = 'kg'
      expect(b.weightUnit.value).toBe('kg')
    })
  })

  // LIFT-821: the composable and the store are the same owner — a change made
  // through either path must be observable through the other and land in
  // localStorage, with no bridge or divergence.
  describe('single source of truth (preferences store)', () => {
    it('reflects writes made through the composable in the store', () => {
      const prefs = usePreferencesStore()
      unit.weightUnit.value = 'kg'
      expect(prefs.weightUnit).toBe('kg')
    })

    it('reflects writes made through the store in the composable', () => {
      const prefs = usePreferencesStore()
      prefs.setWeightUnit('kg')
      expect(unit.weightUnit.value).toBe('kg')
    })
  })
})
