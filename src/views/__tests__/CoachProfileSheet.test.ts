import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import CoachProfileSheet from '../CoachProfileSheet.vue'
import { usePreferencesStore } from '../../stores/preferences'

// The sheet only touches the preferences store; stub the modal + network edges.
vi.mock('../../composables/useModal', () => ({
  useModal: () => ({ open: vi.fn(), close: vi.fn(), trapRef: { value: null } }),
}))
vi.mock('../../lib/supabase', () => ({ isPreviewMode: { value: false }, supabase: null }))

let wrapper: VueWrapper | null = null

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('CoachProfileSheet', () => {
  it('saves edited fields to the preferences store and emits close', async () => {
    const store = usePreferencesStore()
    const w = mount(CoachProfileSheet, { attachTo: document.body })
    wrapper = w

    // Pick a sex segment (find by label text).
    const maleBtn = [...document.body.querySelectorAll<HTMLButtonElement>('.cpSegment')].find(
      (b) => b.textContent?.trim() === 'Male',
    )
    expect(maleBtn).not.toBeNull()
    maleBtn!.click()
    await nextTick()

    // Set age via the first number input.
    const ageInput = document.body.querySelector<HTMLInputElement>('input[type="number"]')!
    ageInput.value = '31'
    ageInput.dispatchEvent(new Event('input'))
    await nextTick()

    const saveBtn = [...document.body.querySelectorAll<HTMLButtonElement>('.coachPrimaryBtn')].find(
      (b) => /Save profile/.test(b.textContent ?? ''),
    )
    saveBtn!.click()
    await nextTick()

    expect(store.coachProfile.sex).toBe('male')
    expect(store.coachProfile.age).toBe(31)
    expect(w.emitted('saved')).toBeTruthy()
    expect(w.emitted('close')).toBeTruthy()
  })

  it('discards edits on cancel (does not write to the store)', async () => {
    const store = usePreferencesStore()
    const w = mount(CoachProfileSheet, { attachTo: document.body })
    wrapper = w

    const femaleBtn = [...document.body.querySelectorAll<HTMLButtonElement>('.cpSegment')].find(
      (b) => b.textContent?.trim() === 'Female',
    )
    femaleBtn!.click()
    await nextTick()

    const cancelBtn = [...document.body.querySelectorAll<HTMLButtonElement>('.coachSecondaryBtn')].find(
      (b) => /Cancel/.test(b.textContent ?? ''),
    )
    cancelBtn!.click()
    await nextTick()

    expect(store.coachProfile.sex).toBe('') // unchanged
    expect(w.emitted('close')).toBeTruthy()
    expect(w.emitted('saved')).toBeFalsy()
  })

  it('reveals competition fields only when Competing is on', async () => {
    wrapper = mount(CoachProfileSheet, { attachTo: document.body })
    expect(document.body.querySelector('.cpCompetition')).toBeNull()

    const toggle = document.body.querySelector<HTMLButtonElement>('.cpToggleRow .glassToggle')!
    toggle.click()
    await nextTick()

    expect(document.body.querySelector('.cpCompetition')).not.toBeNull()
  })
})
