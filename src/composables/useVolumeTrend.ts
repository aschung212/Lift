import { computed, type ComputedRef, type Ref } from 'vue'
import type { Exercise } from '../stores/workout'
import type { TimeSeriesEntry } from './useSVGTimeSeries'

export interface UseVolumeTrendReturn {
  /**
   * Total training volume (weight × reps, in stored lbs) bucketed by ISO week.
   * `date` is the Monday of each week (YYYY-MM-DD); empty weeks between the
   * first and last trained week are filled with 0 so rest weeks show as dips.
   */
  weeklyVolume: ComputedRef<TimeSeriesEntry[]>
  /** Sum of all weekly volume, in stored lbs. */
  totalVolume: ComputedRef<number>
  /** Number of weeks in the trend (including filled empty weeks). */
  weekCount: ComputedRef<number>
}

/** Monday (ISO week start) of a YYYY-MM-DD local date key. */
function mondayOfWeek(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const dow = date.getDay()
  const daysSinceMonday = dow === 0 ? 6 : dow - 1
  date.setDate(date.getDate() - daysSinceMonday)
  return toKey(date)
}

/** Advance a YYYY-MM-DD week-start key by 7 days. */
function nextWeek(weekStart: string): string {
  const [y, m, d] = weekStart.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + 7)
  return toKey(date)
}

function toKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Aggregates total training volume per ISO week across the full set history.
 * Used to surface a week-over-week volume trend line in the calendar/stats area.
 */
export function useVolumeTrend(exercises: Ref<Exercise[]>): UseVolumeTrendReturn {
  const weeklyVolume = computed((): TimeSeriesEntry[] => {
    const byWeek = new Map<string, number>()
    for (const exercise of exercises.value) {
      for (const set of exercise.sets) {
        const wk = mondayOfWeek(set.date.slice(0, 10))
        byWeek.set(wk, (byWeek.get(wk) ?? 0) + set.weight * set.reps)
      }
    }
    if (byWeek.size === 0) return []

    const weeks = [...byWeek.keys()].sort()
    const last = weeks[weeks.length - 1]
    const result: TimeSeriesEntry[] = []
    let cursor = weeks[0]
    while (cursor <= last) {
      result.push({ date: cursor, value: Math.round(byWeek.get(cursor) ?? 0) })
      cursor = nextWeek(cursor)
    }
    return result
  })

  const totalVolume = computed(() =>
    weeklyVolume.value.reduce((sum, w) => sum + w.value, 0),
  )

  const weekCount = computed(() => weeklyVolume.value.length)

  return { weeklyVolume, totalVolume, weekCount }
}
