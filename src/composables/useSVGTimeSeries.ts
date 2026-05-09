import { computed, type Ref } from 'vue'

/** A single data point with a date string (YYYY-MM-DD) and numeric value. */
export interface TimeSeriesPoint {
  date: string
  value: number
}

/** A mapped point with SVG coordinates. */
export interface MappedPoint {
  x: number
  y: number
  date: string
  value: number
}

/** SVG layout dimensions and padding. */
export interface SVGLayout {
  W: number
  H: number
  PAD_L: number
  PAD_R: number
  PAD_T: number
  PAD_B: number
}

/** Default layout used by both graph components. */
export const DEFAULT_LAYOUT: SVGLayout = {
  W: 320,
  H: 118,
  PAD_L: 56,
  PAD_R: 16,
  PAD_T: 16,
  PAD_B: 26,
}

export interface SVGTimeSeriesOptions {
  /** Reactive array of data points sorted chronologically. */
  data: Ref<TimeSeriesPoint[]>
  /** Override default SVG layout dimensions. */
  layout?: SVGLayout
  /**
   * Optional fixed time range for the x-axis (epoch ms).
   * When provided, points are positioned within this range instead of
   * the data's own min/max dates. Useful for period-based views.
   */
  timeRange?: Ref<{ t0: number; t1: number } | null>
  /**
   * Optional extra values to include when computing the y-axis range.
   * Useful for goal lines that should influence the chart bounds.
   */
  extraYValues?: Ref<number[]>
  /** Minimum pixel gap between visible x-axis labels. Default 50. */
  minLabelGap?: number
}

export function useSVGTimeSeries(options: SVGTimeSeriesOptions) {
  const layout = options.layout ?? DEFAULT_LAYOUT
  const { W, H, PAD_L, PAD_R, PAD_T, PAD_B } = layout
  const chartW = W - PAD_L - PAD_R
  const chartH = H - PAD_T - PAD_B
  const minLabelGap = options.minLabelGap ?? 50

  const minVal = computed(() => {
    const vals = options.data.value.map(d => d.value)
    if (!vals.length) return 0
    let min = Math.min(...vals)
    if (options.extraYValues) {
      const dataMin = min
      const dataMax = Math.max(...vals)
      const dataRange = dataMax - dataMin || 1
      for (const g of options.extraYValues.value) {
        if (g < dataMin) min = Math.max(g, dataMin - dataRange)
      }
    }
    return min
  })

  const maxVal = computed(() => {
    const vals = options.data.value.map(d => d.value)
    if (!vals.length) return 0
    let max = Math.max(...vals)
    if (options.extraYValues) {
      const dataMin = Math.min(...vals)
      const dataMax = max
      const dataRange = dataMax - dataMin || 1
      for (const g of options.extraYValues.value) {
        if (g > dataMax) max = Math.min(g, dataMax + dataRange)
      }
    }
    return max
  })

  /** Map data points to SVG coordinates. */
  const points = computed((): MappedPoint[] => {
    const entries = options.data.value
    if (entries.length < 2) return []
    const range = maxVal.value - minVal.value

    let t0: number, t1: number
    if (options.timeRange?.value) {
      t0 = options.timeRange.value.t0
      t1 = options.timeRange.value.t1
    } else {
      t0 = new Date(entries[0].date + 'T12:00:00').getTime()
      t1 = new Date(entries[entries.length - 1].date + 'T12:00:00').getTime()
    }
    const tRange = t1 - t0

    return entries.map(({ date, value }) => {
      const t = new Date(date + 'T12:00:00').getTime()
      const x = tRange > 0 ? PAD_L + ((t - t0) / tRange) * chartW : PAD_L + chartW / 2
      const y = range > 0
        ? PAD_T + chartH - ((value - minVal.value) / range) * chartH
        : PAD_T + chartH / 2
      return { x, y, date, value }
    })
  })

  /** SVG polyline points string. */
  const linePoints = computed(() =>
    points.value.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  )

  /** Closed polygon for the shaded area under the line. */
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

  /** Horizontal guide lines (top, middle, bottom of chart area). */
  const gridYs = computed(() => [PAD_T, PAD_T + chartH / 2, PAD_T + chartH])

  /** Indices of points whose x-axis labels should be visible (non-overlapping). */
  const visibleLabelIndices = computed(() => {
    const pts = points.value
    if (pts.length === 0) return []
    const indices = [0]
    for (let i = 1; i < pts.length; i++) {
      const lastX = pts[indices[indices.length - 1]].x
      if (pts[i].x - lastX >= minLabelGap) {
        indices.push(i)
      }
    }
    const last = pts.length - 1
    if (!indices.includes(last) && pts[last].x - pts[indices[indices.length - 1]].x >= minLabelGap) {
      indices.push(last)
    }
    return indices
  })

  /** Whether the label at index i should be shown. */
  function shouldShowLabel(i: number): boolean {
    return visibleLabelIndices.value.includes(i)
  }

  /** Convert a value to a Y coordinate on the chart. */
  function valueToY(value: number): number {
    const range = maxVal.value - minVal.value
    if (range <= 0) return PAD_T + chartH / 2
    return PAD_T + chartH - ((value - minVal.value) / range) * chartH
  }

  /** Format an ISO date string as "Mon DD". */
  function formatDate(iso: string): string {
    return new Date(iso + 'T12:00:00').toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })
  }

  return {
    // Layout constants
    W, H, PAD_L, PAD_R, PAD_T, PAD_B, chartW, chartH,
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
