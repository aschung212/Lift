import { computed, type ComputedRef, type Ref } from 'vue'
import type { Exercise } from '../stores/workout'

export type RepZoneId = 'strength' | 'hypertrophy' | 'endurance'

export interface RepZone {
  id: RepZoneId
  /** Human label for the training emphasis. */
  label: string
  /** Rep-range description, e.g. "1–5". */
  range: string
  /** Number of sets that fell into this zone. */
  sets: number
}

export interface UseRepRangeDistributionReturn {
  /** Always three zones, in fixed strength → hypertrophy → endurance order. */
  zones: ComputedRef<RepZone[]>
  /** Total sets counted across all three zones. */
  totalSets: ComputedRef<number>
  /** The zone with the most sets, or null when there are no sets. */
  dominant: ComputedRef<RepZone | null>
}

/**
 * Classifies a set's rep count into a training-emphasis zone.
 * Boundaries follow the widely-used strength (1–5), hypertrophy (6–12),
 * and muscular-endurance (13+) bands. Sets with fewer than 1 rep are ignored.
 */
export function classifyRepZone(reps: number): RepZoneId | null {
  if (!Number.isFinite(reps) || reps < 1) return null
  if (reps <= 5) return 'strength'
  if (reps <= 12) return 'hypertrophy'
  return 'endurance'
}

const ZONE_META: Record<RepZoneId, { label: string; range: string }> = {
  strength: { label: 'Strength', range: '1–5' },
  hypertrophy: { label: 'Hypertrophy', range: '6–12' },
  endurance: { label: 'Endurance', range: '13+' },
}

const ZONE_ORDER: RepZoneId[] = ['strength', 'hypertrophy', 'endurance']

/**
 * Buckets every logged set across the given exercises into strength,
 * hypertrophy, and endurance rep zones. Requires no new data capture —
 * derived purely from the reps already stored on each set. Surfaces a
 * training-balance insight (am I training for strength vs size?).
 */
export function useRepRangeDistribution(
  exercises: Ref<Exercise[]>,
): UseRepRangeDistributionReturn {
  const zones = computed((): RepZone[] => {
    const counts: Record<RepZoneId, number> = {
      strength: 0,
      hypertrophy: 0,
      endurance: 0,
    }

    for (const exercise of exercises.value) {
      for (const set of exercise.sets) {
        const zone = classifyRepZone(set.reps)
        if (zone) counts[zone]++
      }
    }

    return ZONE_ORDER.map((id) => ({
      id,
      label: ZONE_META[id].label,
      range: ZONE_META[id].range,
      sets: counts[id],
    }))
  })

  const totalSets = computed(() =>
    zones.value.reduce((sum, z) => sum + z.sets, 0),
  )

  const dominant = computed((): RepZone | null => {
    if (totalSets.value === 0) return null
    return zones.value.reduce((best, z) => (z.sets > best.sets ? z : best))
  })

  return { zones, totalSets, dominant }
}
