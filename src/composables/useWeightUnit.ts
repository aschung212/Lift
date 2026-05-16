import { ref, watch, type Ref } from 'vue'
import type { WeightUnit } from '../lib/themes'

const isBrowser = typeof localStorage !== 'undefined'

const weightUnit: Ref<WeightUnit> = ref(
  (isBrowser ? localStorage.getItem('weight-unit') || 'lbs' : 'lbs') as WeightUnit
)

if (isBrowser) {
  watch(weightUnit, (v) => localStorage.setItem('weight-unit', v))
}

export function useWeightUnit() {
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
