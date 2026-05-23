import { ref, watch, type Ref } from 'vue'
import type { WeightUnit } from '../lib/themes'

const weightUnit: Ref<WeightUnit> = ref((localStorage.getItem('weight-unit') || 'lbs') as WeightUnit)
watch(weightUnit, (v) => localStorage.setItem('weight-unit', v))

export interface UseWeightUnitReturn {
  weightUnit: Ref<WeightUnit>
  displayWeight: (lbs: number) => number
  toLbs: (value: number) => number
}

export function useWeightUnit(): UseWeightUnitReturn {
  function displayWeight(lbs: number): number {
    if (weightUnit.value === 'kg') return +(lbs * 0.453592).toFixed(1)
    return +lbs.toFixed(1)
  }

  function toLbs(value: number): number {
    if (weightUnit.value === 'kg') return +(value / 0.453592).toFixed(1)
    return value
  }

  return { weightUnit, displayWeight, toLbs }
}
