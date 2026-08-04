import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ExerciseGraph from '../ExerciseGraph.vue'
import type { Exercise, WorkoutSet } from '../../stores/workout'

vi.mock('../../composables/useWeightUnit', () => ({
  useWeightUnit: () => ({
    weightUnit: { value: 'lbs' },
    displayWeight: (w: number) => Math.round(w),
    toLbs: (w: number) => w,
  })
}))

vi.mock('../../composables/usePRBaseline', () => ({
  usePRBaseline: () => ({
    prBaselineDate: { value: null },
  })
}))

function makeExercise(sets: WorkoutSet[]): Exercise {
  return { id: 'ex-1', name: 'Bench Press', tags: [], sets }
}

function makeSet(weight: number, reps: number, date: string): WorkoutSet {
  const estimated1RM = weight * (1 + reps / 30)
  return { id: `s-${date}`, weight, reps, date: `${date}T10:00:00`, estimated1RM }
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
}

describe('ExerciseGraph', () => {
  describe('with fewer than 2 days of data', () => {
    it('shows nothing when exercise has no sets', () => {
      const wrapper = mount(ExerciseGraph, {
        props: { exercise: makeExercise([]) }
      })
      expect(wrapper.find('svg').exists()).toBe(false)
      expect(wrapper.find('.wtGraphSingle').exists()).toBe(false)
    })

    it('shows prompt message with only 1 day of sets', () => {
      const exercise = makeExercise([
        makeSet(135, 8, '2026-01-15'),
        makeSet(135, 6, '2026-01-15'),
      ])
      const wrapper = mount(ExerciseGraph, {
        props: { exercise }
      })
      expect(wrapper.find('svg').exists()).toBe(false)
      expect(wrapper.find('.wtGraphSingle').text()).toContain('at least 2 different days')
    })
  })

  describe('with sufficient data', () => {
    const exercise = makeExercise([
      makeSet(135, 8, '2026-01-01'),
      makeSet(155, 6, '2026-01-15'),
      makeSet(175, 4, '2026-02-01'),
    ])

    it('renders SVG chart', () => {
      const wrapper = mount(ExerciseGraph, {
        props: { exercise }
      })
      expect(wrapper.find('svg').exists()).toBe(true)
      expect(wrapper.find('.wtGraphWrap').exists()).toBe(true)
    })

    it('renders title for sets mode', () => {
      const wrapper = mount(ExerciseGraph, {
        props: { exercise, mode: 'sets' }
      })
      expect(wrapper.find('.wtGraphTitle').text()).toBe('Estimated 1RM Progress')
    })

    it('renders title for prs mode', () => {
      const wrapper = mount(ExerciseGraph, {
        props: { exercise, mode: 'prs' }
      })
      expect(wrapper.find('.wtGraphTitle').text()).toBe('PR Progression')
    })

    it('renders a circle dot for each data point', () => {
      const wrapper = mount(ExerciseGraph, {
        props: { exercise }
      })
      const dots = wrapper.findAll('circle')
      expect(dots.length).toBe(3)
    })

    it('renders polyline for the progress line', () => {
      const wrapper = mount(ExerciseGraph, {
        props: { exercise }
      })
      const polyline = wrapper.find('.wtGLine')
      expect(polyline.exists()).toBe(true)
      expect(polyline.attributes('points')).toBeTruthy()
    })

    it('renders area fill polygon', () => {
      const wrapper = mount(ExerciseGraph, {
        props: { exercise }
      })
      const area = wrapper.find('.wtGArea')
      expect(area.exists()).toBe(true)
      expect(area.attributes('points')).toBeTruthy()
    })

    it('renders 3 horizontal grid lines', () => {
      const wrapper = mount(ExerciseGraph, {
        props: { exercise }
      })
      const gridLines = wrapper.findAll('.wtGGrid')
      expect(gridLines.length).toBe(3)
    })

    it('displays Y-axis labels with weight unit', () => {
      const wrapper = mount(ExerciseGraph, {
        props: { exercise }
      })
      const yLabels = wrapper.findAll('.wtGYLabel')
      // max, midpoint, min — all distinct for this data
      expect(yLabels.length).toBe(3)
      for (const label of yLabels) {
        expect(label.text()).toContain('lbs')
      }
    })

    it('renders a midpoint Y-axis label between min and max', () => {
      const wrapper = mount(ExerciseGraph, {
        props: { exercise }
      })
      const yLabels = wrapper.findAll('.wtGYLabel')
      const values = yLabels.map(l => parseInt(l.text(), 10))
      const mid = wrapper.find('.wtGYLabelMid')
      expect(mid.exists()).toBe(true)
      const midValue = parseInt(mid.text(), 10)
      const max = Math.max(...values)
      const min = Math.min(...values)
      expect(midValue).toBeLessThan(max)
      expect(midValue).toBeGreaterThan(min)
    })

    it('omits the midpoint label when it collides with an endpoint', () => {
      // Flat progression: min == mid == max, so the mid label is redundant
      const flat = makeExercise([
        makeSet(100, 5, '2026-01-01'),
        makeSet(100, 5, '2026-02-01'),
      ])
      const wrapper = mount(ExerciseGraph, {
        props: { exercise: flat }
      })
      expect(wrapper.find('.wtGYLabelMid').exists()).toBe(false)
      expect(wrapper.findAll('.wtGYLabel').length).toBe(2)
    })

    it('has accessible aria-label on SVG', () => {
      const wrapper = mount(ExerciseGraph, {
        props: { exercise }
      })
      expect(wrapper.find('svg').attributes('aria-label')).toContain('estimated 1RM progress')
      expect(wrapper.find('svg').attributes('role')).toBe('img')
    })

    it('marks the highest e1RM dot as PR', () => {
      const wrapper = mount(ExerciseGraph, {
        props: { exercise }
      })
      const prDots = wrapper.findAll('.wtGDotPR')
      expect(prDots.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('PR-only mode filtering', () => {
    it('only shows points that are new all-time highs', () => {
      // Day 1: 135x8 (e1RM ~171), Day 2: 125x10 (e1RM ~167, NOT a PR), Day 3: 155x6 (e1RM ~186, PR)
      const exercise = makeExercise([
        makeSet(135, 8, '2026-01-01'),
        makeSet(125, 10, '2026-01-10'),
        makeSet(155, 6, '2026-01-20'),
      ])
      const wrapper = mount(ExerciseGraph, {
        props: { exercise, mode: 'prs' }
      })
      // In PR mode, the middle point (not a PR) should be filtered out → 2 dots
      const dots = wrapper.findAll('circle')
      expect(dots.length).toBe(2)
    })
  })

  describe('touch-scrub readout', () => {
    const exercise = makeExercise([
      makeSet(135, 8, '2026-01-01'),
      makeSet(155, 6, '2026-01-15'),
      makeSet(175, 4, '2026-02-01'),
    ])

    it('shows no readout until the user scrubs', () => {
      const wrapper = mount(ExerciseGraph, { props: { exercise } })
      expect(wrapper.find('.wtGScrub').exists()).toBe(false)
    })

    it('reveals a crosshair and value bubble on pointer down, and clears on release', async () => {
      const wrapper = mount(ExerciseGraph, { props: { exercise } })
      const svg = wrapper.find('svg')
      // happy-dom has no layout; map client px 1:1 onto the 320-wide viewBox.
      ;(svg.element as unknown as SVGSVGElement).getBoundingClientRect = () =>
        ({ left: 0, width: 320, top: 0, right: 320, bottom: 0, height: 0, x: 0, y: 0 }) as DOMRect
      ;(svg.element as unknown as SVGSVGElement).setPointerCapture = () => {}

      await svg.trigger('pointerdown', { clientX: 56, pointerId: 1 })
      expect(wrapper.find('.wtGScrub').exists()).toBe(true)
      expect(wrapper.find('.wtGScrubLine').exists()).toBe(true)
      expect(wrapper.find('.wtGReadoutText').text()).toContain('lbs')

      await svg.trigger('pointerup', { pointerId: 1 })
      expect(wrapper.find('.wtGScrub').exists()).toBe(false)
    })
  })

  describe('time-range selector', () => {
    const recentExercise = makeExercise([
      makeSet(135, 8, daysAgo(200)),
      makeSet(155, 6, daysAgo(60)),
      makeSet(175, 4, daysAgo(10)),
    ])

    it('renders 1M/3M/1Y/All range buttons', () => {
      const wrapper = mount(ExerciseGraph, { props: { exercise: recentExercise } })
      const btns = wrapper.findAll('.exGraphPeriodRow .bwPeriodBtn')
      expect(btns.map(b => b.text())).toEqual(['1M', '3M', '1Y', 'All'])
    })

    it('defaults to All (full history) with all points visible', () => {
      const wrapper = mount(ExerciseGraph, { props: { exercise: recentExercise } })
      const active = wrapper.find('.exGraphPeriodRow .bwPeriodBtn.active')
      expect(active.text()).toBe('All')
      expect(wrapper.findAll('circle').length).toBe(3)
    })

    it('filters points to the selected window on click', async () => {
      const wrapper = mount(ExerciseGraph, { props: { exercise: recentExercise } })
      // 3M window excludes the 200-days-ago point → 2 points remain
      await wrapper.findAll('.exGraphPeriodRow .bwPeriodBtn')[1].trigger('click')
      expect(wrapper.find('.exGraphPeriodRow .bwPeriodBtn.active').text()).toBe('3M')
      expect(wrapper.findAll('circle').length).toBe(2)
    })

    it('shows an empty-range message when the window has fewer than 2 points', async () => {
      const wrapper = mount(ExerciseGraph, { props: { exercise: recentExercise } })
      // 1M window includes only the 10-days-ago point → not enough to plot
      await wrapper.findAll('.exGraphPeriodRow .bwPeriodBtn')[0].trigger('click')
      expect(wrapper.find('svg').exists()).toBe(false)
      expect(wrapper.find('.exGraphRangeEmpty').exists()).toBe(true)
      // selector stays visible so the user can widen the range
      expect(wrapper.find('.exGraphPeriodRow').exists()).toBe(true)
    })

    it('does not show a PR badge when the all-time PR is outside the window', async () => {
      // All-time best (200 days ago) sits outside the 3M window; the windowed
      // max must not be mislabeled as a PR.
      const exercise = makeExercise([
        makeSet(225, 5, daysAgo(200)), // all-time best e1RM
        makeSet(135, 8, daysAgo(60)),
        makeSet(155, 6, daysAgo(10)),
      ])
      const wrapper = mount(ExerciseGraph, { props: { exercise } })
      // All view: PR dot present (best session in view)
      expect(wrapper.findAll('.wtGDotPR').length).toBe(1)
      // 3M view: best session excluded → no PR badge
      await wrapper.findAll('.exGraphPeriodRow .bwPeriodBtn')[1].trigger('click')
      expect(wrapper.findAll('.wtGDotPR').length).toBe(0)
    })

    it('keeps range buttons accessible with aria-pressed state', () => {
      const wrapper = mount(ExerciseGraph, { props: { exercise: recentExercise } })
      const allBtn = wrapper.findAll('.exGraphPeriodRow .bwPeriodBtn')[3]
      expect(allBtn.attributes('aria-pressed')).toBe('true')
      expect(allBtn.attributes('aria-label')).toBe('Show all time')
    })
  })

  describe('metric selector', () => {
    // 135x8 (vol 1080, e1RM ~171), 155x6 (vol 930, e1RM ~186), 175x4 (vol 700, e1RM ~198)
    const exercise = makeExercise([
      makeSet(135, 8, '2026-01-01'),
      makeSet(155, 6, '2026-01-15'),
      makeSet(175, 4, '2026-02-01'),
    ])

    it('renders e1RM/Weight/Volume/Reps metric buttons', () => {
      const wrapper = mount(ExerciseGraph, { props: { exercise } })
      const btns = wrapper.findAll('.exGraphMetricRow .bwPeriodBtn')
      expect(btns.map(b => b.text())).toEqual(['e1RM', 'Weight', 'Volume', 'Reps'])
    })

    it('defaults to e1RM with its title and axis unit', () => {
      const wrapper = mount(ExerciseGraph, { props: { exercise } })
      const active = wrapper.find('.exGraphMetricRow .bwPeriodBtn.active')
      expect(active.text()).toBe('e1RM')
      expect(wrapper.find('.wtGraphTitle').text()).toBe('Estimated 1RM Progress')
      expect(wrapper.findAll('.wtGYLabel')[0].text()).toContain('lbs')
    })

    it('reprojects onto total volume (summing the day) on Volume tap', async () => {
      const wrapper = mount(ExerciseGraph, { props: { exercise } })
      await wrapper.findAll('.exGraphMetricRow .bwPeriodBtn')[2].trigger('click')
      expect(wrapper.find('.wtGraphTitle').text()).toBe('Total Volume')
      // Max day volume is 135×8 = 1080 (top axis label)
      expect(wrapper.findAll('.wtGYLabel')[0].text()).toContain('1080')
    })

    it('reprojects onto max weight on Weight tap', async () => {
      const wrapper = mount(ExerciseGraph, { props: { exercise } })
      await wrapper.findAll('.exGraphMetricRow .bwPeriodBtn')[1].trigger('click')
      expect(wrapper.find('.wtGraphTitle').text()).toBe('Max Weight')
      expect(wrapper.findAll('.wtGYLabel')[0].text()).toContain('175')
    })

    it('reprojects onto total reps with a reps unit (not weight) on Reps tap', async () => {
      const wrapper = mount(ExerciseGraph, { props: { exercise } })
      await wrapper.findAll('.exGraphMetricRow .bwPeriodBtn')[3].trigger('click')
      expect(wrapper.find('.wtGraphTitle').text()).toBe('Total Reps')
      const yLabels = wrapper.findAll('.wtGYLabel')
      expect(yLabels[0].text()).toContain('reps')
      expect(yLabels[0].text()).not.toContain('lbs')
      // Max day reps is 8 (first session)
      expect(yLabels[0].text()).toContain('8')
    })

    it('sums same-day sets for volume/reps but keeps distinct daily points', async () => {
      const twoSetDay = makeExercise([
        makeSet(100, 10, '2026-01-01'), // vol 1000, reps 10
        makeSet(50, 10, '2026-01-01'),  // vol 500, reps 10 → day totals: vol 1500, reps 20
        makeSet(100, 5, '2026-02-01'),  // vol 500, reps 5
      ])
      const wrapper = mount(ExerciseGraph, { props: { exercise: twoSetDay } })
      await wrapper.findAll('.exGraphMetricRow .bwPeriodBtn')[2].trigger('click')
      // Two unique days → 2 dots; top volume is the summed 1500
      expect(wrapper.findAll('circle').length).toBe(2)
      expect(wrapper.findAll('.wtGYLabel')[0].text()).toContain('1500')
    })

    it('updates the SVG aria-label to describe the active metric', async () => {
      const wrapper = mount(ExerciseGraph, { props: { exercise } })
      await wrapper.findAll('.exGraphMetricRow .bwPeriodBtn')[3].trigger('click')
      expect(wrapper.find('svg').attributes('aria-label')).toContain('total reps')
    })

    it('exposes aria-pressed state on the active metric button', () => {
      const wrapper = mount(ExerciseGraph, { props: { exercise } })
      const btns = wrapper.findAll('.exGraphMetricRow .bwPeriodBtn')
      expect(btns[0].attributes('aria-pressed')).toBe('true')
      expect(btns[1].attributes('aria-pressed')).toBe('false')
      expect(btns[0].attributes('aria-label')).toBe('Show e1RM')
    })
  })

  describe('same-day best aggregation', () => {
    it('uses the best e1RM per day, not every set', () => {
      // Two sets on the same day — only the better one should produce a point
      const exercise = makeExercise([
        makeSet(135, 8, '2026-01-01'),
        makeSet(100, 5, '2026-01-01'),  // worse e1RM, same day
        makeSet(155, 6, '2026-02-01'),
      ])
      const wrapper = mount(ExerciseGraph, {
        props: { exercise }
      })
      // Should aggregate to 2 unique days → 2 dots
      const dots = wrapper.findAll('circle')
      expect(dots.length).toBe(2)
    })
  })
})
