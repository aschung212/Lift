import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import MuscleGroupChart from '../MuscleGroupChart.vue'
import type { MuscleGroupSets } from '../../composables/useMuscleGroupVolume'

const sampleVolume: MuscleGroupSets[] = [
  { group: 'Chest', sets: 12 },
  { group: 'Back', sets: 8 },
  { group: 'Legs', sets: 10 },
]

function mountChart(props?: Partial<{ weeklyVolume: MuscleGroupSets[]; maxSets: number; totalSets: number }>) {
  return mount(MuscleGroupChart, {
    props: {
      weeklyVolume: props?.weeklyVolume ?? sampleVolume,
      maxSets: props?.maxSets ?? 12,
      totalSets: props?.totalSets ?? 30,
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

  describe('bar chart view (default)', () => {
    it('shows bar chart by default, not heatmap', () => {
      const wrapper = mountChart()
      expect(wrapper.find('.mgBars').exists()).toBe(true)
      expect(wrapper.find('.heatmapWrap').exists()).toBe(false)
    })

    it('renders one bar per muscle group', () => {
      const wrapper = mountChart()
      const rows = wrapper.findAll('.mgRow')
      expect(rows).toHaveLength(3)
    })

    it('displays muscle group labels', () => {
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
      expect(list.attributes('aria-label')).toContain('3 muscle groups')
    })

    it('each row has accessible listitem role', () => {
      const wrapper = mountChart()
      const items = wrapper.findAll('[role="listitem"]')
      expect(items).toHaveLength(3)
      expect(items[0].attributes('aria-label')).toBe('Chest: 12 sets')
    })
  })

  describe('heatmap toggle', () => {
    it('shows heatmap when toggle is clicked', async () => {
      const wrapper = mountChart()
      await wrapper.find('.mgViewToggle').trigger('click')
      expect(wrapper.find('.heatmapWrap').exists()).toBe(true)
      expect(wrapper.find('.mgBars').exists()).toBe(false)
    })

    it('switches back to bar chart on second click', async () => {
      const wrapper = mountChart()
      const toggle = wrapper.find('.mgViewToggle')
      await toggle.trigger('click')
      await toggle.trigger('click')
      expect(wrapper.find('.mgBars').exists()).toBe(true)
      expect(wrapper.find('.heatmapWrap').exists()).toBe(false)
    })

    it('toggle button has accessible label', () => {
      const wrapper = mountChart()
      const toggle = wrapper.find('.mgViewToggle')
      expect(toggle.attributes('aria-label')).toContain('body heatmap')
    })

    it('toggle label updates after switching to heatmap', async () => {
      const wrapper = mountChart()
      await wrapper.find('.mgViewToggle').trigger('click')
      expect(wrapper.find('.mgViewToggle').attributes('aria-label')).toContain('bar chart')
    })
  })

  describe('touch target compliance', () => {
    // NOTE: jsdom does not apply scoped CSS from Vue SFCs, so getComputedStyle
    // cannot verify the actual 44px sizing here. The actual 44px rule is verified
    // via CSS regression tests in cssRegression.test.ts which read the stylesheet
    // source directly. This test verifies the element has the correct class and
    // no inline style overrides that would shrink it below 44px.
    it('view toggle has mgViewToggle class (44px verified in CSS regression tests)', () => {
      const wrapper = mountChart()
      const toggle = wrapper.find('.mgViewToggle')
      expect(toggle.exists()).toBe(true)
      expect(toggle.classes()).toContain('mgViewToggle')
      // Ensure no inline styles override the CSS-defined 44px touch target
      const inlineWidth = toggle.element.style.width
      const inlineHeight = toggle.element.style.height
      if (inlineWidth) expect(parseInt(inlineWidth)).toBeGreaterThanOrEqual(44)
      if (inlineHeight) expect(parseInt(inlineHeight)).toBeGreaterThanOrEqual(44)
    })
  })

  describe('total sets display', () => {
    it('shows total sets for the week', () => {
      const wrapper = mountChart()
      expect(wrapper.find('.mgTotal').text()).toBe('30 sets this week')
    })
  })

  describe('header', () => {
    it('displays the chart title', () => {
      const wrapper = mountChart()
      expect(wrapper.find('.mgTitle').text()).toBe('Weekly Volume by Muscle Group')
    })
  })
})
