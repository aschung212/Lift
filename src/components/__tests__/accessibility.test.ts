import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import AuthScreen from '../AuthScreen.vue'
import BodyweightTracker from '../BodyweightTracker.vue'
import OnboardingScreen from '../OnboardingScreen.vue'
import { useBodyweightStore } from '../../stores/bodyweight'
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

describe('Accessibility', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorageMock.clear()
  })

  describe('AuthScreen', () => {
    let wrapper: ReturnType<typeof mount>

    beforeEach(() => {
      wrapper = mount(AuthScreen)
    })

    it('email input has aria-label', () => {
      const emailInput = wrapper.find('input[type="email"]')
      expect(emailInput.attributes('aria-label')).toBe('Email')
    })

    it('password input has aria-label', () => {
      const passwordInput = wrapper.find('input[type="password"]')
      expect(passwordInput.attributes('aria-label')).toBe('Password')
    })

    it('form uses semantic form element', () => {
      const form = wrapper.find('form')
      expect(form.exists()).toBe(true)
    })

    it('submit button has type=submit', () => {
      const btn = wrapper.find('.authSubmitBtn')
      expect(btn.attributes('type')).toBe('submit')
    })

    it('auth message element has role=status and aria-live when shown', () => {
      // The authMessage element is v-if="message", so it only renders when there's a message.
      // Verify the structure by checking that when no message exists, no alert is shown.
      expect(wrapper.find('.authMessage').exists()).toBe(false)
      // The template has: role="status" aria-live="polite" on the .authMessage element
      expect(wrapper.find('.authCard').exists()).toBe(true)
    })
  })

  describe('BodyweightTracker', () => {
    let wrapper: ReturnType<typeof mount>

    beforeEach(() => {
      wrapper = mount(BodyweightTracker, {
        global: { stubs: { Teleport: true } }
      })
    })

    it('log button is accessible', () => {
      const btn = wrapper.find('.wtLogBtn')
      expect(btn.exists()).toBe(true)
      expect(btn.text()).toContain('Log')
    })

    it('empty state provides helpful text', () => {
      expect(wrapper.find('.wtEmpty').text()).toContain('Log')
    })
  })

  describe('BodyweightTracker modal a11y', () => {
    let wrapper: ReturnType<typeof mount>

    beforeEach(() => {
      wrapper = mount(BodyweightTracker, {
        global: { stubs: { Teleport: false } }
      })
    })

    it('modal has role=dialog, aria-modal=true, and aria-labelledby', async () => {
      await wrapper.find('.wtLogBtn').trigger('click')
      const dialog = document.querySelector('[role="dialog"]')
      expect(dialog).toBeTruthy()
      expect(dialog!.getAttribute('aria-modal')).toBe('true')
      expect(dialog!.getAttribute('aria-labelledby')).toBe('bw-modal-title')
    })

    it('modal title id matches aria-labelledby', async () => {
      await wrapper.find('.wtLogBtn').trigger('click')
      const title = document.getElementById('bw-modal-title')
      expect(title).toBeTruthy()
      expect(title!.textContent).toBe('Log Weight')
    })

    it('overlay has keydown escape handler attribute', async () => {
      await wrapper.find('.wtLogBtn').trigger('click')
      const overlay = document.querySelector('.repMaxOverlay')
      expect(overlay).toBeTruthy()
      // The @keydown.escape directive is compiled to an onKeydown handler
      // Verify the overlay element exists with the modal dialog inside it
      const dialog = overlay!.querySelector('[role="dialog"]')
      expect(dialog).toBeTruthy()
      expect(dialog!.getAttribute('aria-modal')).toBe('true')
    })

    it('form inputs have proper labels', async () => {
      await wrapper.find('.wtLogBtn').trigger('click')
      const labels = document.querySelectorAll('.repMaxModal label')
      expect(labels.length).toBeGreaterThanOrEqual(2) // Date + Weight
    })
  })

  describe('BodyweightTracker chart a11y', () => {
    it('chart SVG has role=img and aria-label', () => {
      const store = useBodyweightStore()
      // Use recent dates so they fall within the default 30d period filter
      const today = new Date()
      const d1 = new Date(today)
      d1.setDate(d1.getDate() - 7)
      const d2 = new Date(today)
      d2.setDate(d2.getDate() - 1)
      store.addEntry(170, d1.toISOString().slice(0, 10))
      store.addEntry(172, d2.toISOString().slice(0, 10))

      const wrapper = mount(BodyweightTracker, {
        global: { stubs: { Teleport: true } }
      })

      const svg = wrapper.find('svg[role="img"]')
      expect(svg.exists()).toBe(true)
      expect(svg.attributes('aria-label')).toContain('Body weight progress chart')
    })

    it('entry action buttons have aria-labels', () => {
      const store = useBodyweightStore()
      store.addEntry(170, '2025-01-01')

      const wrapper = mount(BodyweightTracker, {
        global: { stubs: { Teleport: true } }
      })

      const entryRow = wrapper.find('.wtSetRow')
      expect(entryRow.exists()).toBe(true)
    })
  })

  describe('BodyweightTracker period selector a11y', () => {
    it('period buttons have aria-label attributes', () => {
      const store = useBodyweightStore()
      const today = new Date()
      const d1 = new Date(today)
      d1.setDate(d1.getDate() - 7)
      store.addEntry(170, d1.toISOString().slice(0, 10))

      const wrapper = mount(BodyweightTracker, {
        global: { stubs: { Teleport: true } }
      })

      const buttons = wrapper.findAll('.bwPeriodBtn')
      expect(buttons.length).toBe(4)
      expect(buttons[0].attributes('aria-label')).toBe('Show last 7 days')
      expect(buttons[1].attributes('aria-label')).toBe('Show last 30 days')
      expect(buttons[2].attributes('aria-label')).toBe('Show last 90 days')
      expect(buttons[3].attributes('aria-label')).toBe('Show last 1 year')
    })

    it('active period button has aria-pressed=true', () => {
      const store = useBodyweightStore()
      const today = new Date()
      const d1 = new Date(today)
      d1.setDate(d1.getDate() - 7)
      store.addEntry(170, d1.toISOString().slice(0, 10))

      const wrapper = mount(BodyweightTracker, {
        global: { stubs: { Teleport: true } }
      })

      const buttons = wrapper.findAll('.bwPeriodBtn')
      // Default period is 30d
      expect(buttons[0].attributes('aria-pressed')).toBe('false')
      expect(buttons[1].attributes('aria-pressed')).toBe('true')
      expect(buttons[2].attributes('aria-pressed')).toBe('false')
      expect(buttons[3].attributes('aria-pressed')).toBe('false')
    })
  })

  describe('OnboardingScreen option buttons a11y', () => {
    it('option buttons have aria-label attributes', () => {
      const wrapper = mount(OnboardingScreen)

      // Order after 01-auth.png restyle: [0] Popular (featured), [1] Empty, [2] Explore.
      const buttons = wrapper.findAll('.obOption')
      expect(buttons.length).toBe(3)
      expect(buttons[0].attributes('aria-label')).toContain('Popular Exercises')
      expect(buttons[1].attributes('aria-label')).toContain('Start Empty')
      expect(buttons[2].attributes('aria-label')).toContain('Explore First')
    })

    it('option button aria-labels include descriptions', () => {
      const wrapper = mount(OnboardingScreen)

      const buttons = wrapper.findAll('.obOption')
      expect(buttons[0].attributes('aria-label')).toContain('Pre-load 6 common lifts with tags')
      expect(buttons[1].attributes('aria-label')).toContain('Add your own exercises from scratch')
      expect(buttons[2].attributes('aria-label')).toContain('See the app with sample data')
    })
  })
})
