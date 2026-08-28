/**
 * #1252 — ExerciseManagerModal: the exercise-first inverse of GymManagerModal.
 *
 * These tests pin the pieces that make the surface useful for *auditing*
 * membership rather than editing one exercise at a time: the collapsed gym
 * summary line (including its "All gyms" default and orphan handling), the
 * lookup-oriented ordering, and the two toggle emit contracts.
 */
import { describe, it, expect } from 'vitest'
import { mount, VueWrapper } from '@vue/test-utils'
import type { Exercise } from '../../stores/workout'
import ExerciseManagerModal from '../ExerciseManagerModal.vue'

function makeExercise(
  id: string,
  name: string,
  extra: Partial<Exercise> = {},
): Exercise {
  return { id, name, tags: [], sets: [], ...extra }
}

function mountManager(props: {
  exercises?: Exercise[]
  gyms?: string[]
  allTags?: string[]
} = {}): VueWrapper {
  return mount(ExerciseManagerModal, {
    props: {
      open: true,
      exercises: props.exercises ?? [],
      gyms: props.gyms ?? [],
      allTags: props.allTags ?? [],
    },
    global: { stubs: { Teleport: true } },
  })
}

/** Expand a row by its accessible expand-button label. */
async function expand(wrapper: VueWrapper, name: string) {
  await wrapper.find(`[aria-label="Edit gyms and tags for ${name}"]`).trigger('click')
}

describe('ExerciseManagerModal', () => {
  it('shows the empty state and the unassigned hint', () => {
    const wrapper = mountManager()
    expect(wrapper.find('.wtEmpty').text()).toContain('No exercises yet')
    expect(wrapper.find('.iosSettingsFooter').text())
      .toContain('Exercises with no gym assigned show at every gym.')
  })

  describe('collapsed row summary', () => {
    it('names the gyms an exercise belongs to', () => {
      const wrapper = mountManager({
        gyms: ['Gym A', 'Gym B'],
        exercises: [makeExercise('e1', 'Hack Squat', { gyms: ['Gym A', 'Gym B'] })],
      })
      expect(wrapper.find('.wtExManagerSummary').text()).toBe('Gym A · Gym B')
    })

    it('reads "All gyms" for an unassigned exercise', () => {
      const wrapper = mountManager({
        gyms: ['Gym A'],
        exercises: [makeExercise('e1', 'Bench Press')],
      })
      expect(wrapper.find('.wtExManagerSummary').text()).toBe('All gyms')
    })

    it('ignores membership in gyms that are no longer in the list', () => {
      // Orphan safety net, matching matchesGymFilter: a gym renamed or deleted
      // on another device must not be named at a user who can't see it, and the
      // exercise degrades to visible-everywhere.
      const wrapper = mountManager({
        gyms: ['Gym A'],
        exercises: [makeExercise('e1', 'Cable Row', { gyms: ['Deleted Gym'] })],
      })
      expect(wrapper.find('.wtExManagerSummary').text()).toBe('All gyms')
    })

    it('flags archived exercises in the summary', () => {
      const wrapper = mountManager({
        gyms: ['Gym A'],
        exercises: [makeExercise('e1', 'Pec Deck', {
          gyms: ['Gym A'],
          archived_at: '2026-01-01T00:00:00Z',
        })],
      })
      expect(wrapper.find('.wtExManagerSummary').text()).toBe('Archived · Gym A')
    })
  })

  describe('ordering', () => {
    it('sorts alphabetically and sinks archived exercises to the bottom', () => {
      const wrapper = mountManager({
        exercises: [
          makeExercise('e1', 'Squat'),
          makeExercise('e2', 'Pec Deck', { archived_at: '2026-01-01T00:00:00Z' }),
          makeExercise('e3', 'Bench Press'),
        ],
      })
      const names = wrapper.findAll('.wtExManagerName').map(n => n.text())
      expect(names).toEqual(['Bench Press', 'Squat', 'Pec Deck'])
    })
  })

  describe('search', () => {
    const many = Array.from({ length: 8 }, (_, i) => makeExercise(`e${i}`, `Exercise ${i}`))

    it('is hidden below the search threshold', () => {
      const wrapper = mountManager({ exercises: many.slice(0, 7) })
      expect(wrapper.find('.wtSearchInput').exists()).toBe(false)
    })

    it('filters rows by name once shown', async () => {
      const wrapper = mountManager({ exercises: many })
      expect(wrapper.find('.wtSearchInput').exists()).toBe(true)
      await wrapper.find('.wtSearchInput').setValue('exercise 3')
      const names = wrapper.findAll('.wtExManagerName').map(n => n.text())
      expect(names).toEqual(['Exercise 3'])
    })

    it('shows a no-match message rather than an empty list', async () => {
      const wrapper = mountManager({ exercises: many })
      await wrapper.find('.wtSearchInput').setValue('deadlift')
      expect(wrapper.find('.wtEmpty').text()).toContain('No exercises match')
    })
  })

  describe('expanded membership pickers', () => {
    const exercises = [makeExercise('e1', 'Hack Squat', { gyms: ['Gym A'], tags: ['Legs'] })]
    const gyms = ['Gym A', 'Gym B']
    const allTags = ['Legs', 'Glutes']

    it('renders one chip per gym and per tag, pressed for current membership', async () => {
      const wrapper = mountManager({ exercises, gyms, allTags })
      expect(wrapper.find('.wtExManagerDetail').exists()).toBe(false)
      await expand(wrapper, 'Hack Squat')

      const gymChips = wrapper.findAll('[aria-label="Gyms for Hack Squat"] .wtTagPickerChip')
      expect(gymChips.map(c => c.text())).toEqual(['Gym A', 'Gym B'])
      expect(gymChips.map(c => c.attributes('aria-pressed'))).toEqual(['true', 'false'])

      const tagChips = wrapper.findAll('[aria-label="Tags for Hack Squat"] .wtTagPickerChip')
      expect(tagChips.map(c => c.text())).toEqual(['Legs', 'Glutes'])
      expect(tagChips.map(c => c.attributes('aria-pressed'))).toEqual(['true', 'false'])
    })

    it('emits toggle-exercise-gym for the tapped gym chip', async () => {
      const wrapper = mountManager({ exercises, gyms, allTags })
      await expand(wrapper, 'Hack Squat')
      await wrapper.findAll('[aria-label="Gyms for Hack Squat"] .wtTagPickerChip')[1].trigger('click')
      expect(wrapper.emitted('toggle-exercise-gym')).toEqual([['e1', 'Gym B']])
    })

    it('emits toggle-exercise-tag for the tapped tag chip', async () => {
      const wrapper = mountManager({ exercises, gyms, allTags })
      await expand(wrapper, 'Hack Squat')
      await wrapper.findAll('[aria-label="Tags for Hack Squat"] .wtTagPickerChip')[1].trigger('click')
      expect(wrapper.emitted('toggle-exercise-tag')).toEqual([['e1', 'Glutes']])
    })

    it('collapses the open row when another is expanded', async () => {
      const wrapper = mountManager({
        exercises: [makeExercise('e1', 'Hack Squat'), makeExercise('e2', 'Bench Press')],
        gyms,
      })
      await expand(wrapper, 'Hack Squat')
      expect(wrapper.findAll('.wtExManagerDetail')).toHaveLength(1)
      await expand(wrapper, 'Bench Press')
      const details = wrapper.findAll('.wtExManagerDetail')
      expect(details).toHaveLength(1)
      expect(details[0].find('[role="group"]').attributes('aria-label')).toBe('Gyms for Bench Press')
    })

    it('points at the dedicated managers when there is nothing to assign', async () => {
      const wrapper = mountManager({ exercises: [makeExercise('e1', 'Hack Squat')] })
      await expand(wrapper, 'Hack Squat')
      const hints = wrapper.findAll('.wtExManagerSectionEmpty').map(h => h.text())
      expect(hints[0]).toContain('Settings › Gyms')
      expect(hints[1]).toContain('Tags row')
    })
  })

  it('does not offer exercise create/rename/delete — membership only (#1252 scope)', () => {
    const wrapper = mountManager({ exercises: [makeExercise('e1', 'Hack Squat')] })
    // Those actions stay owned by EditExerciseModal; a second path to a
    // destructive control would violate the one-interaction-path rule.
    expect(wrapper.find('.wtTagManagerDeleteBtn').exists()).toBe(false)
    expect(wrapper.find('.wtTagManagerEditBtn').exists()).toBe(false)
    expect(wrapper.find('.repMaxBtnCalc').exists()).toBe(false)
  })

  it('resets search and expansion when reopened', async () => {
    const wrapper = mountManager({
      exercises: Array.from({ length: 8 }, (_, i) => makeExercise(`e${i}`, `Exercise ${i}`)),
    })
    await wrapper.find('.wtSearchInput').setValue('exercise 3')
    await expand(wrapper, 'Exercise 3')
    expect(wrapper.find('.wtExManagerDetail').exists()).toBe(true)

    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })

    expect((wrapper.find('.wtSearchInput').element as HTMLInputElement).value).toBe('')
    expect(wrapper.find('.wtExManagerDetail').exists()).toBe(false)
    expect(wrapper.findAll('.wtExManagerName')).toHaveLength(8)
  })
})
