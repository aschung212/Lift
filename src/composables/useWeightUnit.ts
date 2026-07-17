import { computed, type Ref } from 'vue'
import { usePreferencesStore } from '../stores/preferences'
import type { WeightUnit } from '../lib/themes'

export interface UseWeightUnitReturn {
  weightUnit: Ref<WeightUnit>
  displayWeight: (lbs: number) => number
  toLbs: (value: number) => number
}

/**
 * Weight-unit accessor. The preferences store is the single source of truth
 * (LIFT-821) — `weightUnit` is a writable computed bound to `preferences.weightUnit`,
 * so reads reflect the store and writes flow through `setWeightUnit` (which persists
 * the blob + legacy `weight-unit` key + Supabase). This composable no longer holds
 * its own module-scope ref or touches localStorage directly.
 */
export function useWeightUnit(): UseWeightUnitReturn {
  const prefs = usePreferencesStore()

  const weightUnit = computed<WeightUnit>({
    get: () => prefs.weightUnit as WeightUnit,
    set: (v) => prefs.setWeightUnit(v),
  })

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
