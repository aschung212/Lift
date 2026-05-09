import { computed, type Ref } from 'vue'

/** A single data point with a date string (YYYY-MM-DD) and numeric value. */
export interface TimeSeriesEntry {
  date: string
  value: number
}

export interface SVGTimeSeriesOptions {
  /** Reactive array of data entries sorted chronologically. */
  entries: Ref<TimeSeriesEntry[]>
  /** Override the min value for the Y axis (e.g. to include goal lines). */
  minOverride?: Ref<number | undefined>
  /** Override the max value for the Y axis (e.g. to include goal lines). */
  maxOverride?: Ref<number | undefined>
  /**
   * Fixed time window for the X axis — [start, end] timestamps.
   * When provided, x-coordinates are mapped to this window instead of the data range.
   */
  timeWindow?: Ref<[number, number] | undefined>
}

// Shared SVG layout constants
export const GRAPH_W = 320
export const GRAPH_H = 118
export const GRAPH_PAD_L = 56
export const GRAPH_PAD_R = 16
export const GRAPH_PAD_T = 16
export const GRAPH_PAD_B = 26
export const CHART_W = GRAPH_W - GRAPH_PAD_L - GRAPH_PAD_R
export const CHART_H = GRAPH_H - GRAPH_PAD_T - GRAPH_PAD_B

const MIN_LABEL_GAP = 50

/** Parse a YYYY-MM-DD string to a noon timestamp (avoids UTC midnight off-by-one). */
function dateToTimestamp(iso: string): number {
  return new Date(iso + 'T12:00:00').getTime()
}

/** Format a YYYY-MM-DD string as "Mon DD". */
export function formatGraphDate(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Shared SVG time-series coordinate math.
 *
 * Returns reactive computeds for min/max values, mapped (x,y) coordinates,
 * polyline/polygon strings, grid lines, and visible label indices.
 */
export function useSVGTimeSeries(options: SVGTimeSeriesOptions) {
  const { entries, minOverride, maxOverride, timeWindow } = options

  const minVal = computed(() => {
    const vals = entries.value.map(e => e.value)
    if (!vals.length) return 0
    let min = Math.min(...vals)
    if (minOverride?.value != null && minOverride.value < min) {
      min = minOverride.value
    }
    return min
  })

  const maxVal = computed(() => {
    const vals = entries.value.map(e => e.value)
    if (!vals.length) return 0
    let max = Math.max(...vals)
    if (maxOverride?.value != null && maxOverride.value > max) {
      max = maxOverride.value
    }
    return max
  })

  /** Mapped {x, y, index} for each entry. Returned only when ≥2 entries exist. */
  const coords = computed(() => {
    const data = entries.value
    if (data.length < 2) return []

    const range = maxVal.value - minVal.value
    const tw = timeWindow?.value
    const t0 = tw ? tw[0] : dateToTimestamp(data[0].date)
    const t1 = tw ? tw[1] : dateToTimestamp(data[data.length - 1].date)
    const tRange = t1 - t0

    return data.map((entry, index) => {
      const t = dateToTimestamp(entry.date)
      const x = tRange > 0
        ? GRAPH_PAD_L + ((t - t0) / tRange) * CHART_W
        : GRAPH_PAD_L + CHART_W / 2
      const y = range > 0
        ? GRAPH_PAD_T + CHART_H - ((entry.value - minVal.value) / range) * CHART_H
        : GRAPH_PAD_T + CHART_H / 2
      return { x, y, index }
    })
  })

  /** SVG polyline points string. */
  const linePoints = computed(() =>
    coords.value.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  )

  /** SVG polygon points string (closed area under the line). */
  const areaPoints = computed(() => {
    const pts = coords.value
    if (!pts.length) return ''
    const bottom = GRAPH_PAD_T + CHART_H
    return [
      `${pts[0].x.toFixed(1)},${bottom}`,
      ...pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`),
      `${pts[pts.length - 1].x.toFixed(1)},${bottom}`,
    ].join(' ')
  })

  /** Y-coordinates for horizontal grid lines (top, middle, bottom). */
  const gridYs = computed(() => [
    GRAPH_PAD_T,
    GRAPH_PAD_T + CHART_H / 2,
    GRAPH_PAD_T + CHART_H,
  ])

  /** Indices of entries whose x-axis label should be shown (spaced by MIN_LABEL_GAP). */
  const visibleLabelIndices = computed(() => {
    const pts = coords.value
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

  /** Convert a raw value to its Y coordinate on the chart. */
  function valueToY(value: number): number {
    const range = maxVal.value - minVal.value
    if (range <= 0) return GRAPH_PAD_T + CHART_H / 2
    return GRAPH_PAD_T + CHART_H - ((value - minVal.value) / range) * CHART_H
  }

  return {
    minVal,
    maxVal,
    coords,
    linePoints,
    areaPoints,
    gridYs,
    visibleLabelIndices,
    valueToY,
  }
}
