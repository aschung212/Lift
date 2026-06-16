import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import MuscleGroupChart from '../MuscleGroupChart.vue'
import type { TagVolume } from '../../composables/useTagVolume'
import type { TimeSeriesEntry } from '../../composables/useSVGTimeSeries'

const sampleVolume: TagVolume[] = [
  { tag: 'Chest', sets: 12 },
  { tag: 'Back', sets: 8 },
  { tag: 'Legs', sets: 10 },
]

const sampleTrends: Record<string, TimeSeriesEntry[]> = {
  Chest: [
    { date: '2026-03-02', value: 1000 },
    { date: '2026-03-09', value: 1400 },
    { date: '2026-03-16', value: 1200 },
  ],
  Back: [
    { date: '2026-03-09', value: 800 },
    { date: '2026-03-16', value: 900 },
  ],
  // Legs has only one week → not expandable.
  Legs: [{ date: '2026-03-16', value: 600 }],
}

function mountChart(props?: Partial<{ weeklyVolume: TagVolume[]; maxSets: number; totalSets: number; collapsed: boolean; tagTrends: Record<string, TimeSeriesEntry[]> }>) {
  return mount(MuscleGroupChart, {
    props: {
      weeklyVolume: props?.weeklyVolume ?? sampleVolume,
      maxSets: props?.maxSets ?? 12,
      totalSets: props?.totalSets ?? 30,
      collapsed: props?.collapsed ?? false,
      ...(props?.tagTrends !== undefined ? { tagTrends: props.tagTrends } : {}),
    },
  })
}

describe('MuscleGroupChart', () => {
  describe('visibility', () => {
    it('renders when weeklyVolume has data', () => {
      const wrapper = mountChart()
      expect(wrapper.find('.mgChart').exists()).toBe(true)
    })

    it('does not render when weeklyVolume is empty', () => {
      const wrapper = mountChart({ weeklyVolume: [], maxSets: 0, totalSets: 0 })
      expect(wrapper.find('.mgChart').exists()).toBe(false)
    })
  })

  describe('expanded view (default)', () => {
    it('shows bars by default', () => {
      const wrapper = mountChart()
      expect(wrapper.find('.mgBars').exists()).toBe(true)
    })

    it('renders one bar per tag', () => {
      const wrapper = mountChart()
      const rows = wrapper.findAll('.mgRow')
      expect(rows).toHaveLength(3)
    })

    it('displays tag labels', () => {
      const wrapper = mountChart()
      const labels = wrapper.findAll('.mgLabel')
      expect(labels.map(l => l.text())).toEqual(['Chest', 'Back', 'Legs'])
    })

    it('displays set counts', () => {
      const wrapper = mountChart()
      const counts = wrapper.findAll('.mgCount')
      expect(counts.map(c => c.text())).toEqual(['12', '8', '10'])
    })

    it('scales bar width relative to maxSets', () => {
      const wrapper = mountChart()
      const fills = wrapper.findAll('.mgBarFill')
      // Chest: 12/12 = 100%
      expect(fills[0].attributes('style')).toContain('width: 100%')
      // Back: 8/12 ≈ 66.67%
      const backStyle = fills[1].attributes('style') || ''
      expect(backStyle).toMatch(/width:\s*66\.6/)
    })

    it('has accessible list role with summary', () => {
      const wrapper = mountChart()
      const list = wrapper.find('[role="list"]')
      expect(list.exists()).toBe(true)
      expect(list.attributes('aria-label')).toContain('30 total sets')
      expect(list.attributes('aria-label')).toContain('3 tags')
    })

    it('each row has accessible listitem role', () => {
      const wrapper = mountChart()
      const items = wrapper.findAll('[role="listitem"]')
      expect(items).toHaveLength(3)
      expect(items[0].attributes('aria-label')).toBe('Chest: 12 sets')
    })

    it('shows total sets for the week', () => {
      const wrapper = mountChart()
      expect(wrapper.find('.mgTotal').text()).toBe('30 sets this week')
    })
  })

  describe('collapsed view', () => {
    it('hides bars when collapsed', () => {
      const wrapper = mountChart({ collapsed: true })
      expect(wrapper.find('.mgBars').exists()).toBe(false)
    })

    it('shows summary text when collapsed', () => {
      const wrapper = mountChart({ collapsed: true })
      expect(wrapper.find('.mgCollapsedSummary').text()).toBe('30 sets')
    })

    it('hides total when collapsed', () => {
      const wrapper = mountChart({ collapsed: true })
      expect(wrapper.find('.mgTotal').exists()).toBe(false)
    })
  })

  describe('header', () => {
    it('displays the chart title', () => {
      const wrapper = mountChart()
      expect(wrapper.find('.mgTitle').text()).toBe('Weekly Volume by Tag')
    })

    it('emits toggleCollapsed when header is clicked', async () => {
      const wrapper = mountChart()
      await wrapper.find('.mgHeader').trigger('click')
      expect(wrapper.emitted('toggleCollapsed')).toHaveLength(1)
    })

    it('sets aria-expanded="true" on the toggle when expanded', () => {
      const wrapper = mountChart({ collapsed: false })
      expect(wrapper.find('.mgHeader').attributes('aria-expanded')).toBe('true')
    })

    it('sets aria-expanded="false" on the toggle when collapsed', () => {
      const wrapper = mountChart({ collapsed: true })
      expect(wrapper.find('.mgHeader').attributes('aria-expanded')).toBe('false')
    })
  })

  describe('touch target compliance', () => {
    it('header has mgHeader class (44px verified in CSS regression tests)', () => {
      const wrapper = mountChart()
      const header = wrapper.find('.mgHeader')
      expect(header.exists()).toBe(true)
    })
  })

  describe('tag trend expansion', () => {
    it('renders rows as non-interactive divs when no tagTrends provided', () => {
      const wrapper = mountChart()
      const mains = wrapper.findAll('.mgRowMain')
      expect(mains).toHaveLength(3)
      mains.forEach(m => expect(m.element.tagName).toBe('DIV'))
      expect(wrapper.find('.mgRowChevron').exists()).toBe(false)
    })

    it('makes a tag with ≥2 weeks of history tappable', () => {
      const wrapper = mountChart({ tagTrends: sampleTrends })
      const chestMain = wrapper.findAll('.mgRowMain')[0]
      expect(chestMain.element.tagName).toBe('BUTTON')
      expect(chestMain.attributes('aria-expanded')).toBe('false')
    })

    it('leaves a tag with <2 weeks of history non-interactive', () => {
      const wrapper = mountChart({ tagTrends: sampleTrends })
      // Legs (index 2) has a single-week series.
      const legsMain = wrapper.findAll('.mgRowMain')[2]
      expect(legsMain.element.tagName).toBe('DIV')
      expect(legsMain.attributes('aria-expanded')).toBeUndefined()
    })

    it('reveals the sparkline when an expandable row is tapped', async () => {
      const wrapper = mountChart({ tagTrends: sampleTrends })
      expect(wrapper.findComponent({ name: 'TagVolumeSparkline' }).exists()).toBe(false)

      await wrapper.findAll('.mgRowMain')[0].trigger('click')

      const sparkline = wrapper.findComponent({ name: 'TagVolumeSparkline' })
      expect(sparkline.exists()).toBe(true)
      expect(sparkline.props('tag')).toBe('Chest')
      expect(wrapper.findAll('.mgRowMain')[0].attributes('aria-expanded')).toBe('true')
    })

    it('collapses the sparkline when the open row is tapped again', async () => {
      const wrapper = mountChart({ tagTrends: sampleTrends })
      await wrapper.findAll('.mgRowMain')[0].trigger('click')
      expect(wrapper.findComponent({ name: 'TagVolumeSparkline' }).exists()).toBe(true)

      await wrapper.findAll('.mgRowMain')[0].trigger('click')
      expect(wrapper.findComponent({ name: 'TagVolumeSparkline' }).exists()).toBe(false)
    })

    it('only keeps one tag expanded at a time', async () => {
      const wrapper = mountChart({ tagTrends: sampleTrends })
      await wrapper.findAll('.mgRowMain')[0].trigger('click') // Chest
      await wrapper.findAll('.mgRowMain')[1].trigger('click') // Back

      const sparklines = wrapper.findAllComponents({ name: 'TagVolumeSparkline' })
      expect(sparklines).toHaveLength(1)
      expect(sparklines[0].props('tag')).toBe('Back')
    })

    it('exposes a descriptive aria-label on the toggle', () => {
      const wrapper = mountChart({ tagTrends: sampleTrends })
      const chestMain = wrapper.findAll('.mgRowMain')[0]
      expect(chestMain.attributes('aria-label')).toContain('Chest: 12 sets')
      expect(chestMain.attributes('aria-label')).toContain('Show weekly volume trend')
    })
  })
})
