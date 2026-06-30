import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AiCoachConsentModal from '../AiCoachConsentModal.vue'

function mountOpen(props: Record<string, unknown> = {}) {
  return mount(AiCoachConsentModal, {
    props: { open: true, ...props },
    global: { stubs: { Teleport: true } },
  })
}

describe('AiCoachConsentModal (LIFT-849)', () => {
  it('renders nothing when closed', () => {
    const wrapper = mount(AiCoachConsentModal, {
      props: { open: false },
      global: { stubs: { Teleport: true } },
    })
    expect(wrapper.find('[aria-labelledby="ai-consent-title"]').exists()).toBe(false)
  })

  it('names Anthropic and lists what is sent', () => {
    const wrapper = mountOpen()
    const text = wrapper.text()
    expect(text).toContain('Anthropic')
    expect(text.toLowerCase()).toContain('set log')
  })

  it('emits accept with bodyweightOptOut=false by default (bodyweight included)', async () => {
    const wrapper = mountOpen()
    await wrapper.get('.repMaxBtnCalc').trigger('click')
    expect(wrapper.emitted('accept')).toBeTruthy()
    expect(wrapper.emitted('accept')![0]).toEqual([false])
  })

  it('toggling the bodyweight switch sends opt-out=true on accept', async () => {
    const wrapper = mountOpen()
    await wrapper.get('[role="switch"]').trigger('click')
    await wrapper.get('.repMaxBtnCalc').trigger('click')
    expect(wrapper.emitted('accept')![0]).toEqual([true])
  })

  it('seeds the bodyweight toggle from the stored opt-out preference', async () => {
    const wrapper = mountOpen({ bodyweightOptOut: true })
    // toggle starts in the opted-out (off) state → switch aria-checked is false
    expect(wrapper.get('[role="switch"]').attributes('aria-checked')).toBe('false')
    // hides the "Your bodyweight trend" bullet when already opted out
    expect(wrapper.text()).not.toContain('Your bodyweight trend')
  })

  it('emits decline on "Not now"', async () => {
    const wrapper = mountOpen()
    await wrapper.get('.repMaxBtnClose').trigger('click')
    expect(wrapper.emitted('decline')).toBeTruthy()
  })

  it('emits view-privacy when the policy link is tapped', async () => {
    const wrapper = mountOpen()
    await wrapper.get('.aiConsentLink').trigger('click')
    expect(wrapper.emitted('view-privacy')).toBeTruthy()
  })
})
