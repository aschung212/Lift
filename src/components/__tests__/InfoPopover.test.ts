import { describe, it, expect, afterEach } from 'vitest'
import { mount, enableAutoUnmount, VueWrapper } from '@vue/test-utils'
import InfoPopover from '../InfoPopover.vue'

enableAutoUnmount(afterEach)

function mountPopover(): VueWrapper {
  return mount(InfoPopover, {
    props: { label: 'e1RM', title: 'Estimated 1-rep max' },
    slots: { default: 'Your predicted max for a single all-out rep.' },
    attachTo: document.body,
  })
}

describe('InfoPopover (LIFT-1143)', () => {
  it('renders a labelled, collapsed trigger by default', () => {
    const wrapper = mountPopover()
    const trigger = wrapper.get('button.infoPopover')
    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(trigger.attributes('aria-haspopup')).toBe('dialog')
    expect(trigger.attributes('aria-label')).toContain('What is e1RM?')
    // No bubble until tapped — progressive disclosure.
    expect(document.querySelector('.infoPopoverBubble')).toBeNull()
  })

  it('reveals the explanation bubble on tap with the title and body', async () => {
    const wrapper = mountPopover()
    await wrapper.get('button.infoPopover').trigger('click')

    const bubble = document.querySelector('.infoPopoverBubble')
    expect(bubble).not.toBeNull()
    expect(bubble?.getAttribute('role')).toBe('dialog')
    expect(bubble?.getAttribute('aria-label')).toBe('Estimated 1-rep max')
    expect(bubble?.textContent).toContain('Estimated 1-rep max')
    expect(bubble?.textContent).toContain('predicted max for a single all-out rep')
    expect(wrapper.get('button.infoPopover').attributes('aria-expanded')).toBe('true')
  })

  it('toggles closed on a second tap', async () => {
    const wrapper = mountPopover()
    const trigger = wrapper.get('button.infoPopover')
    await trigger.trigger('click')
    expect(document.querySelector('.infoPopoverBubble')).not.toBeNull()
    await trigger.trigger('click')
    expect(document.querySelector('.infoPopoverBubble')).toBeNull()
    expect(trigger.attributes('aria-expanded')).toBe('false')
  })

  it('closes when the backdrop is tapped', async () => {
    const wrapper = mountPopover()
    await wrapper.get('button.infoPopover').trigger('click')
    const backdrop = document.querySelector('.infoPopoverBackdrop') as HTMLElement
    expect(backdrop).not.toBeNull()
    backdrop.click()
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.infoPopoverBubble')).toBeNull()
  })

  it('closes on Escape', async () => {
    const wrapper = mountPopover()
    await wrapper.get('button.infoPopover').trigger('click')
    expect(document.querySelector('.infoPopoverBubble')).not.toBeNull()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.infoPopoverBubble')).toBeNull()
  })

  it('removes its global listeners on unmount so it cannot fire on a dead component', async () => {
    const wrapper = mountPopover()
    await wrapper.get('button.infoPopover').trigger('click')
    wrapper.unmount()
    // A stray scroll after unmount must not throw or resurrect the bubble.
    window.dispatchEvent(new Event('scroll'))
    expect(document.querySelector('.infoPopoverBubble')).toBeNull()
  })
})
