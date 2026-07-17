import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import TagVolumeSparkline from '../TagVolumeSparkline.vue'
import type { TimeSeriesEntry } from '../../composables/useSVGTimeSeries'

vi.mock('../../composables/useWeightUnit', () => ({
  useWeightUnit: () => ({
    weightUnit: { value: 'lbs' },
    displayWeight: (w: number) => Math.round(w),
    toLbs: (w: number) => w,
  }),
}))

const series: TimeSeriesEntry[] = [
  { date: '2026-03-02', value: 1000 },
  { date: '2026-03-09', value: 0 },
  { date: '2026-03-16', value: 1800 },
]

function mountSparkline(props?: Partial<{ series: TimeSeriesEntry[]; tag: string }>) {
  return mount(TagVolumeSparkline, {
    props: {
      series: props?.series ?? series,
      tag: props?.tag ?? 'Chest',
    },
  })
}

describe('TagVolumeSparkline', () => {
  it('renders nothing with fewer than 2 points', () => {
    const wrapper = mountSparkline({ series: [{ date: '2026-03-02', value: 1000 }] })
    expect(wrapper.find('.mgSparkline').exists()).toBe(false)
  })

  it('renders the SVG line and area when it has data', () => {
    const wrapper = mountSparkline()
    expect(wrapper.find('.wtGraphSvg').exists()).toBe(true)
    expect(wrapper.find('.wtGLine').exists()).toBe(true)
    expect(wrapper.find('.wtGArea').exists()).toBe(true)
  })

  it('titles the chart with the tag name', () => {
    const wrapper = mountSparkline({ tag: 'Legs' })
    expect(wrapper.find('.wtGraphTitle').text()).toBe('Legs weekly volume')
  })

  it('exposes an accessible aria-label naming the tag and value range', () => {
    const wrapper = mountSparkline({ tag: 'Back' })
    const label = wrapper.find('.wtGraphSvg').attributes('aria-label') || ''
    expect(label).toContain('Back weekly volume trend')
    expect(label).toContain('3 weeks')
  })

  it('shows the max and min volume on the y-axis', () => {
    const wrapper = mountSparkline()
    const yLabels = wrapper.findAll('.wtGYLabel').map(t => t.text())
    expect(yLabels).toContain('1.8k')
    expect(yLabels).toContain('0')
  })

  it('abbreviates volumes at or above 1000 with a k suffix', () => {
    const wrapper = mountSparkline({ series: [
      { date: '2026-03-02', value: 12000 },
      { date: '2026-03-09', value: 24500 },
    ] })
    const yLabels = wrapper.findAll('.wtGYLabel').map(t => t.text())
    expect(yLabels).toContain('24.5k')
    expect(yLabels).toContain('12.0k')
  })
})
