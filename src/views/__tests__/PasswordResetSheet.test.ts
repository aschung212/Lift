import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, enableAutoUnmount, type VueWrapper } from '@vue/test-utils'
import { runComponentAxe } from '../../__tests__/axeHelper'

/**
 * PasswordResetSheet (#1430): the web landing of an emailed reset link. The
 * session is already real when it mounts, so the sheet only has to set the
 * password — or step aside.
 */

const auth = vi.hoisted(() => ({
  user: { value: { id: 'u1', email: 'a@b.co' } as { id: string; email: string } | null },
  updatePassword: vi.fn(async () => ({ error: null as { message: string } | null })),
  clearPasswordRecovery: vi.fn(),
}))
vi.mock('../../composables/useAuth', () => ({ useAuth: () => auth }))

import PasswordResetSheet from '../PasswordResetSheet.vue'

enableAutoUnmount(afterEach)

function mountSheet(): VueWrapper {
  // Teleport stubbed so the dialog renders inside the wrapper (the SettingsSheet
  // convention); attachTo so useModal's selector lookup and axe see it.
  return mount(PasswordResetSheet, { attachTo: document.body, global: { stubs: { Teleport: true } } })
}

describe('PasswordResetSheet', () => {
  beforeEach(() => {
    auth.user.value = { id: 'u1', email: 'a@b.co' }
    auth.updatePassword.mockClear()
    auth.updatePassword.mockResolvedValue({ error: null })
    auth.clearPasswordRecovery.mockClear()
  })

  it('names the account, sets the password on submit, and closes', async () => {
    const w = mountSheet()
    expect(w.find('#passwordResetSub').text()).toContain('a@b.co')
    await w.find('input[type="password"]').setValue('hunter22')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(auth.updatePassword).toHaveBeenCalledWith('hunter22')
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('shows the error and stays open when the update fails', async () => {
    auth.updatePassword.mockResolvedValueOnce({ error: { message: 'Password should be at least 6 characters' } })
    const w = mountSheet()
    await w.find('input[type="password"]').setValue('short')
    await w.find('form').trigger('submit')
    await flushPromises()
    const err = w.find('#passwordResetError')
    expect(err.text()).toMatch(/at least 6/)
    expect(err.attributes('role')).toBe('alert')
    expect(w.find('input[type="password"]').attributes('aria-describedby')).toBe('passwordResetError')
    expect(w.emitted('close')).toBeUndefined()
  })

  it('"Not now" clears the pending recovery and closes without writing', async () => {
    const w = mountSheet()
    await w.findAll('button').find(b => b.text() === 'Not now')!.trigger('click')
    expect(auth.clearPasswordRecovery).toHaveBeenCalledTimes(1)
    expect(auth.updatePassword).not.toHaveBeenCalled()
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('is a useModal-owned dialog: background scroll locked while open, released on unmount', async () => {
    const w = mountSheet()
    await flushPromises()
    expect(w.find('[role="dialog"]').attributes('aria-modal')).toBe('true')
    expect(document.documentElement.classList.contains('modal-open')).toBe(true)
    w.unmount()
    expect(document.documentElement.classList.contains('modal-open')).toBe(false)
  })

  it('has no axe violations', async () => {
    const w = mountSheet()
    const results = await runComponentAxe(w.element)
    expect(results).toHaveNoViolations()
  })
})
