import { describe, it, expect, vi } from 'vitest'
import { mount, VueWrapper } from '@vue/test-utils'
import type { Exercise } from '../../stores/workout'
import { mockWeightUnit } from '../../__tests__/helpers'

vi.mock('../../composables/useWeightUnit', () => mockWeightUnit())

import EditExerciseModal from '../EditExerciseModal.vue'

function makeExercise(overrides: Partial<Exercise> = {}): Exercise {
  return { id: 'ex-1', name: 'Bench Press', tags: ['Chest'], sets: [], ...overrides }
}

/** Mount closed, then open by setting the exercise — mirrors how the parent drives it
 *  (the seed watcher is not `immediate`, so it only runs on the null → exercise change). */
async function openWith(exercise: Exercise): Promise<VueWrapper> {
  const wrapper = mount(EditExerciseModal, {
    props: { exercise: null as Exercise | null, allTags: [] },
    global: { stubs: { Teleport: true } },
  })
  await wrapper.setProps({ exercise })
  await wrapper.vm.$nextTick()
  return wrapper
}

const stepperValue = (w: VueWrapper) => w.find('.iosStepperValue').text()
const lastSavePayload = (w: VueWrapper) => {
  const calls = w.emitted('save')!
  return calls[calls.length - 1][0] as { intensityMaxReps: number | null }
}

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
