import { computed, type ComputedRef, type Ref } from 'vue'
import type { Exercise } from '../stores/workout'

export type RepZoneKey = 'strength' | 'hypertrophy' | 'endurance'

export interface RepZone {
  key: RepZoneKey
  label: string
  range: string
  sets: number
}

export interface UseRepRangeDistributionReturn {
  zones: ComputedRef<RepZone[]>
  totalSets: ComputedRef<number>
  hasData: ComputedRef<boolean>
}

/**
 * Classify a rep count into a training-intensity zone.
 * Strength: 1-5, Hypertrophy: 6-12, Endurance: 13+.
 * Returns null for non-positive rep counts (ignored).
 */
export function classifyRepZone(reps: number): RepZoneKey | null {
  if (!Number.isFinite(reps) || reps < 1) return null
  if (reps <= 5) return 'strength'
  if (reps <= 12) return 'hypertrophy'
  return 'endurance'
}

/**
 * Computes the distribution of sets across strength / hypertrophy / endurance
 * rep ranges for a given week, derived entirely from existing weight/reps data.
 * Mirrors useTagVolume's inputs so it can share the same reactive refs.
 */
export function useRepRangeDistribution(
  exercises: Ref<Exercise[]>,
  weekDates: Ref<string[]>
): UseRepRangeDistributionReturn {
  const zones = computed((): RepZone[] => {
    const dateSet = new Set(weekDates.value)
    const counts: Record<RepZoneKey, number> = {
      strength: 0,
      hypertrophy: 0,
      endurance: 0,
    }

    for (const exercise of exercises.value) {
      for (const set of exercise.sets) {
        if (!dateSet.has(set.date.slice(0, 10))) continue
        const zone = classifyRepZone(set.reps)
        if (zone) counts[zone]++
      }
    }

    return [
      { key: 'strength', label: 'Strength', range: '1–5 reps', sets: counts.strength },
      { key: 'hypertrophy', label: 'Hypertrophy', range: '6–12 reps', sets: counts.hypertrophy },
      { key: 'endurance', label: 'Endurance', range: '13+ reps', sets: counts.endurance },
    ]
  })

  const totalSets = computed(() =>
    zones.value.reduce((sum, z) => sum + z.sets, 0)
  )

  const hasData = computed(() => totalSets.value > 0)

  return { zones, totalSets, hasData }
}
