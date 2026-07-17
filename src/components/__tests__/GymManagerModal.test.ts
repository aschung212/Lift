/**
 * #961 — GymManagerModal: gym CRUD + bulk per-gym exercise assignment.
 * A TagManagerModal clone; these tests pin its emit contract, the explicit-
 * member counts, the MAX_GYMS cap on creation, and the unassigned-hint copy.
 */
import { describe, it, expect } from 'vitest'
import { mount, VueWrapper } from '@vue/test-utils'
import type { Exercise } from '../../stores/workout'
import { MAX_GYMS } from '../../lib/gyms'
import GymManagerModal from '../GymManagerModal.vue'

function makeExercise(id: string, name: string, gyms?: string[]): Exercise {
  return { id, name, tags: [], sets: [], ...(gyms ? { gyms } : {}) }
}

function mountManager(props: { gyms?: string[]; exercises?: Exercise[] } = {}): VueWrapper {
  return mount(GymManagerModal, {
    props: {
      open: true,
      gyms: props.gyms ?? [],
      exercises: props.exercises ?? [],
    },
    global: { stubs: { Teleport: true } },
  })
}

describe('GymManagerModal', () => {
  it('shows the empty state and the unassigned hint', () => {
    const wrapper = mountManager()
    expect(wrapper.find('.wtEmpty').text()).toContain('No gyms yet')
    expect(wrapper.find('.iosSettingsFooter').text()).toContain('Exercises with no gym assigned show at every gym.')
  })

  it('lists gyms with explicit-member counts (unassigned is not counted)', () => {
    const wrapper = mountManager({
      gyms: ['Gym A', 'Gym B'],
      exercises: [
        makeExercise('e1', 'Hack Squat', ['Gym A']),
        makeExercise('e2', 'Cable Row', ['Gym A', 'Gym B']),
        makeExercise('e3', 'Bench Press'), // unassigned — shows everywhere but counts nowhere
      ],
    })
    const items = wrapper.findAll('.wtTagManagerItem')
    expect(items).toHaveLength(2)
    expect(items[0].find('.wtTagManagerLabel').text()).toBe('Gym A')
    expect(items[0].find('.wtTagManagerCount').text()).toBe('2')
    expect(items[1].find('.wtTagManagerCount').text()).toBe('1')
  })

  it('creates a gym through the add flow and expands it for bulk assignment', async () => {
    const wrapper = mountManager({ gyms: ['Gym A'] })
    await wrapper.find('.repMaxBtnCalc').trigger('click') // + New Gym
    const input = wrapper.find('[aria-label="New gym name"]')
    await input.setValue('Gym B')
    await wrapper.find('[aria-label="Create gym"]').trigger('click')

    expect(wrapper.emitted('create-gym')).toEqual([['Gym B']])
  })

  it('does not emit create-gym for a duplicate name', async () => {
    const wrapper = mountManager({ gyms: ['Gym A'] })
    await wrapper.find('.repMaxBtnCalc').trigger('click')
    await wrapper.find('[aria-label="New gym name"]').setValue('Gym A')
    await wrapper.find('[aria-label="Create gym"]').trigger('click')

    expect(wrapper.emitted('create-gym')).toBeUndefined()
  })

  it('disables "+ New Gym" at the MAX_GYMS cap', () => {
    const gyms = Array.from({ length: MAX_GYMS }, (_, i) => `Gym ${i}`)
    const wrapper = mountManager({ gyms })
    expect(wrapper.find('.repMaxBtnCalc').attributes('disabled')).toBeDefined()
  })

  it('renames a gym through the inline rename flow', async () => {
    const wrapper = mountManager({ gyms: ['Gym A'] })
    await wrapper.find('[aria-label="Rename gym"]').trigger('click')
    const input = wrapper.find('input[aria-label="Rename gym"]')
    await input.setValue('Iron Temple')
    await wrapper.find('[aria-label="Save gym name"]').trigger('click')

    expect(wrapper.emitted('rename-gym')).toEqual([['Gym A', 'Iron Temple']])
  })

  it('emits delete-gym from the row delete button', async () => {
    const wrapper = mountManager({ gyms: ['Gym A'] })
    await wrapper.find('[aria-label="Delete gym"]').trigger('click')
    expect(wrapper.emitted('delete-gym')).toEqual([['Gym A']])
  })

  it('expands a gym into the exercise checklist and toggles membership', async () => {
    const exercises = [
      makeExercise('e1', 'Hack Squat', ['Gym A']),
      makeExercise('e2', 'Bench Press'),
    ]
    const wrapper = mountManager({ gyms: ['Gym A'], exercises })
    await wrapper.find('[aria-label="Show exercises for Gym A"]').trigger('click')

    const rows = wrapper.findAll('.wtTagExerciseRow')
    expect(rows).toHaveLength(2)
    // Member row shows the checkmark; unassigned row doesn't.
    expect(rows[0].find('.wtTagExerciseCheck').exists()).toBe(true)
    expect(rows[1].find('.wtTagExerciseCheck').exists()).toBe(false)

    await rows[1].trigger('click')
    expect(wrapper.emitted('toggle-exercise-gym')).toEqual([['e2', 'Gym A']])
  })
})
