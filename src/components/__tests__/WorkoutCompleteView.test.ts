import { describe, it, expect, beforeEach } from 'vitest'
import { mount, VueWrapper } from '@vue/test-utils'
import WorkoutCompleteView from '../WorkoutCompleteView.vue'
import type { SessionSummary } from '../../lib/sessionSummary'

function makeSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    rawDate: '2026-07-17',
    date: 'Fri, Jul 17',
    duration: '1h 12m',
    totalVolume: 12500,
    setsCompleted: 8,
    exercises: 3,
    prs: 1,
    repPRs: 1,
    bestSet: {
      exerciseId: 'ex-1',
      name: 'Bench Press',
      weight: 225,
      reps: 5,
      e1RM: 262,
      isPR: true,
    },
    highlights: [],
    weekVolume: [0, 0, 0, 0, 0, 0, 0],
    priorWeekVolume: 0,
    streak: 2,
    progress: null,
    unitLabel: 'lbs',
    ...overrides,
  }
}

function mountView(summary: SessionSummary): VueWrapper {
  return mount(WorkoutCompleteView, {
    props: { summary },
    global: {
      // The share picker is an async child that pulls in the whole share-card
      // subsystem — stub it so these tests stay focused on the summary surface.
      stubs: {
        SharePickerSheet: { name: 'SharePickerSheet', template: '<div class="stub-picker" />' },
      },
    },
  })
}

describe('WorkoutCompleteView', () => {
  beforeEach(() => {
    // useModal toggles html.modal-open; reset so a prior test can't leak it.
    document.documentElement.classList.remove('modal-open')
  })

  describe('accessibility scaffolding', () => {
    it('renders a labelled modal dialog', () => {
      const wrapper = mountView(makeSummary())
      const overlay = wrapper.find('.wcOverlay')
      expect(overlay.attributes('role')).toBe('dialog')
      expect(overlay.attributes('aria-modal')).toBe('true')
      expect(overlay.attributes('aria-labelledby')).toBe('wcTitle')
      expect(wrapper.find('#wcTitle').text()).toBe('Workout complete')
    })
  })

  describe('session with sets', () => {
    it('renders the total-volume hero with a grouped number', () => {
      const wrapper = mountView(makeSummary())
      expect(wrapper.find('.wcHeroNumber').text()).toBe('12,500')
      expect(wrapper.find('.wcHeroUnit').text()).toBe('lbs moved')
    })

    it('renders time / sets / PR stats', () => {
      const wrapper = mountView(makeSummary())
      const vals = wrapper.findAll('.wcStatVal').map((n) => n.text())
      expect(vals).toEqual(['1h 12m', '8', '2'])
    })

    it('sums weight PRs and rep PRs into the PR stat', () => {
      const wrapper = mountView(makeSummary({ prs: 3, repPRs: 2 }))
      const prStat = wrapper.find('.wcStatAccent .wcStatVal')
      expect(prStat.text()).toBe('5')
    })

    it('renders the best set with a NEW PR badge when it is a PR', () => {
      const wrapper = mountView(makeSummary())
      expect(wrapper.find('.wcBestSetName').text()).toBe('Bench Press')
      expect(wrapper.find('.wcBestSetWeight').text()).toBe('225 × 5')
      expect(wrapper.find('.wcBestSetE1RM').text()).toBe('~262 lbs e1RM')
      expect(wrapper.find('.wcBestSetBadge').exists()).toBe(true)
    })

    it('omits the NEW PR badge when the best set is not a PR', () => {
      const summary = makeSummary()
      summary.bestSet!.isPR = false
      const wrapper = mountView(summary)
      expect(wrapper.find('.wcBestSet').exists()).toBe(true)
      expect(wrapper.find('.wcBestSetBadge').exists()).toBe(false)
    })

    it('omits the best-set section when there is no best set', () => {
      const wrapper = mountView(makeSummary({ bestSet: null }))
      expect(wrapper.find('.wcBestSet').exists()).toBe(false)
    })

    it('shows the share affordance', () => {
      const wrapper = mountView(makeSummary())
      expect(wrapper.find('.wcShare').exists()).toBe(true)
    })
  })

  describe('empty session', () => {
    it('shows the empty state instead of the hero when no sets were logged', () => {
      const wrapper = mountView(makeSummary({ setsCompleted: 0, bestSet: null }))
      expect(wrapper.find('.wcEmpty').exists()).toBe(true)
      expect(wrapper.find('.wcHero').exists()).toBe(false)
      expect(wrapper.find('.wcEmptyTitle').text()).toContain('No sets logged')
    })

    it('hides the share button when there are no sets', () => {
      const wrapper = mountView(makeSummary({ setsCompleted: 0, bestSet: null }))
      expect(wrapper.find('.wcShare').exists()).toBe(false)
      expect(wrapper.find('.wcDone').exists()).toBe(true)
    })
  })

  describe('dismissal', () => {
    it('emits close when Done is pressed', async () => {
      const wrapper = mountView(makeSummary())
      await wrapper.find('.wcDone').trigger('click')
      expect(wrapper.emitted('close')).toHaveLength(1)
    })

    it('emits close when the Close link is pressed', async () => {
      const wrapper = mountView(makeSummary())
      await wrapper.find('.wcLink').trigger('click')
      expect(wrapper.emitted('close')).toHaveLength(1)
    })

    it('emits close when the backdrop itself is tapped', async () => {
      const wrapper = mountView(makeSummary())
      await wrapper.find('.wcOverlay').trigger('click')
      expect(wrapper.emitted('close')).toHaveLength(1)
    })

    it('emits close on Escape', async () => {
      const wrapper = mountView(makeSummary())
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await wrapper.vm.$nextTick()
      expect(wrapper.emitted('close')).toHaveLength(1)
    })
  })

  describe('share picker layering', () => {
    it('opens the share picker from the share button', async () => {
      const wrapper = mountView(makeSummary())
      expect(wrapper.find('.stub-picker').exists()).toBe(false)
      await wrapper.find('.wcShare').trigger('click')
      expect(wrapper.find('.stub-picker').exists()).toBe(true)
    })

    it('Escape closes the picker first without closing the whole summary', async () => {
      const wrapper = mountView(makeSummary())
      await wrapper.find('.wcShare').trigger('click')
      expect(wrapper.find('.stub-picker').exists()).toBe(true)

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await wrapper.vm.$nextTick()

      // First Escape consumed by the picker layer — summary stays open.
      expect(wrapper.find('.stub-picker').exists()).toBe(false)
      expect(wrapper.emitted('close')).toBeUndefined()

      // Second Escape now closes the summary.
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await wrapper.vm.$nextTick()
      expect(wrapper.emitted('close')).toHaveLength(1)
    })
  })
})
