import { describe, it, expect, vi } from 'vitest'
import { mount, VueWrapper } from '@vue/test-utils'
import type { Exercise } from '../../stores/workout'
import { MAX_GYMS } from '../../lib/gyms'
import { mockWeightUnit } from '../../__tests__/helpers'

vi.mock('../../composables/useWeightUnit', () => mockWeightUnit())

import EditExerciseModal from '../EditExerciseModal.vue'

function makeExercise(overrides: Partial<Exercise> = {}): Exercise {
  return { id: 'ex-1', name: 'Bench Press', tags: ['Chest'], sets: [], ...overrides }
}

/** Mount closed, then open by setting the exercise — mirrors how the parent drives it
 *  (the seed watcher is not `immediate`, so it only runs on the null → exercise change). */
async function openWith(exercise: Exercise, allGyms: string[] = []): Promise<VueWrapper> {
  const wrapper = mount(EditExerciseModal, {
    props: { exercise: null as Exercise | null, allTags: [], allGyms },
    global: { stubs: { Teleport: true } },
  })
  await wrapper.setProps({ exercise })
  await wrapper.vm.$nextTick()
  return wrapper
}

const stepperValue = (w: VueWrapper) => w.find('.iosStepperValue').text()
const lastSavePayload = (w: VueWrapper) => {
  const calls = w.emitted('save')!
  return calls[calls.length - 1][0] as { intensityMaxReps: number | null; equipment: string | null; gyms: string[] }
}

/** The equipment radio chips (inside the radiogroup, unlike the tag chips). */
const equipmentChips = (w: VueWrapper) => w.findAll('[role="radiogroup"] .wtTagPickerChip')
const equipmentChip = (w: VueWrapper, label: string | RegExp) =>
  equipmentChips(w).find((c) => (typeof label === 'string' ? c.text() === label : label.test(c.text())))!

describe('EditExerciseModal — intensity rep-rows config (#770)', () => {
  it('seeds the default (10) and hides "Reset" when the exercise has no override', async () => {
    const wrapper = await openWith(makeExercise())
    expect(stepperValue(wrapper)).toBe('10')
    expect(wrapper.find('.wtIntensityEditReset').exists()).toBe(false)
  })

  it('seeds a per-exercise override and shows "Reset"', async () => {
    const wrapper = await openWith(makeExercise({ intensityMaxReps: 15 }))
    expect(stepperValue(wrapper)).toBe('15')
    expect(wrapper.find('.wtIntensityEditReset').exists()).toBe(true)
  })

  it('emits intensityMaxReps: null when left at the default', async () => {
    const wrapper = await openWith(makeExercise())
    await wrapper.find('.repMaxBtnCalc').trigger('click')
    expect(lastSavePayload(wrapper).intensityMaxReps).toBeNull()
  })

  it('increments and emits the custom value', async () => {
    const wrapper = await openWith(makeExercise())
    await wrapper.find('[aria-label="More rep rows"]').trigger('click') // 10 → 11
    expect(stepperValue(wrapper)).toBe('11')
    await wrapper.find('.repMaxBtnCalc').trigger('click')
    expect(lastSavePayload(wrapper).intensityMaxReps).toBe(11)
  })

  it('disables the steppers at the [1, 100] bounds', async () => {
    const high = await openWith(makeExercise({ intensityMaxReps: 100 }))
    expect(high.find('[aria-label="More rep rows"]').attributes('disabled')).toBeDefined()
    const low = await openWith(makeExercise({ intensityMaxReps: 1 }))
    expect(low.find('[aria-label="Fewer rep rows"]').attributes('disabled')).toBeDefined()
  })

  it('resets back to the default and hides the reset control', async () => {
    const wrapper = await openWith(makeExercise({ intensityMaxReps: 20 }))
    expect(wrapper.find('.wtIntensityEditReset').exists()).toBe(true)
    await wrapper.find('.wtIntensityEditReset').trigger('click')
    await wrapper.vm.$nextTick()
    expect(stepperValue(wrapper)).toBe('10')
    expect(wrapper.find('.wtIntensityEditReset').exists()).toBe(false)
    await wrapper.find('.repMaxBtnCalc').trigger('click')
    expect(lastSavePayload(wrapper).intensityMaxReps).toBeNull()
  })
})

describe('EditExerciseModal — Coach equipment classification (#931 phase C)', () => {
  it('defaults to Auto and shows what the name heuristic resolves to', async () => {
    const wrapper = await openWith(makeExercise({ name: 'Bench Press' }))
    const auto = equipmentChip(wrapper, /^Auto/)
    expect(auto.attributes('aria-checked')).toBe('true')
    expect(auto.text()).toBe('Auto (free weight)')
  })

  it('shows the heuristic resolution for machine and unclassified names', async () => {
    const machine = await openWith(makeExercise({ name: 'Leg Press' }))
    expect(equipmentChip(machine, /^Auto/).text()).toBe('Auto (machine)')
    const unknown = await openWith(makeExercise({ name: 'Farmers Walk' }))
    expect(equipmentChip(unknown, /^Auto/).text()).toBe('Auto (unclassified)')
  })

  it('seeds an explicit classification from the exercise', async () => {
    const wrapper = await openWith(makeExercise({ equipment: 'machine' }))
    expect(equipmentChip(wrapper, 'Machine').attributes('aria-checked')).toBe('true')
    expect(equipmentChip(wrapper, /^Auto/).attributes('aria-checked')).toBe('false')
  })

  it('emits the selected equipment on save', async () => {
    const wrapper = await openWith(makeExercise())
    await equipmentChip(wrapper, 'Free weight').trigger('click')
    await wrapper.find('.repMaxBtnCalc').trigger('click')
    expect(lastSavePayload(wrapper).equipment).toBe('free_weight')
  })

  it('emits null when set back to Auto (clears the override)', async () => {
    const wrapper = await openWith(makeExercise({ equipment: 'machine' }))
    await equipmentChip(wrapper, /^Auto/).trigger('click')
    await wrapper.find('.repMaxBtnCalc').trigger('click')
    expect(lastSavePayload(wrapper).equipment).toBeNull()
  })
})

describe('EditExerciseModal — gym membership (#961)', () => {
  const gymSection = (w: VueWrapper) => w.find('[aria-label="Gym membership"]')
  const gymChip = (w: VueWrapper, label: string) =>
    gymSection(w).findAll('.wtTagPickerChip').find(c => c.text() === label)!

  it('renders the Gym section at zero gyms with just the add chip (first-gym path, #963)', async () => {
    const wrapper = await openWith(makeExercise())
    expect(gymSection(wrapper).exists()).toBe(true)
    // Only chip present is the inline "+" — the creation entry point.
    expect(gymSection(wrapper).findAll('.wtTagPickerChip')).toHaveLength(1)
    expect(gymSection(wrapper).find('[aria-label="Add gym"]').exists()).toBe(true)
  })

  it('creates a gym inline: emits create-gym, selects it, includes it on save', async () => {
    const wrapper = await openWith(makeExercise())
    await gymSection(wrapper).find('[aria-label="Add gym"]').trigger('click')
    const input = gymSection(wrapper).find('[aria-label="New gym name"]')
    await input.setValue('  Iron Temple  ')
    await input.trigger('keyup.enter')

    // Sanitized exactly as preferences.addGym will store it.
    expect(wrapper.emitted('create-gym')).toEqual([['Iron Temple']])

    // The parent adds it to the synced list; simulate the prop flowing back.
    await wrapper.setProps({ allGyms: ['Iron Temple'] })
    expect(gymChip(wrapper, 'Iron Temple').attributes('aria-pressed')).toBe('true')
    await wrapper.find('.repMaxBtnCalc').trigger('click')
    expect(lastSavePayload(wrapper).gyms).toEqual(['Iron Temple'])
  })

  it('selects an existing gym typed inline without emitting create-gym', async () => {
    const wrapper = await openWith(makeExercise(), ['Gym A'])
    await gymSection(wrapper).find('[aria-label="Add gym"]').trigger('click')
    const input = gymSection(wrapper).find('[aria-label="New gym name"]')
    await input.setValue('Gym A')
    await input.trigger('keyup.enter')

    expect(wrapper.emitted('create-gym')).toBeUndefined()
    expect(gymChip(wrapper, 'Gym A').attributes('aria-pressed')).toBe('true')
  })

  it('commits pending gym text on Save (blur-less flow)', async () => {
    const wrapper = await openWith(makeExercise())
    await gymSection(wrapper).find('[aria-label="Add gym"]').trigger('click')
    await gymSection(wrapper).find('[aria-label="New gym name"]').setValue('Iron Temple')
    await wrapper.find('.repMaxBtnCalc').trigger('click')

    expect(wrapper.emitted('create-gym')).toEqual([['Iron Temple']])
    expect(lastSavePayload(wrapper).gyms).toEqual(['Iron Temple'])
  })

  it('hides the inline add chip at the MAX_GYMS cap', async () => {
    const gyms = Array.from({ length: MAX_GYMS }, (_, i) => `Gym ${i}`)
    const wrapper = await openWith(makeExercise(), gyms)
    expect(gymSection(wrapper).find('[aria-label="Add gym"]').exists()).toBe(false)
  })

  it('seeds membership from the exercise', async () => {
    const wrapper = await openWith(makeExercise({ gyms: ['Gym B'] }), ['Gym A', 'Gym B'])
    expect(gymChip(wrapper, 'Gym B').attributes('aria-pressed')).toBe('true')
    expect(gymChip(wrapper, 'Gym A').attributes('aria-pressed')).toBe('false')
  })

  it('toggles multi-select membership and emits it on save', async () => {
    const wrapper = await openWith(makeExercise(), ['Gym A', 'Gym B'])
    await gymChip(wrapper, 'Gym A').trigger('click')
    await gymChip(wrapper, 'Gym B').trigger('click')
    await wrapper.find('.repMaxBtnCalc').trigger('click')
    expect(lastSavePayload(wrapper).gyms).toEqual(['Gym A', 'Gym B'])
  })

  it('emits [] when membership is cleared (unassigned = everywhere)', async () => {
    const wrapper = await openWith(makeExercise({ gyms: ['Gym A'] }), ['Gym A', 'Gym B'])
    await gymChip(wrapper, 'Gym A').trigger('click')
    await wrapper.find('.repMaxBtnCalc').trigger('click')
    expect(lastSavePayload(wrapper).gyms).toEqual([])
  })
})
