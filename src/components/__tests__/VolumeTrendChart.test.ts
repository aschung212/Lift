import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import VolumeTrendChart from '../VolumeTrendChart.vue'
import type { TimeSeriesEntry } from '../../composables/useSVGTimeSeries'

vi.mock('../../composables/useWeightUnit', () => ({
  useWeightUnit: () => ({
    weightUnit: { value: 'lbs' },
    displayWeight: (w: number) => Math.round(w),
    toLbs: (w: number) => w,
  }),
}))

const weeks: TimeSeriesEntry[] = [
  { date: '2026-03-23', value: 12000 },
  { date: '2026-03-30', value: 0 },
  { date: '2026-04-06', value: 18500 },
]

describe('VolumeTrendChart', () => {
  it('renders nothing with fewer than 2 weeks', () => {
    const wrapper = mount(VolumeTrendChart, {
      props: { weeklyVolume: [{ date: '2026-03-23', value: 100 }], totalVolume: 100 },
    })
    expect(wrapper.find('.vtChart').exists()).toBe(false)
  })

  it('renders the SVG chart when expanded', () => {
    const wrapper = mount(VolumeTrendChart, {
      props: { weeklyVolume: weeks, totalVolume: 30500, collapsed: false },
    })
    expect(wrapper.find('.wtGraphSvg').exists()).toBe(true)
    expect(wrapper.find('.wtGLine').exists()).toBe(true)
    expect(wrapper.find('.wtGArea').exists()).toBe(true)
  })

  it('hides the chart body but keeps the header when collapsed', () => {
    const wrapper = mount(VolumeTrendChart, {
      props: { weeklyVolume: weeks, totalVolume: 30500, collapsed: true },
    })
    expect(wrapper.find('.vtHeader').exists()).toBe(true)
    expect(wrapper.find('.wtGraphSvg').exists()).toBe(false)
    // Collapsed summary shows abbreviated total volume.
    expect(wrapper.find('.vtCollapsedSummary').text()).toContain('30.5k')
  })

  it('abbreviates large y-axis values with k', () => {
    const wrapper = mount(VolumeTrendChart, {
      props: { weeklyVolume: weeks, totalVolume: 30500, collapsed: false },
    })
    const labels = wrapper.findAll('.wtGYLabel').map(n => n.text())
    expect(labels.some(t => t.includes('18.5k'))).toBe(true)
  })

  it('emits toggleCollapsed when the header is clicked', async () => {
    const wrapper = mount(VolumeTrendChart, {
      props: { weeklyVolume: weeks, totalVolume: 30500, collapsed: false },
    })
    await wrapper.find('.vtHeader').trigger('click')
    expect(wrapper.emitted('toggleCollapsed')).toHaveLength(1)
  })
})
