import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import MuscleGroupRecovery from '../MuscleGroupRecovery.vue'
import type { TagRecovery } from '../../composables/useTagRecovery'

const sampleRecovery: TagRecovery[] = [
  { tag: 'Legs', lastTrainedDate: '2026-04-08', hoursSince: 72, daysSince: 3, recoveryDays: 3, status: 'recovered' },
  { tag: 'Chest', lastTrainedDate: '2026-04-09', hoursSince: 48, daysSince: 2, recoveryDays: null, status: 'unknown' },
  { tag: 'Shoulders', lastTrainedDate: '2026-04-10', hoursSince: 24, daysSince: 1, recoveryDays: 2, status: 'recovering' },
]

function mountRecovery(props?: Partial<{ recovery: TagRecovery[]; hiddenCount: number; hiddenTags: string[] }>) {
  return mount(MuscleGroupRecovery, {
    props: {
      recovery: props?.recovery ?? sampleRecovery,
      hiddenCount: props?.hiddenCount ?? 0,
      hiddenTags: props?.hiddenTags ?? [],
    },
  })
}

describe('MuscleGroupRecovery', () => {
  describe('visibility', () => {
    it('renders when recovery has data', () => {
      const wrapper = mountRecovery()
      expect(wrapper.find('.mgChart').exists()).toBe(true)
    })

    it('does not render when recovery is empty and no hidden tags', () => {
      const wrapper = mountRecovery({ recovery: [], hiddenCount: 0 })
      expect(wrapper.find('.mgChart').exists()).toBe(false)
    })

    it('renders when recovery is empty but hidden tags exist', () => {
      const wrapper = mountRecovery({ recovery: [], hiddenCount: 2 })
      expect(wrapper.find('.mgChart').exists()).toBe(true)
    })
  })

  describe('rows', () => {
    it('renders one row per tag', () => {
      const wrapper = mountRecovery()
      const rows = wrapper.findAll('.recRow')
      expect(rows).toHaveLength(3)
    })

    it('displays tag names', () => {
      const wrapper = mountRecovery()
      const names = wrapper.findAll('.recName')
      expect(names.map(n => n.text())).toEqual(['Legs', 'Chest', 'Shoulders'])
    })

    it('displays readable days-ago text', () => {
      const wrapper = mountRecovery()
      const days = wrapper.findAll('.recDays')
      expect(days.map(d => d.text())).toEqual(['3 days ago', '2 days ago', 'Yesterday'])
    })
  })

  describe('status dots', () => {
    it('shows colored dot only for tags with recovery window', () => {
      const wrapper = mountRecovery()
      const dots = wrapper.findAll('.recDot')
      expect(dots).toHaveLength(2) // Legs, Shoulders (not Chest)
    })

    it('applies correct status class to dots', () => {
      const wrapper = mountRecovery()
      const dots = wrapper.findAll('.recDot')
      expect(dots[0].classes()).toContain('recDot--recovered')
      expect(dots[1].classes()).toContain('recDot--recovering')
    })
  })

  describe('inline settings', () => {
    it('expands on tap to show settings', async () => {
      const wrapper = mountRecovery()
      expect(wrapper.find('.recExpanded').exists()).toBe(false)

      await wrapper.findAll('.recRow')[0].trigger('click')
      expect(wrapper.find('.recExpanded').exists()).toBe(true)
    })

    it('collapses on second tap', async () => {
      const wrapper = mountRecovery()
      const row = wrapper.findAll('.recRow')[0]

      await row.trigger('click')
      expect(wrapper.find('.recExpanded').exists()).toBe(true)

      await row.trigger('click')
      expect(wrapper.find('.recExpanded').exists()).toBe(false)
    })

    it('shows recovery window input and hide button', async () => {
      const wrapper = mountRecovery()
      await wrapper.findAll('.recRow')[0].trigger('click')

      expect(wrapper.find('.recDaysInput').exists()).toBe(true)
      expect(wrapper.findAll('.recActionBtn').length).toBeGreaterThan(0)
    })
  })

  describe('events', () => {
    it('emits hide when hide button is clicked', async () => {
      const wrapper = mountRecovery()
      await wrapper.findAll('.recRow')[0].trigger('click')
      await wrapper.find('.recActionBtn').trigger('click')
      expect(wrapper.emitted('hide')).toEqual([['Legs']])
    })

    it('emits show when show button is clicked', async () => {
      const wrapper = mountRecovery({ hiddenCount: 1, hiddenTags: ['Back'] })
      await wrapper.find('.recHiddenFooter').trigger('click')
      await wrapper.find('.recShowBtn').trigger('click')
      expect(wrapper.emitted('show')).toEqual([['Back']])
    })

    it('emits days-change when recovery window is changed', async () => {
      const wrapper = mountRecovery()
      await wrapper.findAll('.recRow')[0].trigger('click')
      const input = wrapper.find('.recDaysInput')
      await input.setValue('5')
      const emitted = wrapper.emitted('days-change') as [string, number | null][]
      expect(emitted[emitted.length - 1]).toEqual(['Legs', 5])
    })

    it('emits days-change with null for empty input', async () => {
      const wrapper = mountRecovery()
      await wrapper.findAll('.recRow')[0].trigger('click')
      const input = wrapper.find('.recDaysInput')
      await input.setValue('')
      const emitted = wrapper.emitted('days-change') as [string, number | null][]
      expect(emitted[emitted.length - 1]).toEqual(['Legs', null])
    })
  })

  describe('hidden tags footer', () => {
    it('does not show footer when no tags are hidden', () => {
      const wrapper = mountRecovery({ hiddenCount: 0 })
      expect(wrapper.find('.recHiddenFooter').exists()).toBe(false)
    })

    it('shows footer with count when tags are hidden', () => {
      const wrapper = mountRecovery({ hiddenCount: 2 })
      const footer = wrapper.find('.recHiddenFooter')
      expect(footer.exists()).toBe(true)
      expect(footer.text()).toContain('2 hidden tags')
    })

    it('uses singular when one tag hidden', () => {
      const wrapper = mountRecovery({ hiddenCount: 1 })
      expect(wrapper.find('.recHiddenFooter').text()).toContain('1 hidden tag')
    })

    it('toggles hidden list on footer tap', async () => {
      const wrapper = mountRecovery({ hiddenCount: 1, hiddenTags: ['Back'] })
      expect(wrapper.find('.recHiddenList').exists()).toBe(false)

      await wrapper.find('.recHiddenFooter').trigger('click')
      expect(wrapper.find('.recHiddenList').exists()).toBe(true)

      await wrapper.find('.recHiddenFooter').trigger('click')
      expect(wrapper.find('.recHiddenList').exists()).toBe(false)
    })

    it('renders hidden tag names from prop', async () => {
      const wrapper = mountRecovery({ hiddenCount: 2, hiddenTags: ['Back', 'Biceps'] })
      await wrapper.find('.recHiddenFooter').trigger('click')
      const names = wrapper.findAll('.recHiddenName')
      expect(names.map(n => n.text())).toEqual(['Back', 'Biceps'])
    })
  })

  describe('accessibility', () => {
    it('has list role with label', () => {
      const wrapper = mountRecovery()
      const list = wrapper.find('[role="list"]')
      expect(list.exists()).toBe(true)
      expect(list.attributes('aria-label')).toBe('Tag recovery status')
    })

    it('rows have aria-expanded attribute', () => {
      const wrapper = mountRecovery()
      const rows = wrapper.findAll('.recRow')
      expect(rows[0].attributes('aria-expanded')).toBe('false')
    })

    it('each row has descriptive aria-label', () => {
      const wrapper = mountRecovery()
      const rows = wrapper.findAll('.recRow')
      expect(rows[0].attributes('aria-label')).toContain('Legs')
      expect(rows[0].attributes('aria-label')).toContain('3 days ago')
    })
  })

  describe('title', () => {
    it('displays Recovery title', () => {
      const wrapper = mountRecovery()
      expect(wrapper.find('.mgTitle').text()).toBe('Recovery')
    })
  })
})
