import { computed, type Ref } from 'vue'
import type { Exercise } from '../stores/workout'

export interface TagVolume {
  tag: string
  sets: number
}

/**
 * Computes weekly sets per tag from exercises and a list of
 * date strings representing the 7 days of the week.
 */
export function useTagVolume(
  exercises: Ref<Exercise[]>,
  weekDates: Ref<string[]>
) {
  const weeklyVolume = computed((): TagVolume[] => {
    const dateSet = new Set(weekDates.value)
    const counts: Record<string, number> = {}

    for (const exercise of exercises.value) {
      if (!exercise.tags || exercise.tags.length === 0) continue

      let setCount = 0
      for (const set of exercise.sets) {
        if (dateSet.has(set.date.slice(0, 10))) {
          setCount++
        }
      }

      if (setCount === 0) continue

      for (const tag of exercise.tags) {
        counts[tag] = (counts[tag] || 0) + setCount
      }
    }

    // Sort by set count descending
    return Object.entries(counts)
      .map(([tag, sets]) => ({ tag, sets }))
      .sort((a, b) => b.sets - a.sets)
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
