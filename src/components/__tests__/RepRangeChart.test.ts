import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import RepRangeChart from '../RepRangeChart.vue'
import type { RepZone } from '../../composables/useRepRangeDistribution'

const zones: RepZone[] = [
  { id: 'strength', label: 'Strength', range: '1–5', sets: 2 },
  { id: 'hypertrophy', label: 'Hypertrophy', range: '6–12', sets: 6 },
  { id: 'endurance', label: 'Endurance', range: '13+', sets: 2 },
]
const dominant = zones[1]

describe('RepRangeChart', () => {
  it('renders nothing when there are no sets', () => {
    const wrapper = mount(RepRangeChart, {
      props: {
        zones: zones.map(z => ({ ...z, sets: 0 })),
        totalSets: 0,
        dominant: null,
      },
    })
    expect(wrapper.find('.rrChart').exists()).toBe(false)
  })

  it('renders one bar segment per non-empty zone when expanded', () => {
    const wrapper = mount(RepRangeChart, {
      props: { zones, totalSets: 10, dominant, collapsed: false },
    })
    expect(wrapper.find('.rrBar').exists()).toBe(true)
    expect(wrapper.findAll('.rrSeg')).toHaveLength(3)
  })

  it('omits empty zones from the bar but keeps them in the legend', () => {
    const partial: RepZone[] = [
      { id: 'strength', label: 'Strength', range: '1–5', sets: 4 },
      { id: 'hypertrophy', label: 'Hypertrophy', range: '6–12', sets: 6 },
      { id: 'endurance', label: 'Endurance', range: '13+', sets: 0 },
    ]
    const wrapper = mount(RepRangeChart, {
      props: { zones: partial, totalSets: 10, dominant: partial[1], collapsed: false },
    })
    expect(wrapper.findAll('.rrSeg')).toHaveLength(2)
    expect(wrapper.findAll('.rrLegendRow')).toHaveLength(3)
  })

  it('computes whole-number percentages in the legend', () => {
    const wrapper = mount(RepRangeChart, {
      props: { zones, totalSets: 10, dominant, collapsed: false },
    })
    const pcts = wrapper.findAll('.rrLegendPct').map(n => n.text())
    expect(pcts).toEqual(['20%', '60%', '20%'])
  })

  it('hides the body but keeps the header and dominant summary when collapsed', () => {
    const wrapper = mount(RepRangeChart, {
      props: { zones, totalSets: 10, dominant, collapsed: true },
    })
    expect(wrapper.find('.rrHeader').exists()).toBe(true)
    expect(wrapper.find('.rrBar').exists()).toBe(false)
    expect(wrapper.find('.rrCollapsedSummary').text()).toBe('Hypertrophy')
  })

  it('exposes an accessible label describing the distribution', () => {
    const wrapper = mount(RepRangeChart, {
      props: { zones, totalSets: 10, dominant, collapsed: false },
    })
    expect(wrapper.find('.rrBar').attributes('aria-label')).toContain('10 sets')
  })

  it('emits toggleCollapsed when the header is clicked', async () => {
    const wrapper = mount(RepRangeChart, {
      props: { zones, totalSets: 10, dominant, collapsed: false },
    })
    await wrapper.find('.rrHeader').trigger('click')
    expect(wrapper.emitted('toggleCollapsed')).toHaveLength(1)
  })
})
