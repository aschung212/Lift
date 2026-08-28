/**
 * LIFT-1190 — RestTimerContent.vue: the rest-timer modal UI that binds to a
 * RestTimerController (LIFT-879). The controller itself is unit-tested in
 * useRestTimerController.test.ts; these tests pin the *template* — the two
 * render modes (running ring vs. preset editor), the control buttons, the
 * multi-preset/alert editor rows, and the emit contract — so a binding or
 * markup regression fails fast instead of shipping a broken timer sheet.
 *
 * The component consumes the controller purely as a prop, so a hand-built mock
 * controller of plain refs + spy methods exercises the bindings in isolation
 * (no Pinia / Web Audio / notification plumbing required).
 */
import { describe, it, expect, vi } from 'vitest'
import { ref, computed } from 'vue'
import { mount, VueWrapper } from '@vue/test-utils'
import type { RestTimerController } from '../../composables/useRestTimerController'
import { formatDuration } from '../../composables/useRestTimerController'
import RestTimerContent from '../RestTimerContent.vue'

type MockController = RestTimerController & {
  togglePause: ReturnType<typeof vi.fn>
  restartTimer: ReturnType<typeof vi.fn>
  stopTimer: ReturnType<typeof vi.fn>
  setRestDuration: ReturnType<typeof vi.fn>
  addPreset: ReturnType<typeof vi.fn>
  removePreset: ReturnType<typeof vi.fn>
  togglePresetEnabled: ReturnType<typeof vi.fn>
  resetAllDefaults: ReturnType<typeof vi.fn>
  addWarningOption: ReturnType<typeof vi.fn>
  removeWarningOption: ReturnType<typeof vi.fn>
  toggleWarningTime: ReturnType<typeof vi.fn>
  disableRestTimer: ReturnType<typeof vi.fn>
}

/** A controller shaped exactly like the real one but backed by plain refs and
 *  spy methods. `visiblePresets` mirrors the real derivation (presets minus
 *  disabled) so the running-mode preset row reflects the enabled set. */
function makeController(overrides: Partial<Record<string, unknown>> = {}): MockController {
  const restPresets = ref<number[]>([60, 90, 120, 180])
  const disabledPresets = ref<number[]>([])
  const warningOptions = ref<number[]>([10, 15, 30])
  const warningTimes = ref<number[]>([15])

  const ctrl = {
    timerActive: ref(true),
    timerPaused: ref(false),
    timerSeconds: ref(90),
    timerStopping: ref(false),
    timerAnnouncement: ref(''),
    timerDisplay: computed(() => '1:30'),
    timerProgress: computed(() => 0.5),
    timerUrgent: computed(() => false),
    restDuration: ref(90),
    editingPresets: ref(false),
    editTab: ref<'rest' | 'alerts'>('rest'),
    newPresetValue: ref<number | null>(null),
    newWarningValue: ref<number | null>(null),
    restPresets,
    disabledPresets,
    visiblePresets: computed(() => restPresets.value.filter((s) => !disabledPresets.value.includes(s))),
    warningOptions,
    warningTimes,
    presetInputEl: ref<HTMLInputElement | null>(null),
    startRestTimer: vi.fn(),
    stopTimer: vi.fn(),
    restartTimer: vi.fn(),
    togglePause: vi.fn(),
    setRestDuration: vi.fn(),
    addPreset: vi.fn(),
    removePreset: vi.fn(),
    togglePresetEnabled: vi.fn(),
    resetAllDefaults: vi.fn(),
    addWarningOption: vi.fn(),
    removeWarningOption: vi.fn(),
    toggleWarningTime: vi.fn(),
    formatDuration,
    disableRestTimer: vi.fn(),
    ...overrides,
  }
  return ctrl as unknown as MockController
}

function mountContent(
  ctrl: MockController,
  exerciseName = '',
): VueWrapper {
  return mount(RestTimerContent, { props: { exerciseName, ctrl } })
}

describe('RestTimerContent — running mode', () => {
  it('renders the countdown ring, display time, and "remaining" label', () => {
    const wrapper = mountContent(makeController())
    expect(wrapper.find('.wtTimerRing').exists()).toBe(true)
    expect(wrapper.find('.wtTimerTime').text()).toBe('1:30')
    expect(wrapper.find('.wtTimerLabel').text()).toBe('remaining')
  })

  it('shows "Done" when the timer has reached zero', () => {
    const wrapper = mountContent(
      makeController({ timerSeconds: ref(0), timerDisplay: computed(() => '0:00') }),
    )
    expect(wrapper.find('.wtTimerLabel').text()).toBe('Done')
    expect(wrapper.find('.wtTimerTimeDone').exists()).toBe(true)
  })

  it('renders only the enabled presets, marking the active duration', () => {
    const ctrl = makeController()
    ctrl.disabledPresets.value = [120]
    const wrapper = mountContent(ctrl)
    const presets = wrapper.findAll('.wtTimerPreset')
    // 60/90/180 remain visible; 120 is disabled.
    expect(presets.map((p) => p.text())).toEqual(['1m', '1:30', '3m'])
    const active = wrapper.find('.wtTimerPresetActive')
    expect(active.text()).toBe('1:30') // restDuration = 90
  })

  it('tapping a preset calls setRestDuration with its seconds', async () => {
    const ctrl = makeController()
    const wrapper = mountContent(ctrl)
    await wrapper.findAll('.wtTimerPreset')[0].trigger('click') // 60s
    expect(ctrl.setRestDuration).toHaveBeenCalledWith(60)
  })

  it('shows the pause control while running and fires togglePause', async () => {
    const ctrl = makeController()
    const wrapper = mountContent(ctrl)
    const pause = wrapper.find('[aria-label="Pause"]')
    expect(pause.exists()).toBe(true)
    await pause.trigger('click')
    expect(ctrl.togglePause).toHaveBeenCalledOnce()
  })

  it('shows the resume control while paused and fires togglePause', async () => {
    const ctrl = makeController({ timerPaused: ref(true) })
    const wrapper = mountContent(ctrl)
    const resume = wrapper.find('[aria-label="Resume"]')
    expect(resume.exists()).toBe(true)
    await resume.trigger('click')
    expect(ctrl.togglePause).toHaveBeenCalledOnce()
  })

  it('shows the restart control at zero and fires restartTimer', async () => {
    const ctrl = makeController({ timerSeconds: ref(0), timerDisplay: computed(() => '0:00') })
    const wrapper = mountContent(ctrl)
    const restart = wrapper.find('[aria-label="Restart"]')
    expect(restart.exists()).toBe(true)
    await restart.trigger('click')
    expect(ctrl.restartTimer).toHaveBeenCalledOnce()
  })

  it('renders the exercise name and "Log Next" only when an exercise is set', async () => {
    const withoutName = mountContent(makeController())
    expect(withoutName.find('.wtTimerExName').exists()).toBe(false)
    expect(withoutName.findAll('.repMaxBtn')).toHaveLength(1) // just "Done"

    const ctrl = makeController()
    const withName = mountContent(ctrl, 'Bench Press')
    expect(withName.find('.wtTimerExName').text()).toBe('Bench Press')
    const logNext = withName.find('.repMaxBtnCalc')
    expect(logNext.text()).toBe('Log Next')
    await logNext.trigger('click')
    expect(ctrl.stopTimer).toHaveBeenCalledOnce()
    expect(withName.emitted('skip-to-next')).toHaveLength(1)
  })

  it('"Done" emits close without stopping the timer', async () => {
    const ctrl = makeController()
    const wrapper = mountContent(ctrl)
    await wrapper.find('.repMaxBtnClose').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(ctrl.stopTimer).not.toHaveBeenCalled()
  })

  it('"Stop" stops the timer and emits dismiss', async () => {
    const ctrl = makeController()
    const wrapper = mountContent(ctrl)
    await wrapper.find('.wtTimerStopLink').trigger('click')
    expect(ctrl.stopTimer).toHaveBeenCalledOnce()
    expect(wrapper.emitted('dismiss')).toHaveLength(1)
  })

  it('opens the preset editor via the settings gear', async () => {
    const ctrl = makeController()
    const wrapper = mountContent(ctrl)
    expect(ctrl.editingPresets.value).toBe(false)
    await wrapper.find('[aria-label="Timer settings"]').trigger('click')
    expect(ctrl.editingPresets.value).toBe(true)
  })
})

describe('RestTimerContent — preset editor mode', () => {
  function mountEditor(overrides: Partial<Record<string, unknown>> = {}): {
    wrapper: VueWrapper
    ctrl: MockController
  } {
    const ctrl = makeController({ editingPresets: ref(true), ...overrides })
    return { wrapper: mountContent(ctrl), ctrl }
  }

  it('renders a row per rest preset with its formatted label', () => {
    const { wrapper } = mountEditor()
    const rows = wrapper.findAll('.wtTimerEditListItem')
    expect(rows).toHaveLength(4)
    expect(rows.map((r) => r.find('.wtTimerEditItemLabel').text())).toEqual([
      '1m',
      '1:30',
      '2m',
      '3m',
    ])
  })

  it('toggling a preset switch calls togglePresetEnabled', async () => {
    const { wrapper, ctrl } = mountEditor()
    // first switch belongs to the 60s preset
    await wrapper.findAll('.wtTimerEditListItem')[0].find('.glassToggle').trigger('click')
    expect(ctrl.togglePresetEnabled).toHaveBeenCalledWith(60)
  })

  it('reflects a disabled preset in its switch aria-checked state', () => {
    const ctrl = makeController({ editingPresets: ref(true) })
    ctrl.disabledPresets.value = [90]
    const wrapper = mountContent(ctrl)
    const toggles = wrapper.findAll('.wtTimerEditListItem .glassToggle')
    expect(toggles[0].attributes('aria-checked')).toBe('true') // 60 enabled
    expect(toggles[1].attributes('aria-checked')).toBe('false') // 90 disabled
  })

  it('deleting a preset calls removePreset', async () => {
    const { wrapper, ctrl } = mountEditor()
    await wrapper.findAll('.wtTimerEditDeleteBtn')[0].trigger('click')
    expect(ctrl.removePreset).toHaveBeenCalledWith(60)
  })

  it('disables the delete button when only one preset remains', () => {
    const ctrl = makeController({ editingPresets: ref(true), restPresets: ref([90]) })
    const wrapper = mountContent(ctrl)
    expect(wrapper.find('.wtTimerEditDeleteBtn').attributes('disabled')).toBeDefined()
  })

  it('adds a new preset via the Add button', async () => {
    const { wrapper, ctrl } = mountEditor()
    ctrl.newPresetValue.value = 45
    await wrapper.vm.$nextTick()
    await wrapper.find('.wtTimerEditAddBtn').trigger('click')
    expect(ctrl.addPreset).toHaveBeenCalledOnce()
  })

  it('disables Add while the new-preset input is empty', async () => {
    const { wrapper, ctrl } = mountEditor()
    expect(wrapper.find('.wtTimerEditAddBtn').attributes('disabled')).toBeDefined()
    ctrl.newPresetValue.value = 45
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.wtTimerEditAddBtn').attributes('disabled')).toBeUndefined()
  })

  it('switches to the Alerts tab and lists the warning options', async () => {
    const { wrapper, ctrl } = mountEditor()
    await wrapper.findAll('.wtTimerEditTab')[1].trigger('click')
    expect(ctrl.editTab.value).toBe('alerts')
    const rows = wrapper.findAll('.wtTimerEditListItem')
    expect(rows.map((r) => r.find('.wtTimerEditItemLabel').text())).toEqual([
      '10s before',
      '15s before',
      '30s before',
    ])
  })

  it('toggling a warning option calls toggleWarningTime', async () => {
    const ctrl = makeController({ editingPresets: ref(true), editTab: ref<'rest' | 'alerts'>('alerts') })
    const wrapper = mountContent(ctrl)
    await wrapper.findAll('.wtTimerEditListItem')[0].find('.glassToggle').trigger('click')
    expect(ctrl.toggleWarningTime).toHaveBeenCalledWith(10)
  })

  it('marks active warning times via aria-checked', () => {
    const ctrl = makeController({ editingPresets: ref(true), editTab: ref<'rest' | 'alerts'>('alerts') })
    const wrapper = mountContent(ctrl)
    const toggles = wrapper.findAll('.wtTimerEditListItem .glassToggle')
    // warningTimes = [15] → only the middle option (15) is on
    expect(toggles.map((t) => t.attributes('aria-checked'))).toEqual(['false', 'true', 'false'])
  })

  it('removing a warning option calls removeWarningOption', async () => {
    const ctrl = makeController({ editingPresets: ref(true), editTab: ref<'rest' | 'alerts'>('alerts') })
    const wrapper = mountContent(ctrl)
    await wrapper.findAll('.wtTimerEditDeleteBtn')[2].trigger('click')
    expect(ctrl.removeWarningOption).toHaveBeenCalledWith(30)
  })

  it('"Reset to defaults" calls resetAllDefaults', async () => {
    const { wrapper, ctrl } = mountEditor()
    await wrapper.find('.wtTimerEditResetBtn').trigger('click')
    expect(ctrl.resetAllDefaults).toHaveBeenCalledOnce()
  })

  it('"Done" leaves the editor by clearing editingPresets', async () => {
    const { wrapper, ctrl } = mountEditor()
    await wrapper.find('.repMaxBtnCalc').trigger('click')
    expect(ctrl.editingPresets.value).toBe(false)
  })

  it('the edit-mode countdown button fires togglePause', async () => {
    const { wrapper, ctrl } = mountEditor()
    await wrapper.find('.wtTimerEditCountdown').trigger('click')
    expect(ctrl.togglePause).toHaveBeenCalledOnce()
  })

  it('"Disable Rest Timer" delegates to disableRestTimer', async () => {
    const { wrapper, ctrl } = mountEditor()
    await wrapper.find('.wtTimerDisableBtn').trigger('click')
    expect(ctrl.disableRestTimer).toHaveBeenCalledOnce()
    // callbacks that emit dismiss / restore are passed through
    expect(ctrl.disableRestTimer.mock.calls[0]).toHaveLength(2)
  })

  it('disableRestTimer callbacks emit dismiss (disable) and restore (undo)', async () => {
    const { wrapper, ctrl } = mountEditor()
    await wrapper.find('.wtTimerDisableBtn').trigger('click')
    const [onDisable, onRestore] = ctrl.disableRestTimer.mock.calls[0]
    onDisable()
    onRestore()
    expect(wrapper.emitted('dismiss')).toHaveLength(1)
    expect(wrapper.emitted('restore')).toHaveLength(1)
  })
})
