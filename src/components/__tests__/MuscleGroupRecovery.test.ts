import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import MuscleGroupRecovery from '../MuscleGroupRecovery.vue'
import type { TagRecovery } from '../../composables/useTagRecovery'

const sampleRecovery: TagRecovery[] = [
  { tag: 'Legs', lastTrainedDate: '2026-04-08', hoursSince: 72, daysSince: 3, recoveryDays: 3, status: 'recovered' },
  { tag: 'Chest', lastTrainedDate: '2026-04-09', hoursSince: 48, daysSince: 2, recoveryDays: null, status: 'unknown' },
  { tag: 'Shoulders', lastTrainedDate: '2026-04-10', hoursSince: 24, daysSince: 1, recoveryDays: 2, status: 'recovering' },
  { tag: 'Biceps', lastTrainedDate: '2026-04-11', hoursSince: 4, daysSince: 0, recoveryDays: 2, status: 'recent' },
]

function mountRecovery(props?: Partial<{ recovery: TagRecovery[] }>) {
  return mount(MuscleGroupRecovery, {
    props: {
      recovery: props?.recovery ?? sampleRecovery,
    },
  })
}

describe('MuscleGroupRecovery', () => {
  describe('visibility', () => {
    it('renders when recovery has data', () => {
      const wrapper = mountRecovery()
      expect(wrapper.find('.mgChart').exists()).toBe(true)
    })

    it('does not render when recovery is empty', () => {
      const wrapper = mountRecovery({ recovery: [] })
      expect(wrapper.find('.mgChart').exists()).toBe(false)
    })
  })

  describe('rows', () => {
    it('renders one row per tag', () => {
      const wrapper = mountRecovery()
      const rows = wrapper.findAll('.mgRow')
      expect(rows).toHaveLength(4)
    })

    it('displays tag names as plain text labels', () => {
      const wrapper = mountRecovery()
      const labels = wrapper.findAll('.mgLabel')
      expect(labels.map(l => l.text())).toEqual(['Legs', 'Chest', 'Shoulders', 'Biceps'])
    })

    it('displays days-ago text', () => {
      const wrapper = mountRecovery()
      const days = wrapper.findAll('.mgCount')
      expect(days.map(d => d.text())).toEqual(['3d', '2d', '1d', 'Today'])
    })
  })

  describe('progress bars', () => {
    it('shows filled bar for tags with recovery window', () => {
      const wrapper = mountRecovery()
      const fills = wrapper.findAll('.mgBarFill')
      expect(fills).toHaveLength(3) // Legs, Shoulders, Biceps (not Chest)
    })

    it('applies correct status class to bar', () => {
      const wrapper = mountRecovery()
      const fills = wrapper.findAll('.mgBarFill')
      expect(fills[0].classes()).toContain('recBar--recovered')
      expect(fills[1].classes()).toContain('recBar--recovering')
      expect(fills[2].classes()).toContain('recBar--recent')
    })

    it('shows empty bar track for tags without recovery window', () => {
      const wrapper = mountRecovery()
      const tracks = wrapper.findAll('.mgBarTrack')
      // Chest (index 1) should have a track but no fill inside it
      const chestTrack = tracks[1]
      expect(chestTrack.find('.mgBarFill').exists()).toBe(false)
    })

    it('scales bar width based on hoursSince and recoveryDays', () => {
      const wrapper = mountRecovery()
      const fills = wrapper.findAll('.mgBarFill')
      // Legs: 72h / (3*24=72h) = 100%
      expect(fills[0].attributes('style')).toContain('width: 100%')
      // Shoulders: 24h / (2*24=48h) = 50%
      expect(fills[1].attributes('style')).toContain('width: 50%')
      // Biceps: 4h / (2*24=48h) ≈ 8.33%
      const bicepsStyle = fills[2].attributes('style') || ''
      expect(bicepsStyle).toMatch(/width:\s*8\.3/)
    })
  })

  describe('accessibility', () => {
    it('has list role with label', () => {
      const wrapper = mountRecovery()
      const list = wrapper.find('[role="list"]')
      expect(list.exists()).toBe(true)
      expect(list.attributes('aria-label')).toBe('Tag recovery status')
    })

    it('each row has listitem role with descriptive label', () => {
      const wrapper = mountRecovery()
      const items = wrapper.findAll('[role="listitem"]')
      expect(items).toHaveLength(4)
      expect(items[0].attributes('aria-label')).toContain('Legs')
      expect(items[0].attributes('aria-label')).toContain('3d')
      expect(items[0].attributes('aria-label')).toContain('recovered')
    })
  })

  describe('title', () => {
    it('displays Recovery title', () => {
      const wrapper = mountRecovery()
      expect(wrapper.find('.mgTitle').text()).toBe('Recovery')
    })
  })
})
