import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useSVGTimeSeries, GRAPH_DEFAULTS, type TimeSeriesEntry } from '../useSVGTimeSeries'

const { W, H, PAD_L, PAD_R, PAD_T, PAD_B } = GRAPH_DEFAULTS
const chartW = W - PAD_L - PAD_R
const chartH = H - PAD_T - PAD_B

function makeEntries(pairs: [string, number][]): TimeSeriesEntry[] {
  return pairs.map(([date, value]) => ({ date, value }))
}

describe('useSVGTimeSeries', () => {
  describe('minVal / maxVal', () => {
    it('returns 0 when data is empty', () => {
      const data = ref<TimeSeriesEntry[]>([])
      const { minVal, maxVal } = useSVGTimeSeries(data)
      expect(minVal.value).toBe(0)
      expect(maxVal.value).toBe(0)
    })

    it('computes min and max from data values', () => {
      const data = ref(makeEntries([
        ['2025-01-01', 100],
        ['2025-01-02', 150],
        ['2025-01-03', 120],
      ]))
      const { minVal, maxVal } = useSVGTimeSeries(data)
      expect(minVal.value).toBe(100)
      expect(maxVal.value).toBe(150)
    })

    it('expands range to include extraYValues within cap', () => {
      const data = ref(makeEntries([
        ['2025-01-01', 100],
        ['2025-01-02', 150],
      ]))
      const extras = ref([80, 170])
      const { minVal, maxVal } = useSVGTimeSeries(data, { extraYValues: extras })
      // data range = 50, expansion capped at 1x: min can go to 100-50=50, max to 150+50=200
      expect(minVal.value).toBe(80) // 80 >= 50, so accepted
      expect(maxVal.value).toBe(170) // 170 <= 200, so accepted
    })

    it('caps extraYValues expansion to data range', () => {
      const data = ref(makeEntries([
        ['2025-01-01', 100],
        ['2025-01-02', 150],
      ]))
      // Goal far outside data: 20 is 80 below min, but cap is 50 (1x range)
      const extras = ref([20])
      const { minVal } = useSVGTimeSeries(data, { extraYValues: extras })
      expect(minVal.value).toBe(50) // max(20, 100 - 50) = 50
    })
  })

  describe('points', () => {
    it('returns empty array with fewer than 2 data points', () => {
      const data = ref(makeEntries([['2025-01-01', 100]]))
      const { points } = useSVGTimeSeries(data)
      expect(points.value).toEqual([])
    })

    it('maps data to SVG coordinates', () => {
      const data = ref(makeEntries([
        ['2025-01-01', 100],
        ['2025-01-10', 200],
      ]))
      const { points } = useSVGTimeSeries(data)
      const pts = points.value
      expect(pts).toHaveLength(2)
      // First point should be at left edge, bottom (min value)
      expect(pts[0].x).toBeCloseTo(PAD_L)
      expect(pts[0].y).toBeCloseTo(PAD_T + chartH) // min value → bottom
      // Last point should be at right edge, top (max value)
      expect(pts[1].x).toBeCloseTo(PAD_L + chartW)
      expect(pts[1].y).toBeCloseTo(PAD_T) // max value → top
    })

    it('centers points vertically when all values are equal', () => {
      const data = ref(makeEntries([
        ['2025-01-01', 100],
        ['2025-01-10', 100],
      ]))
      const { points } = useSVGTimeSeries(data)
      expect(points.value[0].y).toBeCloseTo(PAD_T + chartH / 2)
    })

    it('uses custom timeRange when provided', () => {
      const data = ref(makeEntries([
        ['2025-01-05', 100], // midpoint of the range
        ['2025-01-10', 200],
      ]))
      const timeRange = ref({
        t0: new Date('2025-01-01T12:00:00').getTime(),
        t1: new Date('2025-01-10T12:00:00').getTime(),
      })
      const { points } = useSVGTimeSeries(data, { timeRange })
      const pts = points.value
      // First data point at day 5 of 10 → ~halfway across
      const expectedX = PAD_L + (4 / 9) * chartW
      expect(pts[0].x).toBeCloseTo(expectedX, 0)
      // Last point at end of range
      expect(pts[1].x).toBeCloseTo(PAD_L + chartW)
    })

    it('preserves date and value in output points', () => {
      const data = ref(makeEntries([
        ['2025-01-01', 100],
        ['2025-01-02', 200],
      ]))
      const { points } = useSVGTimeSeries(data)
      expect(points.value[0].date).toBe('2025-01-01')
      expect(points.value[0].value).toBe(100)
      expect(points.value[1].date).toBe('2025-01-02')
      expect(points.value[1].value).toBe(200)
    })
  })

  describe('linePoints', () => {
    it('generates SVG polyline coordinate string', () => {
      const data = ref(makeEntries([
        ['2025-01-01', 100],
        ['2025-01-02', 200],
      ]))
      const { linePoints } = useSVGTimeSeries(data)
      const parts = linePoints.value.split(' ')
      expect(parts).toHaveLength(2)
      // Each part should be "x.x,y.y"
      for (const part of parts) {
        expect(part).toMatch(/^\d+\.\d+,\d+\.\d+$/)
      }
    })
  })

  describe('areaPoints', () => {
    it('returns empty string when no points', () => {
      const data = ref<TimeSeriesEntry[]>([])
      const { areaPoints } = useSVGTimeSeries(data)
      expect(areaPoints.value).toBe('')
    })

    it('creates closed polygon for area fill', () => {
      const data = ref(makeEntries([
        ['2025-01-01', 100],
        ['2025-01-02', 200],
      ]))
      const { areaPoints } = useSVGTimeSeries(data)
      const parts = areaPoints.value.split(' ')
      // Should have: bottom-left, point1, point2, bottom-right = 4 coords
      expect(parts).toHaveLength(4)
      const bottom = PAD_T + chartH
      // First and last should be at the bottom
      expect(parts[0]).toContain(`,${bottom}`)
      expect(parts[3]).toContain(`,${bottom}`)
    })
  })

  describe('gridYs', () => {
    it('returns three horizontal grid positions', () => {
      const data = ref<TimeSeriesEntry[]>([])
      const { gridYs } = useSVGTimeSeries(data)
      expect(gridYs.value).toEqual([PAD_T, PAD_T + chartH / 2, PAD_T + chartH])
    })
  })

  describe('visibleLabelIndices', () => {
    it('returns empty for no points', () => {
      const data = ref<TimeSeriesEntry[]>([])
      const { visibleLabelIndices } = useSVGTimeSeries(data)
      expect(visibleLabelIndices.value).toEqual([])
    })

    it('always includes first point', () => {
      const data = ref(makeEntries([
        ['2025-01-01', 100],
        ['2025-06-01', 200],
      ]))
      const { visibleLabelIndices } = useSVGTimeSeries(data)
      expect(visibleLabelIndices.value).toContain(0)
    })

    it('includes last point when far enough from previous', () => {
      const data = ref(makeEntries([
        ['2025-01-01', 100],
        ['2025-06-01', 200],
      ]))
      const { visibleLabelIndices } = useSVGTimeSeries(data)
      expect(visibleLabelIndices.value).toContain(1)
    })

    it('skips closely spaced intermediate points', () => {
      // Create many points that will be closely spaced
      const entries: [string, number][] = []
      for (let i = 1; i <= 30; i++) {
        entries.push([`2025-01-${String(i).padStart(2, '0')}`, 100 + i])
      }
      const data = ref(makeEntries(entries))
      const { visibleLabelIndices } = useSVGTimeSeries(data)
      // Should have fewer visible labels than total points
      expect(visibleLabelIndices.value.length).toBeLessThan(30)
      expect(visibleLabelIndices.value.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('shouldShowLabel', () => {
    it('returns true for visible indices', () => {
      const data = ref(makeEntries([
        ['2025-01-01', 100],
        ['2025-06-01', 200],
      ]))
      const { shouldShowLabel } = useSVGTimeSeries(data)
      expect(shouldShowLabel(0)).toBe(true)
    })

    it('returns false for hidden indices', () => {
      const entries: [string, number][] = []
      for (let i = 1; i <= 30; i++) {
        entries.push([`2025-01-${String(i).padStart(2, '0')}`, 100 + i])
      }
      const data = ref(makeEntries(entries))
      const { shouldShowLabel, visibleLabelIndices } = useSVGTimeSeries(data)
      // Find an index that's NOT in visibleLabelIndices
      const hidden = Array.from({ length: 30 }, (_, i) => i)
        .find(i => !visibleLabelIndices.value.includes(i))
      if (hidden !== undefined) {
        expect(shouldShowLabel(hidden)).toBe(false)
      }
    })
  })

  describe('valueToY', () => {
    it('maps min value to bottom of chart', () => {
      const data = ref(makeEntries([
        ['2025-01-01', 100],
        ['2025-01-02', 200],
      ]))
      const { valueToY } = useSVGTimeSeries(data)
      expect(valueToY(100)).toBeCloseTo(PAD_T + chartH)
    })

    it('maps max value to top of chart', () => {
      const data = ref(makeEntries([
        ['2025-01-01', 100],
        ['2025-01-02', 200],
      ]))
      const { valueToY } = useSVGTimeSeries(data)
      expect(valueToY(200)).toBeCloseTo(PAD_T)
    })

    it('returns center when range is zero', () => {
      const data = ref(makeEntries([
        ['2025-01-01', 100],
        ['2025-01-02', 100],
      ]))
      const { valueToY } = useSVGTimeSeries(data)
      expect(valueToY(100)).toBeCloseTo(PAD_T + chartH / 2)
    })
  })

  describe('formatDate', () => {
    it('formats ISO date to short month + day', () => {
      const data = ref<TimeSeriesEntry[]>([])
      const { formatDate } = useSVGTimeSeries(data)
      const result = formatDate('2025-01-15')
      expect(result).toMatch(/Jan/)
      expect(result).toMatch(/15/)
    })
  })

  describe('layout constants', () => {
    it('exports correct default dimensions', () => {
      const data = ref<TimeSeriesEntry[]>([])
      const ts = useSVGTimeSeries(data)
      expect(ts.W).toBe(320)
      expect(ts.H).toBe(118)
      expect(ts.PAD_L).toBe(56)
      expect(ts.PAD_R).toBe(16)
      expect(ts.PAD_T).toBe(16)
      expect(ts.PAD_B).toBe(26)
      expect(ts.chartW).toBe(248) // 320 - 56 - 16
      expect(ts.chartH).toBe(76) // 118 - 16 - 26
    })
  })

  describe('reactivity', () => {
    it('recomputes when data changes', () => {
      const data = ref(makeEntries([
        ['2025-01-01', 100],
        ['2025-01-02', 200],
      ]))
      const { maxVal } = useSVGTimeSeries(data)
      expect(maxVal.value).toBe(200)

      data.value = makeEntries([
        ['2025-01-01', 100],
        ['2025-01-02', 300],
      ])
      expect(maxVal.value).toBe(300)
    })
  })
})
