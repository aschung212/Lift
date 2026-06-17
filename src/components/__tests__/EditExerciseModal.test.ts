import { describe, it, expect, vi } from 'vitest'
import { mount, VueWrapper } from '@vue/test-utils'
import type { Exercise } from '../../stores/workout'
import { mockWeightUnit } from '../../__tests__/helpers'
import { DEFAULT_WARMUP_SCHEME } from '../../lib/warmupGenerator'

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

const rows = (w: VueWrapper) => w.findAll('.wtWarmupEditRow')
const lastSavePayload = (w: VueWrapper) => {
  const calls = w.emitted('save')!
  return calls[calls.length - 1][0] as { warmupScheme: { pct: number; reps: number }[] | null }
}

describe('EditExerciseModal — warmup ramp editor (LIFT-725)', () => {
  it('seeds the default ramp and hides "Reset" when an exercise has no custom scheme', async () => {
    const wrapper = await openWith(makeExercise())
    expect(rows(wrapper)).toHaveLength(DEFAULT_WARMUP_SCHEME.length)
    const firstRow = rows(wrapper)[0]
    const values = firstRow.findAll('.iosStepperValue')
    expect(values[0].text()).toBe('40%') // intensity
    expect(values[1].text()).toBe('8')   // reps
    expect(wrapper.find('.wtWarmupEditReset').exists()).toBe(false)
  })

  it('seeds a per-exercise custom scheme and shows "Reset"', async () => {
    const wrapper = await openWith(makeExercise({ warmupScheme: [{ pct: 0.5, reps: 6 }] }))
    expect(rows(wrapper)).toHaveLength(1)
    const values = rows(wrapper)[0].findAll('.iosStepperValue')
    expect(values[0].text()).toBe('50%')
    expect(values[1].text()).toBe('6')
    expect(wrapper.find('.wtWarmupEditReset').exists()).toBe(true)
  })

  it('renders the empty-state and no rows when the scheme is explicitly empty', async () => {
    const wrapper = await openWith(makeExercise({ warmupScheme: [] }))
    expect(rows(wrapper)).toHaveLength(0)
    expect(wrapper.find('.wtWarmupEditEmpty').exists()).toBe(true)
  })

  it('emits warmupScheme: null when the ramp is left at the default', async () => {
    const wrapper = await openWith(makeExercise())
    await wrapper.find('.repMaxBtnCalc').trigger('click')
    expect(lastSavePayload(wrapper).warmupScheme).toBeNull()
  })

  it('emits a custom scheme after editing intensity', async () => {
    const wrapper = await openWith(makeExercise())
    await wrapper.find('[aria-label="Increase warm-up 1 intensity"]').trigger('click') // 40 → 45
    await wrapper.find('.repMaxBtnCalc').trigger('click')
    const scheme = lastSavePayload(wrapper).warmupScheme
    expect(scheme).not.toBeNull()
    expect(scheme![0]).toEqual({ pct: 0.45, reps: 8 })
  })

  it('clamps intensity at the maximum and reps at the minimum', async () => {
    const wrapper = await openWith(makeExercise({ warmupScheme: [{ pct: 0.95, reps: 1 }] }))
    await wrapper.find('[aria-label="Increase warm-up 1 intensity"]').trigger('click') // already 95%
    await wrapper.find('[aria-label="Decrease warm-up 1 reps"]').trigger('click')      // already 1
    await wrapper.find('.repMaxBtnCalc').trigger('click')
    expect(lastSavePayload(wrapper).warmupScheme![0]).toEqual({ pct: 0.95, reps: 1 })
  })

  it('adds and removes steps, then resets back to default', async () => {
    const wrapper = await openWith(makeExercise())
    await wrapper.find('.wtWarmupEditAdd').trigger('click')
    expect(rows(wrapper)).toHaveLength(DEFAULT_WARMUP_SCHEME.length + 1)

    // Remove the first step.
    await wrapper.find('.wtWarmupEditRow [aria-label="Remove warm-up 1"]').trigger('click')
    expect(rows(wrapper)).toHaveLength(DEFAULT_WARMUP_SCHEME.length)

    // Reset restores the default and hides the reset control again.
    await wrapper.find('.wtWarmupEditReset').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.wtWarmupEditReset').exists()).toBe(false)
    await wrapper.find('.repMaxBtnCalc').trigger('click')
    expect(lastSavePayload(wrapper).warmupScheme).toBeNull()
  })

  it('emits warmupScheme: [] when every step is removed', async () => {
    const wrapper = await openWith(makeExercise({ warmupScheme: [{ pct: 0.5, reps: 5 }] }))
    await wrapper.find('.wtWarmupEditRow [aria-label="Remove warm-up 1"]').trigger('click')
    expect(wrapper.find('.wtWarmupEditEmpty').exists()).toBe(true)
    await wrapper.find('.repMaxBtnCalc').trigger('click')
    expect(lastSavePayload(wrapper).warmupScheme).toEqual([])
  })
})
