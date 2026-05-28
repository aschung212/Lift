import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ConsistencyHeatmap from '../ConsistencyHeatmap.vue'
import type { HeatmapDay } from '../ConsistencyHeatmap.vue'

function makeDays(dates: string[]): HeatmapDay[] {
  // Generate a full year of days for 2026, with sets only on specified dates
  const days: HeatmapDay[] = []
  for (let m = 0; m < 12; m++) {
    const daysInMonth = new Date(2026, m + 1, 0).getDate()
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `2026-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const sets = dates.includes(dateStr) ? 5 : 0
      days.push({ date: dateStr, sets })
    }
  }
  return days
}

function mountHeatmap(props?: Partial<{
  year: number
  days: HeatmapDay[]
  currentStreak: number
  longestStreak: number
  isCurrentYear: boolean
}>) {
  return mount(ConsistencyHeatmap, {
    props: {
      year: props?.year ?? 2026,
      days: props?.days ?? makeDays([]),
      currentStreak: props?.currentStreak ?? 0,
      longestStreak: props?.longestStreak ?? 0,
      isCurrentYear: props?.isCurrentYear ?? false,
    },
  })
}

describe('ConsistencyHeatmap', () => {
  describe('stats display', () => {
    it('renders streak and total workout day stats', () => {
      const wrapper = mountHeatmap({
        currentStreak: 3,
        longestStreak: 8,
        days: makeDays(['2026-01-05', '2026-01-12', '2026-01-19']),
      })

      const statValues = wrapper.findAll('.heatmapStatValue')
      expect(statValues[0].text()).toBe('3')  // current streak
      expect(statValues[1].text()).toBe('8')  // longest streak
      expect(statValues[2].text()).toBe('3')  // total workout days
    })

    it('uses singular "week" for streak of 1', () => {
      const wrapper = mountHeatmap({ currentStreak: 1, longestStreak: 1 })
      const labels = wrapper.findAll('.heatmapStatLabel')
      expect(labels[0].text()).toBe('week current')
      expect(labels[1].text()).toBe('week longest')
    })

    it('uses plural "weeks" for streak > 1', () => {
      const wrapper = mountHeatmap({ currentStreak: 5, longestStreak: 10 })
      const labels = wrapper.findAll('.heatmapStatLabel')
      expect(labels[0].text()).toBe('weeks current')
      expect(labels[1].text()).toBe('weeks longest')
    })
  })

  describe('year navigation', () => {
    it('displays the year', () => {
      const wrapper = mountHeatmap({ year: 2025 })
      expect(wrapper.find('.heatmapNavLabel').text()).toBe('2025')
    })

    it('emits prev-year on left arrow click', async () => {
      const wrapper = mountHeatmap()
      await wrapper.findAll('.calNavBtn')[0].trigger('click')
      expect(wrapper.emitted('prev-year')).toHaveLength(1)
    })

    it('emits next-year on right arrow click', async () => {
      const wrapper = mountHeatmap()
      await wrapper.findAll('.calNavBtn')[1].trigger('click')
      expect(wrapper.emitted('next-year')).toHaveLength(1)
    })

    it('disables next arrow for current year', () => {
      const wrapper = mountHeatmap({ isCurrentYear: true })
      const nextBtn = wrapper.findAll('.calNavBtn')[1]
      expect((nextBtn.element as HTMLButtonElement).disabled).toBe(true)
    })
  })

  describe('heatmap grid', () => {
    it('renders cells for each day', () => {
      const wrapper = mountHeatmap({ isCurrentYear: false, year: 2025 })
      const cells = wrapper.findAll('.heatmapCell')
      // Should have cells in the grid (365 days + legend cells)
      // Grid cells are inside .heatmapGrid
      const gridCells = wrapper.find('.heatmapGrid').findAll('.heatmapCell')
      expect(gridCells.length).toBe(365)
    })

    it('assigns L0 class to rest days', () => {
      const wrapper = mountHeatmap({ days: makeDays([]), year: 2025, isCurrentYear: false })
      const gridCells = wrapper.find('.heatmapGrid').findAll('.heatmapCell')
      // All should be L0 since no workout days
      expect(gridCells.every(c => c.classes().includes('heatmapL0'))).toBe(true)
    })

    it('assigns non-zero level to workout days', () => {
      const wrapper = mountHeatmap({
        days: makeDays(['2026-03-15']),
        year: 2026,
        isCurrentYear: false,
      })
      const gridCells = wrapper.find('.heatmapGrid').findAll('.heatmapCell')
      const nonZero = gridCells.filter(c => !c.classes().includes('heatmapL0'))
      expect(nonZero.length).toBeGreaterThanOrEqual(1)
    })

    it('has aria-label on the grid', () => {
      const wrapper = mountHeatmap({ year: 2025 })
      const grid = wrapper.find('.heatmapGrid')
      expect(grid.attributes('aria-label')).toBe('Workout consistency heatmap for 2025')
    })
  })

  describe('month labels', () => {
    it('renders 12 month labels', () => {
      const wrapper = mountHeatmap()
      const labels = wrapper.findAll('.heatmapMonthLabel')
      expect(labels.length).toBe(12)
      expect(labels[0].text()).toBe('Jan')
      expect(labels[11].text()).toBe('Dec')
    })
  })

  describe('legend', () => {
    it('renders legend with Less/More labels and 5 level cells', () => {
      const wrapper = mountHeatmap()
      const legend = wrapper.find('.heatmapLegend')
      expect(legend.exists()).toBe(true)

      const labels = legend.findAll('.heatmapLegendLabel')
      expect(labels[0].text()).toBe('Less')
      expect(labels[1].text()).toBe('More')

      const legendCells = legend.findAll('.heatmapCell')
      expect(legendCells.length).toBe(5)
    })
  })
})
