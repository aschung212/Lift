import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises, VueWrapper } from '@vue/test-utils'
import AuthScreen from '../../views/AuthScreen.vue'

// Mock auth composable
const mockSignInWithProvider = vi.fn().mockResolvedValue({ error: null })
const mockSignInWithEmail = vi.fn().mockResolvedValue({ error: null })
const mockSignUp = vi.fn().mockResolvedValue({ error: null, needsConfirmation: false })
const mockContinueAsGuest = vi.fn()
const mockDevSignIn = vi.fn()

vi.mock('../../composables/useAuth', () => ({
  useAuth: () => ({
    signInWithProvider: mockSignInWithProvider,
    signInWithEmail: mockSignInWithEmail,
    signUp: mockSignUp,
    continueAsGuest: mockContinueAsGuest,
    devSignIn: mockDevSignIn,
  })
}))

describe('AuthScreen', () => {
  let wrapper: VueWrapper

  beforeEach(() => {
    vi.clearAllMocks()
    wrapper = mount(AuthScreen)
  })

  describe('rendering', () => {
    it('displays the app name and tagline', () => {
      expect(wrapper.find('.authLogo').text()).toBe('Lift')
      expect(wrapper.find('.authTagline').text()).toContain('Track your sets')
    })

    it('renders email and password inputs', () => {
      const inputs = wrapper.findAll('.authInput')
      expect(inputs.length).toBe(2)
      expect(inputs[0].attributes('type')).toBe('email')
      expect(inputs[1].attributes('type')).toBe('password')
    })

    it('shows Sign In button by default', () => {
      expect(wrapper.find('.authSubmitBtn').text()).toBe('Sign In')
    })

    it('renders Google OAuth button', () => {
      expect(wrapper.find('.authGoogle').text()).toContain('Continue with Google')
    })

    it('has autocomplete attributes for accessibility', () => {
      const inputs = wrapper.findAll('.authInput')
      expect(inputs[0].attributes('autocomplete')).toBe('email')
      expect(inputs[1].attributes('autocomplete')).toBe('current-password')
    })
  })

  describe('mode toggling', () => {
    it('switches to sign-up mode when toggle is clicked', async () => {
      await wrapper.find('.authModeSwitch').trigger('click')
      expect(wrapper.find('.authSubmitBtn').text()).toBe('Create Account')
      expect(wrapper.find('.authModeSwitch').text()).toContain('Already have an account')
    })

    it('switches back to sign-in mode on second click', async () => {
      await wrapper.find('.authModeSwitch').trigger('click')
      await wrapper.find('.authModeSwitch').trigger('click')
      expect(wrapper.find('.authSubmitBtn').text()).toBe('Sign In')
    })

    it('clears message when switching modes', async () => {
      // Trigger an error first
      mockSignInWithEmail.mockResolvedValueOnce({ error: { message: 'Bad creds' } })
      await wrapper.find('input[type="email"]').setValue('test@test.com')
      await wrapper.find('input[type="password"]').setValue('wrong')
      await wrapper.find('form').trigger('submit')
      await flushPromises()
      expect(wrapper.find('.authMessage').exists()).toBe(true)

      // Toggle mode — message should clear
      await wrapper.find('.authModeSwitch').trigger('click')
      expect(wrapper.find('.authMessage').exists()).toBe(false)
    })
  })

  describe('email sign-in', () => {
    it('calls signInWithEmail on form submit', async () => {
      await wrapper.find('input[type="email"]').setValue('user@example.com')
      await wrapper.find('input[type="password"]').setValue('secret123')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(mockSignInWithEmail).toHaveBeenCalledWith('user@example.com', 'secret123')
    })

    it('displays error message on sign-in failure', async () => {
      mockSignInWithEmail.mockResolvedValueOnce({
        error: { message: 'Invalid login credentials' }
      })
      await wrapper.find('input[type="email"]').setValue('user@example.com')
      await wrapper.find('input[type="password"]').setValue('wrong')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      const msg = wrapper.find('.authMessage')
      expect(msg.exists()).toBe(true)
      expect(msg.classes()).toContain('authError')
      expect(msg.text()).toBe('Invalid login credentials')
    })

    it('re-enables submit button after completion', async () => {
      await wrapper.find('input[type="email"]').setValue('user@example.com')
      await wrapper.find('input[type="password"]').setValue('secret')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(wrapper.find('.authSubmitBtn').attributes('disabled')).toBeUndefined()
    })
  })

  describe('sign-up', () => {
    beforeEach(async () => {
      await wrapper.find('.authModeSwitch').trigger('click')
    })

    it('calls signUp on form submit in sign-up mode', async () => {
      await wrapper.find('input[type="email"]').setValue('new@example.com')
      await wrapper.find('input[type="password"]').setValue('newpass123')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(mockSignUp).toHaveBeenCalledWith('new@example.com', 'newpass123')
    })

    it('shows confirmation message when email verification needed', async () => {
      mockSignUp.mockResolvedValueOnce({ error: null, needsConfirmation: true })
      await wrapper.find('input[type="email"]').setValue('new@example.com')
      await wrapper.find('input[type="password"]').setValue('newpass123')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      const msg = wrapper.find('.authMessage')
      expect(msg.exists()).toBe(true)
      expect(msg.classes()).toContain('authSuccess')
      expect(msg.text()).toContain('Check your email')
    })

    it('switches to sign-in mode after successful sign-up with confirmation', async () => {
      mockSignUp.mockResolvedValueOnce({ error: null, needsConfirmation: true })
      await wrapper.find('input[type="email"]').setValue('new@example.com')
      await wrapper.find('input[type="password"]').setValue('newpass123')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      // Should now show "Sign In" since it flipped back
      expect(wrapper.find('.authSubmitBtn').text()).toBe('Sign In')
    })

    it('displays error on sign-up failure', async () => {
      mockSignUp.mockResolvedValueOnce({
        error: { message: 'An account with this email already exists.' },
        needsConfirmation: false
      })
      await wrapper.find('input[type="email"]').setValue('dup@example.com')
      await wrapper.find('input[type="password"]').setValue('pass123')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(wrapper.find('.authError').text()).toBe('An account with this email already exists.')
    })
  })

  describe('aria-invalid and aria-describedby (WCAG 3.3.1)', () => {
    it('inputs have no aria-invalid or aria-describedby by default', () => {
      const inputs = wrapper.findAll('.authInput')
      expect(inputs[0].attributes('aria-invalid')).toBeUndefined()
      expect(inputs[0].attributes('aria-describedby')).toBeUndefined()
      expect(inputs[1].attributes('aria-invalid')).toBeUndefined()
      expect(inputs[1].attributes('aria-describedby')).toBeUndefined()
    })

    it('sets aria-invalid and aria-describedby on both inputs when error occurs', async () => {
      mockSignInWithEmail.mockResolvedValueOnce({
        error: { message: 'Invalid login credentials' }
      })
      await wrapper.find('input[type="email"]').setValue('user@example.com')
      await wrapper.find('input[type="password"]').setValue('wrong')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      const inputs = wrapper.findAll('.authInput')
      expect(inputs[0].attributes('aria-invalid')).toBe('true')
      expect(inputs[0].attributes('aria-describedby')).toBe('auth-error')
      expect(inputs[1].attributes('aria-invalid')).toBe('true')
      expect(inputs[1].attributes('aria-describedby')).toBe('auth-error')
    })

    it('error message element has id="auth-error" when error is shown', async () => {
      mockSignInWithEmail.mockResolvedValueOnce({
        error: { message: 'Bad credentials' }
      })
      await wrapper.find('input[type="email"]').setValue('user@example.com')
      await wrapper.find('input[type="password"]').setValue('wrong')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      const msg = wrapper.find('.authMessage')
      expect(msg.attributes('id')).toBe('auth-error')
    })

    it('success message does not get id="auth-error"', async () => {
      await wrapper.find('.authModeSwitch').trigger('click')
      mockSignUp.mockResolvedValueOnce({ error: null, needsConfirmation: true })
      await wrapper.find('input[type="email"]').setValue('new@example.com')
      await wrapper.find('input[type="password"]').setValue('newpass123')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      const msg = wrapper.find('.authMessage')
      expect(msg.exists()).toBe(true)
      expect(msg.attributes('id')).toBeUndefined()
    })

    it('clears aria-invalid when a new submit starts', async () => {
      // First: trigger an error
      mockSignInWithEmail.mockResolvedValueOnce({
        error: { message: 'Bad' }
      })
      await wrapper.find('input[type="email"]').setValue('user@example.com')
      await wrapper.find('input[type="password"]').setValue('wrong')
      await wrapper.find('form').trigger('submit')
      await flushPromises()
      expect(wrapper.findAll('.authInput')[0].attributes('aria-invalid')).toBe('true')

      // Second: successful submit clears the error
      mockSignInWithEmail.mockResolvedValueOnce({ error: null })
      await wrapper.find('form').trigger('submit')
      await flushPromises()
      expect(wrapper.findAll('.authInput')[0].attributes('aria-invalid')).toBeUndefined()
    })
  })

  describe('continue without an account (LIFT-1083)', () => {
    it('renders a guest entry that defers sign-up', () => {
      const btn = wrapper.find('.authGuestBtn')
      expect(btn.exists()).toBe(true)
      expect(btn.text()).toBe('Continue without an account')
    })

    it('explains that local-only data can be backed up later', () => {
      const hint = wrapper.find('.authGuestHint')
      expect(hint.exists()).toBe(true)
      expect(hint.text()).toContain('this device')
    })

    it('enters guest mode when clicked', async () => {
      await wrapper.find('.authGuestBtn').trigger('click')
      expect(mockContinueAsGuest).toHaveBeenCalledOnce()
    })
  })

  describe('OAuth', () => {
    it('calls signInWithProvider when Google button is clicked', async () => {
      await wrapper.find('.authGoogle').trigger('click')
      expect(mockSignInWithProvider).toHaveBeenCalledWith('google')
    })

    it('displays error on OAuth failure', async () => {
      mockSignInWithProvider.mockResolvedValueOnce({
        error: { message: 'OAuth popup closed' }
      })
      await wrapper.find('.authGoogle').trigger('click')
      await flushPromises()

      expect(wrapper.find('.authError').text()).toBe('OAuth popup closed')
    })
  })
})
