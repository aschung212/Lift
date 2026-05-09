import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useSVGTimeSeries, formatGraphDate, GRAPH, CHART_W, CHART_H } from '../useSVGTimeSeries'
import type { TimeSeriesEntry, TimeRange } from '../useSVGTimeSeries'

function makeEntries(data: [string, number][]): TimeSeriesEntry[] {
  return data.map(([date, value]) => ({ date, value }))
}

describe('useSVGTimeSeries', () => {
  describe('points mapping', () => {
    it('returns empty when fewer than 2 entries', () => {
      const entries = ref(makeEntries([['2026-01-01', 100]]))
      const min = ref(100)
      const max = ref(100)
      const { points } = useSVGTimeSeries(entries, min, max)
      expect(points.value).toEqual([])
    })

    it('maps 2 entries to left and right edges of chart area', () => {
      const entries = ref(makeEntries([
        ['2026-01-01', 100],
        ['2026-01-11', 200],
      ]))
      const min = ref(100)
      const max = ref(200)
      const { points } = useSVGTimeSeries(entries, min, max)
      const pts = points.value
      expect(pts).toHaveLength(2)

      // First point: left edge, bottom (min value)
      expect(pts[0].x).toBeCloseTo(GRAPH.PAD_L, 1)
      expect(pts[0].y).toBeCloseTo(GRAPH.PAD_T + CHART_H, 1)

      // Last point: right edge, top (max value)
      expect(pts[1].x).toBeCloseTo(GRAPH.PAD_L + CHART_W, 1)
      expect(pts[1].y).toBeCloseTo(GRAPH.PAD_T, 1)
    })

    it('centers y when min equals max', () => {
      const entries = ref(makeEntries([
        ['2026-01-01', 150],
        ['2026-01-10', 150],
      ]))
      const min = ref(150)
      const max = ref(150)
      const { points } = useSVGTimeSeries(entries, min, max)
      for (const p of points.value) {
        expect(p.y).toBeCloseTo(GRAPH.PAD_T + CHART_H / 2, 1)
      }
    })

    it('uses custom time range when provided', () => {
      const entries = ref(makeEntries([
        ['2026-01-10', 100],
        ['2026-01-20', 200],
      ]))
      const min = ref(100)
      const max = ref(200)
      // Time range spanning Jan 1 to Jan 31 — entries are in the middle
      const timeRange = ref<TimeRange>({
        t0: new Date('2026-01-01T12:00:00').getTime(),
        t1: new Date('2026-01-31T12:00:00').getTime(),
      })
      const { points } = useSVGTimeSeries(entries, min, max, timeRange)
      const pts = points.value
      // Points should NOT be at the edges — they're offset from the period boundaries
      expect(pts[0].x).toBeGreaterThan(GRAPH.PAD_L)
      expect(pts[1].x).toBeLessThan(GRAPH.PAD_L + CHART_W)
    })
  })

  describe('linePoints', () => {
    it('produces a space-delimited coordinate string', () => {
      const entries = ref(makeEntries([
        ['2026-01-01', 100],
        ['2026-01-10', 200],
      ]))
      const min = ref(100)
      const max = ref(200)
      const { linePoints } = useSVGTimeSeries(entries, min, max)
      const parts = linePoints.value.split(' ')
      expect(parts).toHaveLength(2)
      for (const part of parts) {
        expect(part).toMatch(/^\d+\.\d+,\d+\.\d+$/)
      }
    })
  })

  describe('areaPoints', () => {
    it('creates a closed polygon with bottom baseline', () => {
      const entries = ref(makeEntries([
        ['2026-01-01', 100],
        ['2026-01-10', 200],
      ]))
      const min = ref(100)
      const max = ref(200)
      const { areaPoints } = useSVGTimeSeries(entries, min, max)
      const parts = areaPoints.value.split(' ')
      // 2 data points + 2 baseline points (first bottom + last bottom) = 4
      expect(parts).toHaveLength(4)
      const bottom = GRAPH.PAD_T + CHART_H
      // First and last points should be on the baseline
      expect(parts[0]).toContain(`,${bottom}`)
      expect(parts[3]).toContain(`,${bottom}`)
    })

    it('returns empty string when no points', () => {
      const entries = ref(makeEntries([]))
      const min = ref(0)
      const max = ref(0)
      const { areaPoints } = useSVGTimeSeries(entries, min, max)
      expect(areaPoints.value).toBe('')
    })
  })

  describe('gridYs', () => {
    it('returns three horizontal grid positions', () => {
      const entries = ref(makeEntries([]))
      const min = ref(0)
      const max = ref(100)
      const { gridYs } = useSVGTimeSeries(entries, min, max)
      expect(gridYs.value).toEqual([
        GRAPH.PAD_T,
        GRAPH.PAD_T + CHART_H / 2,
        GRAPH.PAD_T + CHART_H,
      ])
    })
  })

  describe('visibleLabelIndices', () => {
    it('includes first point and filters overlapping labels', () => {
      // Create many closely-spaced points
      const data: [string, number][] = []
      for (let i = 0; i < 20; i++) {
        const day = String(i + 1).padStart(2, '0')
        data.push([`2026-01-${day}`, 100 + i])
      }
      const entries = ref(makeEntries(data))
      const min = ref(100)
      const max = ref(119)
      const { visibleLabelIndices } = useSVGTimeSeries(entries, min, max)
      const indices = visibleLabelIndices.value
      expect(indices[0]).toBe(0)
      // Should have fewer labels than points
      expect(indices.length).toBeLessThan(20)
      // Labels should be spaced at least 50px apart
      const pts = useSVGTimeSeries(entries, min, max).points.value
      for (let i = 1; i < indices.length; i++) {
        const gap = pts[indices[i]].x - pts[indices[i - 1]].x
        expect(gap).toBeGreaterThanOrEqual(50)
      }
    })

    it('returns empty for no points', () => {
      const entries = ref(makeEntries([]))
      const min = ref(0)
      const max = ref(0)
      const { visibleLabelIndices } = useSVGTimeSeries(entries, min, max)
      expect(visibleLabelIndices.value).toEqual([])
    })
  })

  describe('shouldShowLabel', () => {
    it('returns true for visible indices only', () => {
      const entries = ref(makeEntries([
        ['2026-01-01', 100],
        ['2026-06-01', 200],
      ]))
      const min = ref(100)
      const max = ref(200)
      const { shouldShowLabel } = useSVGTimeSeries(entries, min, max)
      expect(shouldShowLabel(0)).toBe(true)
      expect(shouldShowLabel(1)).toBe(true)
      expect(shouldShowLabel(5)).toBe(false)
    })
  })

  describe('valueToY', () => {
    it('maps min value to bottom and max to top', () => {
      const entries = ref(makeEntries([
        ['2026-01-01', 100],
        ['2026-01-10', 200],
      ]))
      const min = ref(100)
      const max = ref(200)
      const { valueToY } = useSVGTimeSeries(entries, min, max)
      expect(valueToY(100)).toBeCloseTo(GRAPH.PAD_T + CHART_H, 1)
      expect(valueToY(200)).toBeCloseTo(GRAPH.PAD_T, 1)
      expect(valueToY(150)).toBeCloseTo(GRAPH.PAD_T + CHART_H / 2, 1)
    })

    it('returns center when range is zero', () => {
      const entries = ref(makeEntries([]))
      const min = ref(150)
      const max = ref(150)
      const { valueToY } = useSVGTimeSeries(entries, min, max)
      expect(valueToY(150)).toBeCloseTo(GRAPH.PAD_T + CHART_H / 2, 1)
    })
  })
})

describe('formatGraphDate', () => {
  it('formats ISO date to short month + day', () => {
    const result = formatGraphDate('2026-03-15')
    expect(result).toContain('15')
    expect(result).toContain('Mar')
  })
})
