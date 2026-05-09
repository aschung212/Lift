import { computed, type Ref } from 'vue'

/** Input data point: a date string (YYYY-MM-DD) and a numeric value. */
export interface TimeSeriesEntry {
  date: string
  value: number
}

/** Computed graph point with SVG coordinates. */
export interface GraphPoint {
  x: number
  y: number
  date: string
  value: number
}

/** Default SVG layout constants shared by all time-series graphs. */
export const GRAPH_DEFAULTS = {
  W: 320,
  H: 118,
  PAD_L: 56,
  PAD_R: 16,
  PAD_T: 16,
  PAD_B: 26,
  MIN_GAP: 50,
} as const

export interface SVGTimeSeriesOptions {
  /** Override the time axis range instead of deriving from data endpoints. */
  timeRange?: Ref<{ t0: number; t1: number } | null>
  /** Values to include in the y-axis range calculation (e.g. goal lines). */
  extraYValues?: Ref<number[]>
  /** Cap y-axis expansion from extraYValues to N× the data range. Default 1. */
  extraYExpansionFactor?: number
}

export function useSVGTimeSeries(
  data: Ref<TimeSeriesEntry[]>,
  options: SVGTimeSeriesOptions = {},
) {
  const { W, H, PAD_L, PAD_R, PAD_T, PAD_B, MIN_GAP } = GRAPH_DEFAULTS
  const chartW = W - PAD_L - PAD_R
  const chartH = H - PAD_T - PAD_B
  const expansionFactor = options.extraYExpansionFactor ?? 1

  const minVal = computed(() => {
    const vals = data.value.map(d => d.value)
    if (!vals.length) return 0
    const dataMin = Math.min(...vals)
    const extras = options.extraYValues?.value
    if (!extras?.length) return dataMin
    const dataMax = Math.max(...vals)
    const dataRange = dataMax - dataMin || 1
    let min = dataMin
    for (const g of extras) {
      if (g < dataMin) min = Math.max(g, dataMin - dataRange * expansionFactor)
    }
    return min
  })

  const maxVal = computed(() => {
    const vals = data.value.map(d => d.value)
    if (!vals.length) return 0
    const dataMin = Math.min(...vals)
    const dataMax = Math.max(...vals)
    const extras = options.extraYValues?.value
    if (!extras?.length) return dataMax
    const dataRange = dataMax - dataMin || 1
    let max = dataMax
    for (const g of extras) {
      if (g > dataMax) max = Math.min(g, dataMax + dataRange * expansionFactor)
    }
    return max
  })

  /** Map data entries to SVG coordinates. Returns [] if fewer than 2 points. */
  const points = computed((): GraphPoint[] => {
    const entries = data.value
    if (entries.length < 2) return []
    const range = maxVal.value - minVal.value
    const overrideRange = options.timeRange?.value
    const t0 = overrideRange
      ? overrideRange.t0
      : new Date(entries[0].date + 'T12:00:00').getTime()
    const t1 = overrideRange
      ? overrideRange.t1
      : new Date(entries[entries.length - 1].date + 'T12:00:00').getTime()
    const tRange = t1 - t0

    return entries.map(({ date, value }) => {
      const t = new Date(date + 'T12:00:00').getTime()
      const x = tRange > 0
        ? PAD_L + ((t - t0) / tRange) * chartW
        : PAD_L + chartW / 2
      const y = range > 0
        ? PAD_T + chartH - ((value - minVal.value) / range) * chartH
        : PAD_T + chartH / 2
      return { x, y, date, value }
    })
  })

  /** SVG polyline points string for the line. */
  const linePoints = computed(() =>
    points.value.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
  )

  /** SVG polygon points string for the area fill under the line. */
  const areaPoints = computed(() => {
    const pts = points.value
    if (!pts.length) return ''
    const bottom = PAD_T + chartH
    return [
      `${pts[0].x.toFixed(1)},${bottom}`,
      ...pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`),
      `${pts[pts.length - 1].x.toFixed(1)},${bottom}`,
    ].join(' ')
  })

  /** Y-coordinates for horizontal grid lines (top, middle, bottom). */
  const gridYs = computed(() => [PAD_T, PAD_T + chartH / 2, PAD_T + chartH])

  /** Indices of points whose x-axis labels should be visible (spaced by MIN_GAP). */
  const visibleLabelIndices = computed(() => {
    const pts = points.value
    if (pts.length === 0) return []
    const indices = [0]
    for (let i = 1; i < pts.length; i++) {
      const lastX = pts[indices[indices.length - 1]].x
      if (pts[i].x - lastX >= MIN_GAP) {
        indices.push(i)
      }
    }
    const last = pts.length - 1
    if (!indices.includes(last) && pts[last].x - pts[indices[indices.length - 1]].x >= MIN_GAP) {
      indices.push(last)
    }
    return indices
  })

  function shouldShowLabel(i: number): boolean {
    return visibleLabelIndices.value.includes(i)
  }

  /** Convert a value to its Y coordinate on the chart. */
  function valueToY(value: number): number {
    const range = maxVal.value - minVal.value
    if (range <= 0) return PAD_T + chartH / 2
    return PAD_T + chartH - ((value - minVal.value) / range) * chartH
  }

  /** Format an ISO date string for x-axis labels (e.g. "Jan 5"). */
  function formatDate(iso: string): string {
    return new Date(iso + 'T12:00:00').toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })
  }

  return {
    // Layout constants
    W,
    H,
    PAD_L,
    PAD_R,
    PAD_T,
    PAD_B,
    chartW,
    chartH,
    // Computed values
    minVal,
    maxVal,
    points,
    linePoints,
    areaPoints,
    gridYs,
    visibleLabelIndices,
    // Functions
    shouldShowLabel,
    valueToY,
    formatDate,
  }
}
