import { computed, type Ref } from 'vue'

// SVG layout constants — shared across all time-series graphs
export const GRAPH = {
  W: 320,
  H: 118,
  PAD_L: 56,
  PAD_R: 16,
  PAD_T: 16,
  PAD_B: 26,
} as const

export const CHART_W = GRAPH.W - GRAPH.PAD_L - GRAPH.PAD_R
export const CHART_H = GRAPH.H - GRAPH.PAD_T - GRAPH.PAD_B

/** Minimum x-pixel gap between visible date labels */
const MIN_LABEL_GAP = 50

export interface TimeSeriesEntry {
  date: string   // ISO date string (YYYY-MM-DD)
  value: number
}

export interface MappedPoint {
  x: number
  y: number
  date: string
  value: number
}

export interface TimeRange {
  t0: number  // epoch ms
  t1: number  // epoch ms
}

/**
 * Composable for SVG time-series graph coordinate math.
 *
 * Extracts the shared logic between BodyweightTracker and ExerciseGraph:
 * date→x mapping, value→y mapping, polyline/polygon strings, grid lines,
 * and visible-label-index calculation.
 *
 * @param entries - Reactive array of {date, value} sorted chronologically
 * @param minVal  - Reactive min value for y-axis range
 * @param maxVal  - Reactive max value for y-axis range
 * @param timeRange - Optional fixed time range for x-axis (e.g., period-based).
 *                    If null, derived from first/last entry dates.
 */
export function useSVGTimeSeries(
  entries: Ref<TimeSeriesEntry[]>,
  minVal: Ref<number>,
  maxVal: Ref<number>,
  timeRange?: Ref<TimeRange | null>,
) {
  /** Map each entry to an SVG coordinate */
  const points = computed((): MappedPoint[] => {
    const data = entries.value
    if (data.length < 2) return []

    const range = maxVal.value - minVal.value

    let t0: number, t1: number
    if (timeRange?.value) {
      t0 = timeRange.value.t0
      t1 = timeRange.value.t1
    } else {
      t0 = dateToEpoch(data[0].date)
      t1 = dateToEpoch(data[data.length - 1].date)
    }
    const tRange = t1 - t0

    return data.map(({ date, value }) => {
      const t = dateToEpoch(date)
      const x = tRange > 0
        ? GRAPH.PAD_L + ((t - t0) / tRange) * CHART_W
        : GRAPH.PAD_L + CHART_W / 2
      const y = range > 0
        ? GRAPH.PAD_T + CHART_H - ((value - minVal.value) / range) * CHART_H
        : GRAPH.PAD_T + CHART_H / 2
      return { x, y, date, value }
    })
  })

  /** SVG polyline points string */
  const linePoints = computed(() =>
    points.value.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  )

  /** SVG polygon points string (area fill under the line) */
  const areaPoints = computed(() => {
    const pts = points.value
    if (!pts.length) return ''
    const bottom = GRAPH.PAD_T + CHART_H
    return [
      `${pts[0].x.toFixed(1)},${bottom}`,
      ...pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`),
      `${pts[pts.length - 1].x.toFixed(1)},${bottom}`,
    ].join(' ')
  })

  /** Horizontal grid lines: top, middle, bottom of chart area */
  const gridYs = computed(() => [
    GRAPH.PAD_T,
    GRAPH.PAD_T + CHART_H / 2,
    GRAPH.PAD_T + CHART_H,
  ])

  /** Indices of points whose date labels should be visible (non-overlapping) */
  const visibleLabelIndices = computed(() => {
    const pts = points.value
    if (pts.length === 0) return []
    const indices = [0]
    for (let i = 1; i < pts.length; i++) {
      const lastX = pts[indices[indices.length - 1]].x
      if (pts[i].x - lastX >= MIN_LABEL_GAP) {
        indices.push(i)
      }
    }
    const last = pts.length - 1
    if (!indices.includes(last) && pts[last].x - pts[indices[indices.length - 1]].x >= MIN_LABEL_GAP) {
      indices.push(last)
    }
    return indices
  })

  /** Whether the label at index i should be shown */
  function shouldShowLabel(i: number): boolean {
    return visibleLabelIndices.value.includes(i)
  }

  /** Convert a value to its Y coordinate on the chart */
  function valueToY(value: number): number {
    const range = maxVal.value - minVal.value
    if (range <= 0) return GRAPH.PAD_T + CHART_H / 2
    return GRAPH.PAD_T + CHART_H - ((value - minVal.value) / range) * CHART_H
  }

  return {
    points,
    linePoints,
    areaPoints,
    gridYs,
    visibleLabelIndices,
    shouldShowLabel,
    valueToY,
  }
}

/** Format an ISO date string for x-axis labels */
export function formatGraphDate(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

/** Convert an ISO date string to epoch ms at noon (avoids timezone off-by-one) */
function dateToEpoch(iso: string): number {
  return new Date(iso + 'T12:00:00').getTime()
}
