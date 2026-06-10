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
