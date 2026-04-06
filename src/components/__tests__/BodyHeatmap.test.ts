import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import BodyHeatmap from '../BodyHeatmap.vue'
import type { MuscleGroupSets } from '../../composables/useMuscleGroupVolume'

const sampleVolume: MuscleGroupSets[] = [
  { group: 'Chest', sets: 12 },
  { group: 'Back', sets: 8 },
  { group: 'Shoulders', sets: 6 },
  { group: 'Legs', sets: 10 },
  { group: 'Core', sets: 4 },
  { group: 'Biceps', sets: 3 },
  { group: 'Triceps', sets: 5 },
]

function mountHeatmap(props?: Partial<{ weeklyVolume: MuscleGroupSets[]; maxSets: number }>) {
  return mount(BodyHeatmap, {
    props: {
      weeklyVolume: props?.weeklyVolume ?? sampleVolume,
      maxSets: props?.maxSets ?? 12,
    },
  })
}

// Read component source to test CSS rules directly (jsdom doesn't apply scoped CSS)
const componentSrc = readFileSync(resolve(__dirname, '../BodyHeatmap.vue'), 'utf-8')
const styleMatch = componentSrc.match(/<style[^>]*>([\s\S]*?)<\/style>/)
const styleBlock = styleMatch ? styleMatch[1] : ''

function getComponentRuleLines(selector: string): string[] {
  const needle = selector + ' {'
  const idx = styleBlock.indexOf(needle)
  if (idx === -1) return []
  const start = styleBlock.indexOf('{', idx) + 1
  let depth = 1
  let end = start
  while (depth > 0 && end < styleBlock.length) {
    if (styleBlock[end] === '{') depth++
    if (styleBlock[end] === '}') depth--
    end++
  }
  return styleBlock.slice(start, end - 1).split('\n').map((l: string) => l.trim()).filter(Boolean)
}

describe('BodyHeatmap', () => {
  describe('view toggle', () => {
    it('defaults to front view', () => {
      const wrapper = mountHeatmap()
      const tabs = wrapper.findAll('[role="tab"]')
      expect(tabs[0].classes()).toContain('active')
      expect(tabs[1].classes()).not.toContain('active')
    })

    it('switches to back view on click', async () => {
      const wrapper = mountHeatmap()
      const tabs = wrapper.findAll('[role="tab"]')
      await tabs[1].trigger('click')
      expect(tabs[1].classes()).toContain('active')
      expect(tabs[0].classes()).not.toContain('active')
    })

    it('has correct aria-selected attributes', async () => {
      const wrapper = mountHeatmap()
      const tabs = wrapper.findAll('[role="tab"]')
      expect(tabs[0].attributes('aria-selected')).toBe('true')
      expect(tabs[1].attributes('aria-selected')).toBe('false')

      await tabs[1].trigger('click')
      expect(tabs[0].attributes('aria-selected')).toBe('false')
      expect(tabs[1].attributes('aria-selected')).toBe('true')
    })
  })

  describe('front view muscle regions', () => {
    it('renders front muscle group SVG paths', () => {
      const wrapper = mountHeatmap()
      const regions = wrapper.findAll('.muscleRegion')
      // Front view: Chest, 2x Shoulder, 2x Bicep, Core, 2x Quad = 8
      expect(regions.length).toBe(8)
    })

    it('shows chest aria label with correct set count', () => {
      const wrapper = mountHeatmap()
      const chestRegion = wrapper.find('[aria-label="Chest: 12 sets"]')
      expect(chestRegion.exists()).toBe(true)
    })

    it('shows core aria label with correct set count', () => {
      const wrapper = mountHeatmap()
      const coreRegion = wrapper.find('[aria-label="Core: 4 sets"]')
      expect(coreRegion.exists()).toBe(true)
    })

    it('all front regions have role="img" and aria-label', () => {
      const wrapper = mountHeatmap()
      const regions = wrapper.findAll('.muscleRegion')
      for (const region of regions) {
        expect(region.attributes('role')).toBe('img')
        expect(region.attributes('aria-label')).toBeTruthy()
      }
    })

    it('shows left/right shoulder aria labels', () => {
      const wrapper = mountHeatmap()
      expect(wrapper.find('[aria-label="Left shoulder: 6 sets"]').exists()).toBe(true)
      expect(wrapper.find('[aria-label="Right shoulder: 6 sets"]').exists()).toBe(true)
    })

    it('shows left/right bicep aria labels', () => {
      const wrapper = mountHeatmap()
      expect(wrapper.find('[aria-label="Left bicep: 3 sets"]').exists()).toBe(true)
      expect(wrapper.find('[aria-label="Right bicep: 3 sets"]').exists()).toBe(true)
    })

    it('shows left/right quad aria labels', () => {
      const wrapper = mountHeatmap()
      expect(wrapper.find('[aria-label="Left quad: 10 sets"]').exists()).toBe(true)
      expect(wrapper.find('[aria-label="Right quad: 10 sets"]').exists()).toBe(true)
    })
  })

  describe('back view muscle regions', () => {
    it('renders back muscle group SVG paths', async () => {
      const wrapper = mountHeatmap()
      await wrapper.findAll('[role="tab"]')[1].trigger('click')
      const regions = wrapper.findAll('.muscleRegion')
      // Back view: 2x Back, 2x Shoulder, 2x Tricep, 2x Hamstring = 8
      expect(regions.length).toBe(8)
    })

    it('shows back aria label with correct set count', async () => {
      const wrapper = mountHeatmap()
      await wrapper.findAll('[role="tab"]')[1].trigger('click')
      const backRegion = wrapper.find('[aria-label="Back: 8 sets"]')
      expect(backRegion.exists()).toBe(true)
    })

    it('shows lower back aria label', async () => {
      const wrapper = mountHeatmap()
      await wrapper.findAll('[role="tab"]')[1].trigger('click')
      expect(wrapper.find('[aria-label="Lower back: 8 sets"]').exists()).toBe(true)
    })

    it('shows left/right tricep aria labels', async () => {
      const wrapper = mountHeatmap()
      await wrapper.findAll('[role="tab"]')[1].trigger('click')
      expect(wrapper.find('[aria-label="Left tricep: 5 sets"]').exists()).toBe(true)
      expect(wrapper.find('[aria-label="Right tricep: 5 sets"]').exists()).toBe(true)
    })

    it('shows left/right shoulder aria labels', async () => {
      const wrapper = mountHeatmap()
      await wrapper.findAll('[role="tab"]')[1].trigger('click')
      expect(wrapper.find('[aria-label="Left shoulder: 6 sets"]').exists()).toBe(true)
      expect(wrapper.find('[aria-label="Right shoulder: 6 sets"]').exists()).toBe(true)
    })

    it('shows left/right hamstring aria labels', async () => {
      const wrapper = mountHeatmap()
      await wrapper.findAll('[role="tab"]')[1].trigger('click')
      expect(wrapper.find('[aria-label="Left hamstring: 10 sets"]').exists()).toBe(true)
      expect(wrapper.find('[aria-label="Right hamstring: 10 sets"]').exists()).toBe(true)
    })

    it('all back regions have role="img" and aria-label', async () => {
      const wrapper = mountHeatmap()
      await wrapper.findAll('[role="tab"]')[1].trigger('click')
      const regions = wrapper.findAll('.muscleRegion')
      for (const region of regions) {
        expect(region.attributes('role')).toBe('img')
        expect(region.attributes('aria-label')).toBeTruthy()
      }
    })
  })

  describe('region opacity (volume intensity)', () => {
    it('applies full opacity for max-volume muscle group', () => {
      const wrapper = mountHeatmap()
      // Chest has 12 sets = maxSets, so opacity = 0.15 + 1.0 * 0.70 = 0.85
      const chestRegion = wrapper.find('[aria-label="Chest: 12 sets"]')
      expect(chestRegion.attributes('style')).toContain('fill-opacity: 0.85')
    })

    it('applies scaled opacity for partial-volume group', () => {
      const wrapper = mountHeatmap()
      // Core has 4 sets, maxSets 12 → ratio = 4/12 ≈ 0.333, opacity ≈ 0.15 + 0.333 * 0.70 ≈ 0.383
      const coreRegion = wrapper.find('[aria-label*="Core: 4 sets"]')
      const style = coreRegion.attributes('style') || ''
      const match = style.match(/fill-opacity:\s*([\d.]+)/)
      expect(match).toBeTruthy()
      const opacity = parseFloat(match![1])
      expect(opacity).toBeGreaterThan(0.3)
      expect(opacity).toBeLessThan(0.5)
    })

    it('applies zero opacity for muscle groups with no sets', () => {
      const wrapper = mountHeatmap({
        weeklyVolume: [{ group: 'Chest', sets: 0 }],
        maxSets: 0,
      })
      // All regions should have fillOpacity: 0 since no sets
      const regions = wrapper.findAll('.muscleRegion')
      for (const region of regions) {
        expect(region.attributes('style')).toContain('fill-opacity: 0')
      }
    })
  })

  describe('structure', () => {
    it('has a tablist for front/back toggle', () => {
      const wrapper = mountHeatmap()
      expect(wrapper.find('[role="tablist"]').exists()).toBe(true)
    })

    it('renders SVG with correct viewBox', () => {
      const wrapper = mountHeatmap()
      const svg = wrapper.find('svg')
      expect(svg.attributes('viewBox')).toBe('0 0 200 400')
    })

    it('renders the legend', () => {
      const wrapper = mountHeatmap()
      expect(wrapper.find('.heatmapLegend').exists()).toBe(true)
      expect(wrapper.find('.legendBar').exists()).toBe(true)
    })

    it('legend is hidden from screen readers', () => {
      const wrapper = mountHeatmap()
      expect(wrapper.find('.heatmapLegend').attributes('aria-hidden')).toBe('true')
    })
  })

  describe('CSS regression: iOS HIG touch targets', () => {
    // Regression: .heatmapTab had min-height: 32px, below 44pt iOS HIG minimum (LIFT-96)
    // jsdom doesn't apply scoped CSS, so we read the stylesheet source directly
    const tabLines = getComponentRuleLines('.heatmapTab')

    it('.heatmapTab has min-height: 44px for iOS HIG compliance', () => {
      const hasCorrectMinHeight = tabLines.some(l => l.includes('min-height') && l.includes('44px'))
      expect(hasCorrectMinHeight).toBe(true)
    })

    it('.heatmapTab does not use sub-44px min-height', () => {
      const hasSmallMinHeight = tabLines.some(l => {
        const match = l.match(/min-height\s*:\s*(\d+)px/)
        return match && parseInt(match[1], 10) < 44
      })
      expect(hasSmallMinHeight).toBe(false)
    })
  })
})
