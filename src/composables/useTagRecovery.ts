import { computed, type ComputedRef, type Ref } from 'vue'
import type { Exercise } from '../stores/workout'
import { localDateKey } from '../lib/dates'

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
export interface UseTagRecoveryReturn {
  recovery: ComputedRef<TagRecovery[]>
  hasData: ComputedRef<boolean>
  hiddenCount: ComputedRef<number>
  totalCount: ComputedRef<number>
}

export function useTagRecovery(
  exercises: Ref<Exercise[]>,
  tagRecoveryDays: Ref<Record<string, number>>,
  excludedTags: Ref<string[]>,
  now?: Ref<Date>
): UseTagRecoveryReturn {
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

    // Compare calendar days, not timestamps. Sets are stored with end-of-day
    // UTC times (T23:59:xxZ) so timestamp math drifts depending on timezone
    // and time of day. Calendar day diff is always correct.
    const todayStr = localDateKey(currentTime)
    const todayMs = new Date(todayStr + 'T00:00:00').getTime()

    const results: TagRecovery[] = []
    for (const [tag, dateStr] of Object.entries(latestByTag)) {
      const lastMs = new Date(dateStr + 'T00:00:00').getTime()
      const daysSince = Math.max(0, Math.round((todayMs - lastMs) / 86_400_000))
      const hoursSince = daysSince * 24
      const recDays = tagRecoveryDays.value[tag] ?? null

      let status: TagRecovery['status']
      if (recDays === null) {
        status = 'unknown'
      } else if (daysSince >= recDays) {
        status = 'recovered'
      } else if (daysSince * 2 >= recDays) {
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

  // Count how many excluded tags actually have logged sets
  const hiddenCount = computed((): number => {
    const excluded = new Set(excludedTags.value)
    const hiddenWithSets = new Set<string>()
    for (const exercise of exercises.value) {
      if (!exercise.tags || exercise.tags.length === 0) continue
      for (const set of exercise.sets) {
        if (set.date) {
          for (const tag of exercise.tags) {
            if (excluded.has(tag)) hiddenWithSets.add(tag)
          }
        }
      }
    }
    return hiddenWithSets.size
  })

  // Total tags with data (visible + hidden)
  const totalCount = computed(() => recovery.value.length + hiddenCount.value)

  const hasData = computed(() => totalCount.value > 0)

  return { recovery, hasData, hiddenCount, totalCount }
}
