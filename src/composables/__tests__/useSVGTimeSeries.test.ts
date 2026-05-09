import { describe, it, expect } from 'vitest'
import { ref, computed } from 'vue'
import {
  useSVGTimeSeries,
  formatGraphDate,
  GRAPH_W,
  GRAPH_H,
  GRAPH_PAD_L,
  GRAPH_PAD_R,
  GRAPH_PAD_T,
  GRAPH_PAD_B,
  CHART_W,
  CHART_H,
} from '../useSVGTimeSeries'
import type { TimeSeriesEntry } from '../useSVGTimeSeries'

function makeEntries(dates: string[], values: number[]): TimeSeriesEntry[] {
  return dates.map((d, i) => ({ date: d, value: values[i] }))
}

describe('useSVGTimeSeries', () => {
  describe('constants', () => {
    it('chart dimensions equal viewport minus padding', () => {
      expect(CHART_W).toBe(GRAPH_W - GRAPH_PAD_L - GRAPH_PAD_R)
      expect(CHART_H).toBe(GRAPH_H - GRAPH_PAD_T - GRAPH_PAD_B)
    })
  })

  describe('minVal / maxVal', () => {
    it('returns 0 when no entries', () => {
      const entries = ref<TimeSeriesEntry[]>([])
      const { minVal, maxVal } = useSVGTimeSeries({ entries })
      expect(minVal.value).toBe(0)
      expect(maxVal.value).toBe(0)
    })

    it('computes from entry values', () => {
      const entries = ref(makeEntries(
        ['2026-01-01', '2026-01-02', '2026-01-03'],
        [100, 150, 120],
      ))
      const { minVal, maxVal } = useSVGTimeSeries({ entries })
      expect(minVal.value).toBe(100)
      expect(maxVal.value).toBe(150)
    })

    it('expands range with minOverride and maxOverride', () => {
      const entries = ref(makeEntries(
        ['2026-01-01', '2026-01-02'],
        [100, 150],
      ))
      const minOverride = ref<number | undefined>(80)
      const maxOverride = ref<number | undefined>(200)
      const { minVal, maxVal } = useSVGTimeSeries({ entries, minOverride, maxOverride })
      expect(minVal.value).toBe(80)
      expect(maxVal.value).toBe(200)
    })

    it('ignores overrides that narrow the range', () => {
      const entries = ref(makeEntries(
        ['2026-01-01', '2026-01-02'],
        [100, 150],
      ))
      const minOverride = ref<number | undefined>(120) // higher than data min
      const maxOverride = ref<number | undefined>(130) // lower than data max
      const { minVal, maxVal } = useSVGTimeSeries({ entries, minOverride, maxOverride })
      expect(minVal.value).toBe(100)
      expect(maxVal.value).toBe(150)
    })
  })

  describe('coords', () => {
    it('returns empty array for fewer than 2 entries', () => {
      const entries = ref(makeEntries(['2026-01-01'], [100]))
      const { coords } = useSVGTimeSeries({ entries })
      expect(coords.value).toEqual([])
    })

    it('maps 2 entries to chart boundary x positions', () => {
      const entries = ref(makeEntries(
        ['2026-01-01', '2026-01-10'],
        [100, 200],
      ))
      const { coords } = useSVGTimeSeries({ entries })
      expect(coords.value).toHaveLength(2)
      // First point at left padding
      expect(coords.value[0].x).toBeCloseTo(GRAPH_PAD_L, 1)
      // Last point at right edge
      expect(coords.value[1].x).toBeCloseTo(GRAPH_PAD_L + CHART_W, 1)
    })

    it('maps min value to bottom and max value to top', () => {
      const entries = ref(makeEntries(
        ['2026-01-01', '2026-01-02'],
        [100, 200],
      ))
      const { coords } = useSVGTimeSeries({ entries })
      // min value (100) → bottom of chart
      expect(coords.value[0].y).toBeCloseTo(GRAPH_PAD_T + CHART_H, 1)
      // max value (200) → top of chart
      expect(coords.value[1].y).toBeCloseTo(GRAPH_PAD_T, 1)
    })

    it('centers y when all values are equal', () => {
      const entries = ref(makeEntries(
        ['2026-01-01', '2026-01-02'],
        [150, 150],
      ))
      const { coords } = useSVGTimeSeries({ entries })
      const centerY = GRAPH_PAD_T + CHART_H / 2
      expect(coords.value[0].y).toBeCloseTo(centerY, 1)
      expect(coords.value[1].y).toBeCloseTo(centerY, 1)
    })

    it('uses timeWindow for x-axis when provided', () => {
      const entries = ref(makeEntries(
        ['2026-01-05', '2026-01-10'],
        [100, 200],
      ))
      // Window is wider than data range
      const t0 = new Date('2026-01-01T12:00:00').getTime()
      const t1 = new Date('2026-01-20T12:00:00').getTime()
      const timeWindow = ref<[number, number]>([t0, t1])
      const { coords } = useSVGTimeSeries({ entries, timeWindow })
      // First point should NOT be at left edge (it starts on Jan 5, window starts Jan 1)
      expect(coords.value[0].x).toBeGreaterThan(GRAPH_PAD_L)
      // Last point should NOT be at right edge (ends Jan 10, window ends Jan 20)
      expect(coords.value[1].x).toBeLessThan(GRAPH_PAD_L + CHART_W)
    })
  })

  describe('linePoints', () => {
    it('produces space-separated coordinate pairs', () => {
      const entries = ref(makeEntries(
        ['2026-01-01', '2026-01-10'],
        [100, 200],
      ))
      const { linePoints } = useSVGTimeSeries({ entries })
      const parts = linePoints.value.split(' ')
      expect(parts).toHaveLength(2)
      for (const part of parts) {
        expect(part).toMatch(/^\d+\.\d+,\d+\.\d+$/)
      }
    })
  })

  describe('areaPoints', () => {
    it('returns empty string for no entries', () => {
      const entries = ref<TimeSeriesEntry[]>([])
      const { areaPoints } = useSVGTimeSeries({ entries })
      expect(areaPoints.value).toBe('')
    })

    it('includes baseline points at bottom of chart', () => {
      const entries = ref(makeEntries(
        ['2026-01-01', '2026-01-10'],
        [100, 200],
      ))
      const { areaPoints } = useSVGTimeSeries({ entries })
      const bottom = GRAPH_PAD_T + CHART_H
      // First and last parts should be at bottom Y
      const parts = areaPoints.value.split(' ')
      expect(parts[0]).toContain(`,${bottom}`)
      expect(parts[parts.length - 1]).toContain(`,${bottom}`)
    })
  })

  describe('gridYs', () => {
    it('has 3 values: top, middle, bottom', () => {
      const entries = ref<TimeSeriesEntry[]>([])
      const { gridYs } = useSVGTimeSeries({ entries })
      expect(gridYs.value).toEqual([
        GRAPH_PAD_T,
        GRAPH_PAD_T + CHART_H / 2,
        GRAPH_PAD_T + CHART_H,
      ])
    })
  })

  describe('visibleLabelIndices', () => {
    it('returns empty for no entries', () => {
      const entries = ref<TimeSeriesEntry[]>([])
      const { visibleLabelIndices } = useSVGTimeSeries({ entries })
      expect(visibleLabelIndices.value).toEqual([])
    })

    it('always includes first point', () => {
      const entries = ref(makeEntries(
        ['2026-01-01', '2026-01-02', '2026-01-03'],
        [100, 110, 120],
      ))
      const { visibleLabelIndices } = useSVGTimeSeries({ entries })
      expect(visibleLabelIndices.value[0]).toBe(0)
    })

    it('skips labels that are too close together', () => {
      // Many entries in a short time span → some labels should be hidden
      const dates = Array.from({ length: 20 }, (_, i) => {
        const d = new Date('2026-01-01')
        d.setDate(d.getDate() + i)
        return d.toISOString().slice(0, 10)
      })
      const values = dates.map((_, i) => 100 + i)
      const entries = ref(makeEntries(dates, values))
      const { visibleLabelIndices } = useSVGTimeSeries({ entries })
      // Should have fewer labels than total points
      expect(visibleLabelIndices.value.length).toBeLessThan(20)
      expect(visibleLabelIndices.value.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('valueToY', () => {
    it('maps values to Y coordinates', () => {
      const entries = ref(makeEntries(
        ['2026-01-01', '2026-01-02'],
        [100, 200],
      ))
      const { valueToY } = useSVGTimeSeries({ entries })
      // Min value → bottom
      expect(valueToY(100)).toBeCloseTo(GRAPH_PAD_T + CHART_H, 1)
      // Max value → top
      expect(valueToY(200)).toBeCloseTo(GRAPH_PAD_T, 1)
      // Midpoint → center
      expect(valueToY(150)).toBeCloseTo(GRAPH_PAD_T + CHART_H / 2, 1)
    })
  })

  describe('formatGraphDate', () => {
    it('formats YYYY-MM-DD as month + day', () => {
      const result = formatGraphDate('2026-01-15')
      expect(result).toContain('15')
      expect(result).toContain('Jan')
    })
  })
})
