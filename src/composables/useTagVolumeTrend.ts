import { computed, type ComputedRef, type Ref } from 'vue'
import type { Exercise } from '../stores/workout'
import type { TimeSeriesEntry } from './useSVGTimeSeries'
import { localDateKey } from '../lib/dates'
import { effectiveSetWeight } from '../lib/bodyweightLoad'

export interface UseTagVolumeTrendReturn {
  /**
   * Per-tag weekly training volume (effective weight × reps, in stored lbs)
   * across the full set history. Each tag's series runs from that tag's first trained week
   * to the most recent trained week across ALL tags, filling intervening (and
   * trailing) gaps with zero so a neglected muscle group shows a declining /
   * flat-zero tail rather than silently dropping off the chart.
   */
  tagTrends: ComputedRef<Record<string, TimeSeriesEntry[]>>
}

/** Monday (ISO week start) of a YYYY-MM-DD local date key. */
function mondayOfWeek(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const dow = date.getDay()
  const daysSinceMonday = dow === 0 ? 6 : dow - 1
  date.setDate(date.getDate() - daysSinceMonday)
  return localDateKey(date)
}

/** Advance a YYYY-MM-DD week-start key by 7 days. */
function nextWeek(weekStart: string): string {
  const [y, m, d] = weekStart.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + 7)
  return localDateKey(date)
}

/**
 * Aggregates per-tag training volume per ISO week across the full set history.
 * Surfaces whether each muscle group's volume is climbing, holding, or being
 * neglected over time — the trend counterpart to the weekly snapshot in
 * {@link useTagVolume}.
 */
export function useTagVolumeTrend(exercises: Ref<Exercise[]>): UseTagVolumeTrendReturn {
  const tagTrends = computed((): Record<string, TimeSeriesEntry[]> => {
    // tag -> (weekStart -> volume)
    const byTag = new Map<string, Map<string, number>>()
    let globalLast: string | null = null

    for (const exercise of exercises.value) {
      if (!exercise.tags || exercise.tags.length === 0) continue
      for (const set of exercise.sets) {
        const wk = mondayOfWeek(set.date.slice(0, 10))
        if (globalLast === null || wk > globalLast) globalLast = wk
        const vol = effectiveSetWeight(set, exercise) * set.reps
        for (const tag of exercise.tags) {
          let weeks = byTag.get(tag)
          if (!weeks) {
            weeks = new Map<string, number>()
            byTag.set(tag, weeks)
          }
          weeks.set(wk, (weeks.get(wk) ?? 0) + vol)
        }
      }
    }

    if (globalLast === null) return {}

    const result: Record<string, TimeSeriesEntry[]> = {}
    for (const [tag, weeks] of byTag) {
      const firstWeek = [...weeks.keys()].sort()[0]
      const series: TimeSeriesEntry[] = []
      let cursor = firstWeek
      while (cursor <= globalLast) {
        series.push({ date: cursor, value: Math.round(weeks.get(cursor) ?? 0) })
        cursor = nextWeek(cursor)
      }
      result[tag] = series
    }
    return result
  })

  return { tagTrends }
}
