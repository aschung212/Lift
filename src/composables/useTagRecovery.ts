import { computed, type Ref } from 'vue'
import type { Exercise } from '../stores/workout'

export interface TagRecovery {
  tag: string
  lastTrainedDate: string
  hoursSince: number
  daysSince: number
  recoveryDays: number | null
  status: 'recovered' | 'recovering' | 'recent' | 'unknown'
}

/**
 * Computes per-tag recovery status from exercises.
 * For each tag in use, finds the most recent set date and calculates days since.
 * Tags in the excluded list are omitted entirely.
 * If a recovery window (in days) is set for the tag, classifies status accordingly.
 */
export function useTagRecovery(
  exercises: Ref<Exercise[]>,
  tagRecoveryDays: Ref<Record<string, number>>,
  excludedTags: Ref<string[]>,
  now?: Ref<Date>
) {
  const recovery = computed((): TagRecovery[] => {
    const currentTime = now?.value ?? new Date()
    const excluded = new Set(excludedTags.value)
    const latestByTag: Record<string, string> = {}

    for (const exercise of exercises.value) {
      if (!exercise.tags || exercise.tags.length === 0) continue
      for (const set of exercise.sets) {
        const dateStr = set.date.slice(0, 10)
        for (const tag of exercise.tags) {
          if (excluded.has(tag)) continue
          if (!latestByTag[tag] || dateStr > latestByTag[tag]) {
            latestByTag[tag] = dateStr
          }
        }
      }
    }

    const results: TagRecovery[] = []
    for (const [tag, dateStr] of Object.entries(latestByTag)) {
      const lastDate = new Date(dateStr + 'T12:00:00')
      const rawHours = (currentTime.getTime() - lastDate.getTime()) / 3_600_000
      const hoursSince = Math.max(0, rawHours)
      const daysSince = Math.floor(hoursSince / 24)
      const recDays = tagRecoveryDays.value[tag] ?? null
      const recHours = recDays !== null ? recDays * 24 : null

      let status: TagRecovery['status']
      if (recHours === null) {
        status = 'unknown'
      } else if (hoursSince >= recHours) {
        status = 'recovered'
      } else if (hoursSince >= recHours * 0.5) {
        status = 'recovering'
      } else {
        status = 'recent'
      }

      results.push({ tag, lastTrainedDate: dateStr, hoursSince, daysSince, recoveryDays: recDays, status })
    }

    // Sort: recovered first (most days desc), then unknown (most days desc), then recovering, then recent
    const statusOrder: Record<TagRecovery['status'], number> = {
      recovered: 0,
      unknown: 1,
      recovering: 2,
      recent: 3,
    }
    results.sort((a, b) => {
      const so = statusOrder[a.status] - statusOrder[b.status]
      if (so !== 0) return so
      return b.daysSince - a.daysSince
    })

    return results
  })

  const hasData = computed(() => recovery.value.length > 0)

  return { recovery, hasData }
}
