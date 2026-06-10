import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import RepRangeChart from '../RepRangeChart.vue'
import type { RepZone } from '../../composables/useRepRangeDistribution'

const sampleZones: RepZone[] = [
  { key: 'strength', label: 'Strength', range: '1–5 reps', sets: 4 },
  { key: 'hypertrophy', label: 'Hypertrophy', range: '6–12 reps', sets: 12 },
  { key: 'endurance', label: 'Endurance', range: '13+ reps', sets: 4 },
]

function mountChart(props?: Partial<{ zones: RepZone[]; totalSets: number; collapsed: boolean }>) {
  return mount(RepRangeChart, {
    props: {
      zones: props?.zones ?? sampleZones,
      totalSets: props?.totalSets ?? 20,
      collapsed: props?.collapsed ?? false,
    },
  })
}

describe('RepRangeChart', () => {
  describe('visibility', () => {
    it('renders when there are sets', () => {
      expect(mountChart().find('.rrChart').exists()).toBe(true)
    })

    it('does not render when totalSets is 0', () => {
      const zeroZones = sampleZones.map(z => ({ ...z, sets: 0 }))
      expect(mountChart({ zones: zeroZones, totalSets: 0 }).find('.rrChart').exists()).toBe(false)
    })
  })

  describe('expanded view', () => {
    it('renders a bar segment per non-empty zone', () => {
      const segments = mountChart().findAll('.rrSegment')
      expect(segments).toHaveLength(3)
    })

    it('omits segments for empty zones', () => {
      const zones: RepZone[] = [
        { key: 'strength', label: 'Strength', range: '1–5 reps', sets: 0 },
        { key: 'hypertrophy', label: 'Hypertrophy', range: '6–12 reps', sets: 10 },
        { key: 'endurance', label: 'Endurance', range: '13+ reps', sets: 0 },
      ]
      const wrapper = mountChart({ zones, totalSets: 10 })
      expect(wrapper.findAll('.rrSegment')).toHaveLength(1)
    })

    it('scales segment width by share of total', () => {
      const fills = mountChart().findAll('.rrSegment')
      // strength 4/20 = 20%
      expect(fills[0].attributes('style')).toContain('width: 20%')
      // hypertrophy 12/20 = 60%
      expect(fills[1].attributes('style')).toContain('width: 60%')
    })

    it('always shows all three legend rows even when a zone is empty', () => {
      const zones = sampleZones.map((z, i) => (i === 0 ? { ...z, sets: 0 } : z))
      const rows = mountChart({ zones, totalSets: 16 }).findAll('.rrLegendRow')
      expect(rows).toHaveLength(3)
    })

    it('displays zone labels, ranges, counts and percentages', () => {
      const wrapper = mountChart()
      expect(wrapper.findAll('.rrLegendLabel').map(l => l.text())).toEqual(['Strength', 'Hypertrophy', 'Endurance'])
      expect(wrapper.findAll('.rrLegendRange').map(l => l.text())).toEqual(['1–5 reps', '6–12 reps', '13+ reps'])
      expect(wrapper.findAll('.rrLegendCount').map(l => l.text())).toEqual(['4', '12', '4'])
      expect(wrapper.findAll('.rrLegendPct').map(l => l.text())).toEqual(['20%', '60%', '20%'])
    })

    it('exposes an accessible bar summary', () => {
      const bar = mountChart().find('.rrBar')
      expect(bar.attributes('role')).toBe('img')
      expect(bar.attributes('aria-label')).toContain('20 sets')
      expect(bar.attributes('aria-label')).toContain('Hypertrophy 60%')
    })

    it('labels each legend row for screen readers', () => {
      const rows = mountChart().findAll('[role="listitem"]')
      expect(rows[0].attributes('aria-label')).toBe('Strength (1–5 reps): 4 sets, 20%')
    })
  })

  describe('collapsed view', () => {
    it('hides the bar when collapsed', () => {
      expect(mountChart({ collapsed: true }).find('.rrBar').exists()).toBe(false)
    })

    it('shows a summary when collapsed', () => {
      expect(mountChart({ collapsed: true }).find('.rrCollapsedSummary').text()).toBe('20 sets')
    })
  })

  describe('header', () => {
    it('displays the chart title', () => {
      expect(mountChart().find('.rrTitle').text()).toBe('Rep Range Distribution')
    })

    it('emits toggleCollapsed when header clicked', async () => {
      const wrapper = mountChart()
      await wrapper.find('.rrHeader').trigger('click')
      expect(wrapper.emitted('toggleCollapsed')).toHaveLength(1)
    })

    it('reflects collapsed state via aria-expanded', () => {
      expect(mountChart({ collapsed: false }).find('.rrHeader').attributes('aria-expanded')).toBe('true')
      expect(mountChart({ collapsed: true }).find('.rrHeader').attributes('aria-expanded')).toBe('false')
    })
  })
})
