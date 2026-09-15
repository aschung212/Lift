import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount, type VueWrapper } from '@vue/test-utils'
import { runComponentAxe } from '../../__tests__/axeHelper'

/**
 * AuthScreen (#1430): the password-reset-by-code flow and the native auth
 * surface. Sits beside AuthScreen.test.ts, which covers sign-in / sign-up and
 * addresses the sign-up toggle as `.authModeSwitch` — which is why the three
 * text links carry distinct classes.
 */

// Getters so a test can flip the platform after the mock is hoisted.
const platform = vi.hoisted(() => ({ native: false }))
vi.mock('../../lib/platform', () => ({
  get isNative() { return platform.native },
  get isIOS() { return platform.native },
  get platform() { return platform.native ? 'ios' : 'web' },
}))

const auth = vi.hoisted(() => ({
  signInWithProvider: vi.fn(async () => ({ error: null })),
  signInWithEmail: vi.fn(async () => ({ error: null })),
  signUp: vi.fn(async () => ({ error: null, needsConfirmation: false })),
  continueAsGuest: vi.fn(),
  requestPasswordReset: vi.fn(async () => ({ error: null })),
  confirmPasswordReset: vi.fn(async () => ({ error: null })),
}))
vi.mock('../../composables/useAuth', () => ({ useAuth: () => auth }))
vi.mock('../../composables/useAnalytics', () => ({
  useAnalytics: () => ({ logEvent: vi.fn(), tabSwitch: vi.fn(), flushEngagement: vi.fn() }),
}))

import AuthScreen from '../../views/AuthScreen.vue'

enableAutoUnmount(afterEach)

function mountScreen(): VueWrapper {
  return mount(AuthScreen, { attachTo: document.body })
}
const button = (w: VueWrapper, text: string) => w.findAll('button').find(b => b.text() === text)

/** Type an email and tap Forgot password — the reset form is then showing. */
async function enterResetMode(w: VueWrapper, email = 'a@b.co') {
  await w.find('input[type="email"]').setValue(email)
  await button(w, 'Forgot password?')!.trigger('click')
  await flushPromises()
}

describe('AuthScreen', () => {
  beforeEach(() => {
    platform.native = false
    for (const fn of Object.values(auth)) fn.mockClear()
    auth.requestPasswordReset.mockResolvedValue({ error: null })
    auth.confirmPasswordReset.mockResolvedValue({ error: null })
  })

  describe('third-party sign-in is web-only until #1426 / #542', () => {
    it('web: the Google button and its divider render', () => {
      const w = mountScreen()
      expect(w.find('.authGoogle').exists()).toBe(true)
      expect(w.find('.authDivider').exists()).toBe(true)
    })

    it('native: neither renders, while email/password and guest stay', () => {
      platform.native = true
      const w = mountScreen()
      expect(w.find('.authGoogle').exists()).toBe(false)
      expect(w.find('.authDivider').exists()).toBe(false)
      expect(w.find('input[type="email"]').exists()).toBe(true)
      expect(w.find('input[type="password"]').exists()).toBe(true)
      expect(w.find('.authGuestBtn').exists()).toBe(true)
    })
  })

  describe('forgot password (#1430)', () => {
    it('is offered in sign-in mode only', async () => {
      const w = mountScreen()
      expect(button(w, 'Forgot password?')).toBeDefined()
      await button(w, "Don't have an account? Sign up")!.trigger('click')
      expect(button(w, 'Forgot password?')).toBeUndefined()
    })

    it('with no email typed, explains instead of sending', async () => {
      const w = mountScreen()
      await button(w, 'Forgot password?')!.trigger('click')
      await flushPromises()
      expect(auth.requestPasswordReset).not.toHaveBeenCalled()
      const msg = w.find('.authMessage')
      expect(msg.text()).toMatch(/enter your email/i)
      expect(msg.classes()).toContain('authError')
      expect(w.find('input[autocomplete="one-time-code"]').exists()).toBe(false)
    })

    it('sends the code to the typed email and switches to the code form', async () => {
      const w = mountScreen()
      await enterResetMode(w)
      expect(auth.requestPasswordReset).toHaveBeenCalledWith('a@b.co')
      expect(w.find('input[autocomplete="one-time-code"]').exists()).toBe(true)
      expect(w.find('input[autocomplete="new-password"]').exists()).toBe(true)
      expect(w.find('#auth-reset-hint').text()).toContain('a@b.co')
      // The sign-in form and the providers step aside; guest stays reachable.
      expect(w.find('input[type="email"]').exists()).toBe(false)
      expect(w.find('.authGoogle').exists()).toBe(false)
      expect(w.find('.authGuestBtn').exists()).toBe(true)
    })

    it('surfaces a request error and stays on the sign-in form', async () => {
      auth.requestPasswordReset.mockResolvedValueOnce({ error: { message: 'Email rate limit exceeded' } })
      const w = mountScreen()
      await enterResetMode(w)
      expect(w.find('.authMessage').text()).toBe('Email rate limit exceeded')
      expect(w.find('input[autocomplete="one-time-code"]').exists()).toBe(false)
      expect(w.find('input[type="email"]').exists()).toBe(true)
    })

    it('submits code + new password for the same email, then reports success', async () => {
      const w = mountScreen()
      await enterResetMode(w)
      await w.find('input[autocomplete="one-time-code"]').setValue('123456')
      await w.find('input[autocomplete="new-password"]').setValue('hunter22')
      await w.find('form').trigger('submit')
      await flushPromises()
      expect(auth.confirmPasswordReset).toHaveBeenCalledWith('a@b.co', '123456', 'hunter22')
      const msg = w.find('.authMessage')
      expect(msg.text()).toBe('Password updated.')
      expect(msg.classes()).toContain('authSuccess')
    })

    it('a bad code shows the error and keeps the form for another try', async () => {
      auth.confirmPasswordReset.mockResolvedValueOnce({ error: { message: 'Token has expired or is invalid' } })
      const w = mountScreen()
      await enterResetMode(w)
      await w.find('input[autocomplete="one-time-code"]').setValue('000000')
      await w.find('input[autocomplete="new-password"]').setValue('hunter22')
      await w.find('form').trigger('submit')
      await flushPromises()
      expect(w.find('.authMessage').text()).toBe('Token has expired or is invalid')
      expect(w.find('input[autocomplete="one-time-code"]').exists()).toBe(true)
      expect(w.find('input[autocomplete="one-time-code"]').attributes('aria-describedby')).toBe('auth-error')
    })

    it('Back to sign in returns to the sign-in form with the email kept', async () => {
      const w = mountScreen()
      await enterResetMode(w)
      await button(w, 'Back to sign in')!.trigger('click')
      expect(w.find('input[autocomplete="one-time-code"]').exists()).toBe(false)
      expect((w.find('input[type="email"]').element as HTMLInputElement).value).toBe('a@b.co')
      expect(w.find('.authMessage').exists()).toBe(false)
    })

    it('the code form has no axe violations', async () => {
      const w = mountScreen()
      await enterResetMode(w)
      const results = await runComponentAxe(w.element)
      expect(results).toHaveNoViolations()
    })
  })
})
