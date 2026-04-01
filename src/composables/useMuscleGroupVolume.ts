import { computed, type Ref } from 'vue'
import { getMuscleGroups, MUSCLE_GROUPS, type MuscleGroup } from '../lib/muscleGroups'
import type { Exercise } from '../stores/workout'

export interface MuscleGroupSets {
  group: MuscleGroup
  sets: number
}

/**
 * Computes weekly sets per muscle group from exercises and a list of
 * date strings representing the 7 days of the week.
 *
 * @param exercises - reactive list of all exercises
 * @param weekDates - reactive list of 7 YYYY-MM-DD date strings for the week
 * @returns computed array of { group, sets } sorted by MUSCLE_GROUPS order
 */
export function useMuscleGroupVolume(
  exercises: Ref<Exercise[]>,
  weekDates: Ref<string[]>
) {
  const weeklyVolume = computed((): MuscleGroupSets[] => {
    const dateSet = new Set(weekDates.value)
    const counts: Record<string, number> = {}

    for (const exercise of exercises.value) {
      const groups = getMuscleGroups(exercise.tags)
      if (groups.length === 0) continue

      let setCount = 0
      for (const set of exercise.sets) {
        if (dateSet.has(set.date.slice(0, 10))) {
          setCount++
        }
      }

      if (setCount === 0) continue

      for (const group of groups) {
        counts[group] = (counts[group] || 0) + setCount
      }
    }

    // Return all muscle groups that have sets, in canonical order
    return MUSCLE_GROUPS
      .filter(g => (counts[g] || 0) > 0)
      .map(g => ({ group: g, sets: counts[g] }))
  })

  const maxSets = computed(() => {
    if (weeklyVolume.value.length === 0) return 0
    return Math.max(...weeklyVolume.value.map(v => v.sets))
  })

  const totalSets = computed(() =>
    weeklyVolume.value.reduce((sum, v) => sum + v.sets, 0)
  )

  return { weeklyVolume, maxSets, totalSets }
}
