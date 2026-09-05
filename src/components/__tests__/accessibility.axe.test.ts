/**
 * Automated accessibility audits (LIFT-665).
 *
 * Complements the hand-written aria-attribute checks in accessibility.test.ts
 * by running the full axe-core WCAG ruleset against rendered components. This
 * catches regression classes the manual checks miss (e.g. duplicate ids,
 * inputs without accessible names, invalid ARIA usage, nested-interactive
 * elements) and prevents backsliding on the a11y work from LIFT-546–551.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import AuthScreen from '../../views/AuthScreen.vue'
import BodyweightTracker from '../../views/BodyweightTracker.vue'
import OnboardingScreen from '../../views/OnboardingScreen.vue'
import { useBodyweightStore } from '../../stores/bodyweight'
import { runComponentAxe } from '../../__tests__/axeHelper'

vi.mock('../../composables/useAuth', () => ({
  useAuth: () => ({
    signInWithProvider: vi.fn().mockResolvedValue({ error: null }),
    signInWithEmail: vi.fn().mockResolvedValue({ error: null }),
    signUp: vi.fn().mockResolvedValue({ error: null }),
  })
}))
vi.mock('../../composables/useAnalytics', () => ({
  useAnalytics: () => ({
    logEvent: vi.fn(),
    tabSwitch: vi.fn(),
    flushEngagement: vi.fn(),
  })
}))
vi.mock('../../composables/useTheme', () => ({
  useTheme: () => ({
    weightUnit: { value: 'lbs' },
    displayWeight: (w: number) => w,
    toLbs: (w: number) => w,
    restTimerEnabled: { value: false },
    currentTheme: { value: 'void' },
    THEMES: [],
    colorMode: { value: 'dark' },
    resolvedMode: { value: 'dark' },
  }),
  THEME_PREVIEWS: {
    fire: { dark: { accent: '#ff4500', bg: '#1a0000' }, light: { accent: '#ff4500', bg: '#fff5f0' } },
    water: { dark: { accent: '#0077be', bg: '#001a33' }, light: { accent: '#0077be', bg: '#f0f8ff' } },
    luck: { dark: { accent: '#2ecc71', bg: '#002200' }, light: { accent: '#2ecc71', bg: '#f0fff0' } },
  },
}))
vi.mock('../../composables/useWeightUnit', () => ({
  useWeightUnit: () => ({
    weightUnit: { value: 'lbs' },
    displayWeight: (w: number) => w,
    toLbs: (w: number) => w,
  })
}))

import { getLocalStorageMock } from '../../__tests__/helpers'
const localStorageMock = getLocalStorageMock()

describe('Automated accessibility (axe-core)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorageMock.clear()
  })

  it('AuthScreen has no axe violations', async () => {
    const wrapper = mount(AuthScreen, { attachTo: document.body })
    const results = await runComponentAxe(wrapper.element)
    expect(results).toHaveNoViolations()
    wrapper.unmount()
  })

  it('OnboardingScreen has no axe violations', async () => {
    const wrapper = mount(OnboardingScreen, { attachTo: document.body })
    const results = await runComponentAxe(wrapper.element)
    expect(results).toHaveNoViolations()
    wrapper.unmount()
  })

  it('BodyweightTracker (empty state) has no axe violations', async () => {
    const wrapper = mount(BodyweightTracker, {
      attachTo: document.body,
      global: { stubs: { Teleport: true } },
    })
    const results = await runComponentAxe(wrapper.element)
    expect(results).toHaveNoViolations()
    wrapper.unmount()
  })

  // The scan above renders zero entry rows, so the entry list — the only place
  // a weigh-in can be edited or deleted — had never been audited at all. It was
  // a role="button" <li> (disallowed on an li in a ul) wrapping the Edit/Delete
  // buttons, which a children-presentational button role drops from the
  // accessibility tree. Both went unseen for exactly that reason (LIFT-1349).
  it('BodyweightTracker (entry list, actions expanded) has no axe violations', async () => {
    const store = useBodyweightStore()
    store.addEntry(170, '2026-01-01')

    const wrapper = mount(BodyweightTracker, {
      attachTo: document.body,
      global: { stubs: { Teleport: true } },
    })
    await wrapper.find('.wtSetRowMain').trigger('click')
    expect(wrapper.find('.wtSetActions').exists()).toBe(true)

    const results = await runComponentAxe(wrapper.element)
    expect(results).toHaveNoViolations()
    wrapper.unmount()
  })

  it('BodyweightTracker log-weight modal has no axe violations', async () => {
    const wrapper = mount(BodyweightTracker, {
      attachTo: document.body,
      global: { stubs: { Teleport: false } },
    })
    await wrapper.find('.wtLogBtn').trigger('click')
    const overlay = document.querySelector('.repMaxOverlay') as Element
    expect(overlay).toBeTruthy()
    const results = await runComponentAxe(overlay)
    expect(results).toHaveNoViolations()
    wrapper.unmount()
  })

  // Guards against the helper being accidentally neutered (e.g. all rules
  // disabled), which would make every audit above pass vacuously.
  it('runComponentAxe still detects a genuine violation', async () => {
    const el = document.createElement('div')
    el.innerHTML = '<input type="text">'
    document.body.appendChild(el)
    const results = await runComponentAxe(el)
    expect(Object.keys(results.violations).length).toBeGreaterThan(0)
    el.remove()
  })
})
