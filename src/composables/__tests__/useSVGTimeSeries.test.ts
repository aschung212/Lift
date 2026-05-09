import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useSVGTimeSeries, DEFAULT_LAYOUT } from '../useSVGTimeSeries'
import type { TimeSeriesPoint } from '../useSVGTimeSeries'

function makeData(pairs: [string, number][]): TimeSeriesPoint[] {
  return pairs.map(([date, value]) => ({ date, value }))
}

describe('useSVGTimeSeries', () => {
  const { W, H, PAD_L, PAD_R, PAD_T, PAD_B } = DEFAULT_LAYOUT
  const chartW = W - PAD_L - PAD_R
  const chartH = H - PAD_T - PAD_B

  describe('minVal / maxVal', () => {
    it('returns 0 for empty data', () => {
      const data = ref<TimeSeriesPoint[]>([])
      const { minVal, maxVal } = useSVGTimeSeries({ data })
      expect(minVal.value).toBe(0)
      expect(maxVal.value).toBe(0)
    })

    it('computes min and max from data values', () => {
      const data = ref(makeData([['2025-01-01', 100], ['2025-01-02', 200], ['2025-01-03', 150]]))
      const { minVal, maxVal } = useSVGTimeSeries({ data })
      expect(minVal.value).toBe(100)
      expect(maxVal.value).toBe(200)
    })

    it('expands range for extraYValues below data min', () => {
      const data = ref(makeData([['2025-01-01', 100], ['2025-01-02', 200]]))
      const extraYValues = ref([50])
      const { minVal } = useSVGTimeSeries({ data, extraYValues })
      // dataRange = 200 - 100 = 100, so min can expand down to 100 - 100 = 0
      // extraY 50 > 0, so min = 50
      expect(minVal.value).toBe(50)
    })

    it('caps extraYValues expansion to 1x data range', () => {
      const data = ref(makeData([['2025-01-01', 100], ['2025-01-02', 200]]))
      const extraYValues = ref([-500])
      const { minVal } = useSVGTimeSeries({ data, extraYValues })
      // dataRange = 100, min can't go below 100 - 100 = 0
      expect(minVal.value).toBe(0)
    })

    it('expands range for extraYValues above data max', () => {
      const data = ref(makeData([['2025-01-01', 100], ['2025-01-02', 200]]))
      const extraYValues = ref([250])
      const { maxVal } = useSVGTimeSeries({ data, extraYValues })
      expect(maxVal.value).toBe(250)
    })
  })

  describe('points', () => {
    it('returns empty array for fewer than 2 data points', () => {
      const data = ref(makeData([['2025-01-01', 100]]))
      const { points } = useSVGTimeSeries({ data })
      expect(points.value).toEqual([])
    })

    it('maps 2 points to SVG coordinates', () => {
      const data = ref(makeData([['2025-01-01', 100], ['2025-01-10', 200]]))
      const { points } = useSVGTimeSeries({ data })
      expect(points.value).toHaveLength(2)

      // First point: x = PAD_L, y = PAD_T + chartH (bottom, min value)
      expect(points.value[0].x).toBeCloseTo(PAD_L, 1)
      expect(points.value[0].y).toBeCloseTo(PAD_T + chartH, 1)
      expect(points.value[0].date).toBe('2025-01-01')
      expect(points.value[0].value).toBe(100)

      // Last point: x = PAD_L + chartW, y = PAD_T (top, max value)
      expect(points.value[1].x).toBeCloseTo(PAD_L + chartW, 1)
      expect(points.value[1].y).toBeCloseTo(PAD_T, 1)
    })

    it('centers y when all values are equal', () => {
      const data = ref(makeData([['2025-01-01', 100], ['2025-01-02', 100]]))
      const { points } = useSVGTimeSeries({ data })
      expect(points.value[0].y).toBeCloseTo(PAD_T + chartH / 2, 1)
      expect(points.value[1].y).toBeCloseTo(PAD_T + chartH / 2, 1)
    })

    it('uses custom timeRange for x positioning', () => {
      const data = ref(makeData([['2025-01-05', 100], ['2025-01-10', 200]]))
      const t0 = new Date('2025-01-01T12:00:00').getTime()
      const t1 = new Date('2025-01-20T12:00:00').getTime()
      const timeRange = ref({ t0, t1 })
      const { points } = useSVGTimeSeries({ data, timeRange })

      // First point should NOT be at PAD_L since data starts 4 days into the range
      expect(points.value[0].x).toBeGreaterThan(PAD_L)
      // Last point should NOT be at PAD_L + chartW since data ends 10 days before range end
      expect(points.value[1].x).toBeLessThan(PAD_L + chartW)
    })
  })

  describe('linePoints', () => {
    it('produces space-separated coordinate string', () => {
      const data = ref(makeData([['2025-01-01', 100], ['2025-01-02', 200]]))
      const { linePoints } = useSVGTimeSeries({ data })
      const parts = linePoints.value.split(' ')
      expect(parts).toHaveLength(2)
      expect(parts[0]).toMatch(/^\d+\.\d+,\d+\.\d+$/)
    })
  })

  describe('areaPoints', () => {
    it('returns empty string for empty points', () => {
      const data = ref<TimeSeriesPoint[]>([])
      const { areaPoints } = useSVGTimeSeries({ data })
      expect(areaPoints.value).toBe('')
    })

    it('creates closed polygon with bottom baseline', () => {
      const data = ref(makeData([['2025-01-01', 100], ['2025-01-02', 200]]))
      const { areaPoints } = useSVGTimeSeries({ data })
      const parts = areaPoints.value.split(' ')
      // First and last coords share the bottom y (PAD_T + chartH)
      const bottom = PAD_T + chartH
      expect(parts[0]).toContain(`,${bottom}`)
      expect(parts[parts.length - 1]).toContain(`,${bottom}`)
      // Total points = 2 bottom anchors + 2 data points = 4
      expect(parts).toHaveLength(4)
    })
  })

  describe('gridYs', () => {
    it('returns top, middle, bottom y coordinates', () => {
      const data = ref<TimeSeriesPoint[]>([])
      const { gridYs } = useSVGTimeSeries({ data })
      expect(gridYs.value).toEqual([PAD_T, PAD_T + chartH / 2, PAD_T + chartH])
    })
  })

  describe('visibleLabelIndices / shouldShowLabel', () => {
    it('returns empty for empty data', () => {
      const data = ref<TimeSeriesPoint[]>([])
      const { visibleLabelIndices } = useSVGTimeSeries({ data })
      expect(visibleLabelIndices.value).toEqual([])
    })

    it('always includes the first point', () => {
      const data = ref(makeData([['2025-01-01', 100], ['2025-06-01', 200]]))
      const { visibleLabelIndices, shouldShowLabel } = useSVGTimeSeries({ data })
      expect(visibleLabelIndices.value).toContain(0)
      expect(shouldShowLabel(0)).toBe(true)
    })

    it('skips labels that are too close together', () => {
      // Create many points in a short time range — they'll cluster at similar x coords
      const pairs: [string, number][] = []
      for (let i = 1; i <= 20; i++) {
        const day = String(i).padStart(2, '0')
        pairs.push([`2025-01-${day}`, 100 + i])
      }
      const data = ref(makeData(pairs))
      const { visibleLabelIndices } = useSVGTimeSeries({ data })
      // Should have fewer visible labels than total points
      expect(visibleLabelIndices.value.length).toBeLessThan(20)
      expect(visibleLabelIndices.value.length).toBeGreaterThanOrEqual(1)
    })

    it('includes last point when gap is sufficient', () => {
      const data = ref(makeData([['2025-01-01', 100], ['2025-12-31', 200]]))
      const { visibleLabelIndices } = useSVGTimeSeries({ data })
      expect(visibleLabelIndices.value).toContain(1)
    })
  })

  describe('valueToY', () => {
    it('maps min value to bottom of chart', () => {
      const data = ref(makeData([['2025-01-01', 100], ['2025-01-02', 200]]))
      const { valueToY } = useSVGTimeSeries({ data })
      expect(valueToY(100)).toBeCloseTo(PAD_T + chartH, 1)
    })

    it('maps max value to top of chart', () => {
      const data = ref(makeData([['2025-01-01', 100], ['2025-01-02', 200]]))
      const { valueToY } = useSVGTimeSeries({ data })
      expect(valueToY(200)).toBeCloseTo(PAD_T, 1)
    })

    it('returns center when range is zero', () => {
      const data = ref(makeData([['2025-01-01', 100], ['2025-01-02', 100]]))
      const { valueToY } = useSVGTimeSeries({ data })
      expect(valueToY(100)).toBeCloseTo(PAD_T + chartH / 2, 1)
    })
  })

  describe('formatDate', () => {
    it('formats ISO date to short month + day', () => {
      const data = ref<TimeSeriesPoint[]>([])
      const { formatDate } = useSVGTimeSeries({ data })
      const result = formatDate('2025-03-15')
      expect(result).toMatch(/Mar/)
      expect(result).toMatch(/15/)
    })
  })

  describe('reactivity', () => {
    it('recomputes when data changes', () => {
      const data = ref(makeData([['2025-01-01', 100], ['2025-01-02', 200]]))
      const { minVal, maxVal, points } = useSVGTimeSeries({ data })
      expect(minVal.value).toBe(100)
      expect(points.value).toHaveLength(2)

      data.value = makeData([['2025-01-01', 50], ['2025-01-02', 300], ['2025-01-03', 150]])
      expect(minVal.value).toBe(50)
      expect(maxVal.value).toBe(300)
      expect(points.value).toHaveLength(3)
    })
  })
})
