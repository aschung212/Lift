import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

// Must import after mocks set up by vitest setup
const { useWeightUnit } = await import('../useWeightUnit')

describe('useWeightUnit', () => {
  let unit: ReturnType<typeof useWeightUnit>

  beforeEach(() => {
    localStorageMock.clear()
    localStorageMock.setItem.mockClear()
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
      const { nextTick } = await import('vue')
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
})
