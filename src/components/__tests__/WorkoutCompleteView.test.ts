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

    it('drops the TIME tile when the session span is unknowable', () => {
      // Regression: every set logged through the UI carries an end-of-day
      // `date` with no real time on it, so sessionSummary reports an em dash
      // and the TIME tile rendered permanently empty — a stat that looked
      // broken on the one screen meant to celebrate the session. The tile is
      // dropped instead and the row redistributes; it comes back on its own
      // once sets carry real timestamps.
      const wrapper = mountView(makeSummary({ duration: '\u2014' }))
      const stats = wrapper.findAll('.wcStat')
      expect(stats).toHaveLength(2)
      expect(wrapper.findAll('.wcStatKey').map((n) => n.text())).toEqual(['SETS', 'PRs'])
      expect(wrapper.text()).not.toContain('TIME')
    })

    it('keeps the TIME tile when the session span is known', () => {
      const wrapper = mountView(makeSummary())
      expect(wrapper.findAll('.wcStat')).toHaveLength(3)
    })

    it('shows the share affordance', () => {
      const wrapper = mountView(makeSummary())
      expect(wrapper.find('.wcShare').exists()).toBe(true)
    })
  })

  describe('per-exercise breakdown', () => {
    // Regression (share-card spacing report): `summary.highlights` was computed
    // for every session and rendered on the receipt share card, but the summary
    // screen dropped it — leaving a screen-height of blank between the best-set
    // card and the buttons on a normal phone. happy-dom has no layout engine so
    // the emptiness itself isn't assertable; what IS assertable is that the data
    // the screen was missing now reaches the DOM.
    const HIGHLIGHTS = [
      { exerciseId: 'ex-1', name: 'Bench Press', weight: 225, reps: 5, e1RM: 262, badge: 'PR' as const, volume: 7825.4 },
      { exerciseId: 'ex-2', name: 'Cable Fly', weight: 60, reps: 15, e1RM: 90, badge: '' as const, volume: 3360 },
      { exerciseId: 'ex-3', name: 'Overhead Press', weight: 135, reps: 8, e1RM: 171, badge: 'rep PR' as const, volume: 3105 },
    ]

    it('lists every exercise with its top set and volume', () => {
      const wrapper = mountView(makeSummary({ highlights: HIGHLIGHTS }))
      const rows = wrapper.findAll('.wcBreakdownRow')
      expect(rows).toHaveLength(3)
      expect(wrapper.findAll('.wcBreakdownName').map((n) => n.text()))
        .toEqual(['Bench Press', 'Cable Fly', 'Overhead Press'])
      expect(wrapper.findAll('.wcBreakdownTop').map((n) => n.text()))
        .toEqual(['225 × 5', '60 × 15', '135 × 8'])
      // Volume is rounded and grouped, and carries the summary's unit label.
      expect(wrapper.findAll('.wcBreakdownVolume').map((n) => n.text()))
        .toEqual(['7,825 lbs', '3,360 lbs', '3,105 lbs'])
    })

    it('badges only the exercises that set a PR', () => {
      const wrapper = mountView(makeSummary({ highlights: HIGHLIGHTS }))
      expect(wrapper.findAll('.wcBreakdownBadge').map((n) => n.text())).toEqual(['PR', 'REP PR'])
    })

    it('labels the section with the exercise count', () => {
      const wrapper = mountView(makeSummary({ highlights: HIGHLIGHTS }))
      expect(wrapper.find('.wcBreakdownLabel').text()).toBe('3 exercises')
    })

    it('hides the breakdown on a single-exercise session', () => {
      // The best-set card already IS the whole session there; a one-row list
      // under it just restates the same name and numbers.
      const wrapper = mountView(makeSummary({ highlights: [HIGHLIGHTS[0]] }))
      expect(wrapper.find('.wcBreakdown').exists()).toBe(false)
      expect(wrapper.find('.wcBestSet').exists()).toBe(true)
    })

    it('hides the breakdown when there are no highlights', () => {
      const wrapper = mountView(makeSummary({ highlights: [] }))
      expect(wrapper.find('.wcBreakdown').exists()).toBe(false)
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
