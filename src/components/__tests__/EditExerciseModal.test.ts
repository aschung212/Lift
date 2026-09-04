import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, VueWrapper } from '@vue/test-utils'
import type { Exercise } from '../../stores/workout'
import { MAX_GYMS } from '../../lib/gyms'
import { mockWeightUnit } from '../../__tests__/helpers'
import { runComponentAxe } from '../../__tests__/axeHelper'

// Switchable unit mock, mirroring WorkoutTracker.test.ts (LIFT-1211): defaults
// to lbs so every pre-existing test is unaffected, and the bar-weight suite
// flips it to kg through the mocked module's __setMockUnit. The unit lives in a
// factory-scoped ref because a module const hits the vi.mock TDZ.
vi.mock('../../composables/useWeightUnit', async () => {
  const { shallowRef } = await import('vue')
  const unit = shallowRef<'lbs' | 'kg'>('lbs')
  return {
    __setMockUnit: (u: 'lbs' | 'kg') => { unit.value = u },
    ...mockWeightUnit({ weightUnit: unit }),
  }
})
import * as weightUnitMockModule from '../../composables/useWeightUnit'
const setMockUnit = (u: 'lbs' | 'kg') =>
  (weightUnitMockModule as unknown as { __setMockUnit: (u: 'lbs' | 'kg') => void }).__setMockUnit(u)

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
  return calls[calls.length - 1][0] as {
    intensityMaxReps: number | null
    equipment: string | null
    gyms: string[]
    barWeight: number
  }
}

/** The bar-weight stepper, addressed by its row label — the intensity stepper
 *  shares the `.iosStepperValue` class and renders later in the same sheet. */
const barStepper = (w: VueWrapper) =>
  w.findAll('.iosSettingsRow').find(
    (row) => row.find('.iosSettingsRowLabel').exists()
      && row.find('.iosSettingsRowLabel').text() === 'Starting weight'
  )!

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

describe('EditExerciseModal — durable notes (#619)', () => {
  const notesInput = (w: VueWrapper) => w.find('.wtEditNotesInput')
  const lastNotes = (w: VueWrapper) => {
    const calls = w.emitted('save')!
    return (calls[calls.length - 1][0] as { notes: string }).notes
  }

  it('seeds the note textarea from the exercise', async () => {
    const wrapper = await openWith(makeExercise({ notes: 'brace before unrack' }))
    expect((notesInput(wrapper).element as HTMLTextAreaElement).value).toBe('brace before unrack')
  })

  it('leaves the textarea empty when the exercise has no note', async () => {
    const wrapper = await openWith(makeExercise())
    expect((notesInput(wrapper).element as HTMLTextAreaElement).value).toBe('')
  })

  it('emits the edited note on save', async () => {
    const wrapper = await openWith(makeExercise())
    await notesInput(wrapper).setValue('drive knees out')
    await wrapper.find('.repMaxBtnCalc').trigger('click')
    expect(lastNotes(wrapper)).toBe('drive knees out')
  })

  it('emits an empty string when the note is cleared', async () => {
    const wrapper = await openWith(makeExercise({ notes: 'old cue' }))
    await notesInput(wrapper).setValue('')
    await wrapper.find('.repMaxBtnCalc').trigger('click')
    expect(lastNotes(wrapper)).toBe('')
  })
})

/**
 * Regression: LIFT-1223 — `Exercise.barWeight` is stored in the user's DISPLAY
 * unit, so the fallback for an exercise that has none has to be in that unit
 * too. This field seeded from a hardcoded `45`, which a kg user read as "45 kg";
 * because the parent saves `payload.barWeight` on every edit while plate mode is
 * on, renaming an exercise persisted a 45 kg (99 lb) bar and corrupted its plate
 * math from then on — the same class the unit-toggle conversion (#1232) exists
 * to prevent, reached by a write instead of a toggle.
 *
 * The existing plate-mode coverage never caught it because every fixture that
 * turns plate mode on also supplies an explicit `barWeight`, so the `??` branch
 * had never run.
 */
describe('EditExerciseModal — default bar weight follows the display unit (LIFT-1223)', () => {
  afterEach(() => { setMockUnit('lbs') })

  const plateExercise = (overrides: Partial<Exercise> = {}) =>
    makeExercise({ inputMode: 'plates', ...overrides })

  it('seeds the standard lbs bar for an lbs user', async () => {
    const wrapper = await openWith(plateExercise())
    expect(barStepper(wrapper).find('.iosStepperValue').text()).toBe('45 lbs')
  })

  it('seeds the standard kg bar for a kg user, not the lbs number', async () => {
    setMockUnit('kg')
    const wrapper = await openWith(plateExercise())
    // Pre-fix this read "45 kg" — a 99 lb bar presented as the default.
    expect(barStepper(wrapper).find('.iosStepperValue').text()).toBe('20 kg')
  })

  it('does not persist a lbs bar into a kg user\'s exercise on an unrelated save', async () => {
    setMockUnit('kg')
    const wrapper = await openWith(plateExercise())
    await wrapper.find('.repMaxBtnCalc').trigger('click')
    expect(lastSavePayload(wrapper).barWeight).toBe(20)
  })

  it('leaves an explicitly stored bar untouched', async () => {
    setMockUnit('kg')
    const wrapper = await openWith(plateExercise({ barWeight: 15 }))
    expect(barStepper(wrapper).find('.iosStepperValue').text()).toBe('15 kg')
    await wrapper.find('.repMaxBtnCalc').trigger('click')
    expect(lastSavePayload(wrapper).barWeight).toBe(15)
  })

  it('still defaults a total-count machine to no bar in either unit', async () => {
    setMockUnit('kg')
    const wrapper = await openWith(plateExercise({ plateCountMode: 'total' }))
    expect(barStepper(wrapper).find('.iosStepperValue').text()).toBe('0 kg')
  })
})

// ── Switch accessible names (LIFT-1308) ─────────────────────────────
// Both `.iosToggle` switches render nothing but a decorative knob, so with no
// explicit name AT reached them and announced "switch, off" — twice, in the
// same sheet, with nothing to tell them apart (WCAG 4.1.2, Level A).
describe('EditExerciseModal — switch accessible names (LIFT-1308)', () => {
  /** Attached mount: axe walks the live document, and `getElementById`
   *  resolving an `aria-labelledby` target needs the tree in it. */
  async function openAttached(exercise: Exercise): Promise<VueWrapper> {
    const wrapper = mount(EditExerciseModal, {
      props: { exercise: null as Exercise | null, allTags: [], allGyms: [] },
      attachTo: document.body,
      global: { stubs: { Teleport: true } },
    })
    await wrapper.setProps({ exercise })
    await wrapper.vm.$nextTick()
    return wrapper
  }

  /** The accessible name axe computes for a `role="switch"` button whose only
   *  content is a decorative span: `aria-labelledby` → that element's text. */
  const accessibleName = (toggle: ReturnType<VueWrapper['find']>) => {
    const id = toggle.attributes('aria-labelledby')
    return id ? document.getElementById(id)?.textContent ?? null : null
  }

  it('names both switches by their own visible row label', async () => {
    const wrapper = await openAttached(makeExercise({ inputMode: 'plates' }))
    const toggles = wrapper.findAll('.iosToggle')
    expect(toggles).toHaveLength(2)

    // Pre-fix both were the empty string, so AT could not tell them apart.
    expect(toggles.map(accessibleName)).toEqual(['Plate calculator', 'Bodyweight-loaded'])
    // ...which requires the two label ids to be distinct, not just present.
    expect(new Set(toggles.map((t) => t.attributes('aria-labelledby'))).size).toBe(2)
    wrapper.unmount()
  })

  it('keeps the name stable across a toggle, moving only aria-checked', async () => {
    const wrapper = await openAttached(makeExercise())
    const bodyweightToggle = () => wrapper.findAll('.iosToggle')[1]
    expect(bodyweightToggle().attributes('aria-checked')).toBe('false')

    await bodyweightToggle().trigger('click')
    expect(bodyweightToggle().attributes('aria-checked')).toBe('true')
    expect(accessibleName(bodyweightToggle())).toBe('Bodyweight-loaded')
    wrapper.unmount()
  })

  it('has no axe violations across the whole sheet', async () => {
    const wrapper = await openAttached(makeExercise({ inputMode: 'plates' }))
    const results = await runComponentAxe(wrapper.element)
    expect(results).toHaveNoViolations()
    wrapper.unmount()
  })
})
