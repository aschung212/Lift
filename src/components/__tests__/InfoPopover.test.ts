import { describe, it, expect, afterEach } from 'vitest'
import { mount, enableAutoUnmount, VueWrapper } from '@vue/test-utils'
import { defineComponent, h, onMounted, ref } from 'vue'
import InfoPopover from '../InfoPopover.vue'
import { useFocusTrap } from '../../composables/useFocusTrap'

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

  it('closes on Tab and returns focus to its trigger', async () => {
    const wrapper = mountPopover()
    const trigger = wrapper.get('button.infoPopover').element as HTMLElement
    await wrapper.get('button.infoPopover').trigger('click')
    expect(document.activeElement).toBe(document.querySelector('.infoPopoverBubble'))

    // Dispatch on the focused element, as a real browser does, so the event
    // walks the full path (window capture -> ... -> document bubble) and the
    // host trap's document-level handler actually gets a turn.
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(document.querySelector('.infoPopoverBubble')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  // LIFT-1266: the bubble is Teleported to <body>, so a host modal's focus trap
  // sees `!trapEl.contains(activeElement)` and yanks focus into the modal —
  // which sits *behind* the popover's own inert backdrop — while the dialog
  // stays open. Exercises the real useFocusTrap against the real component.
  it('does not strand focus inside a host modal when Tab is pressed', async () => {
    const Host = defineComponent({
      setup() {
        const trap = useFocusTrap()
        const modalEl = ref<HTMLElement | null>(null)
        onMounted(() => {
          if (modalEl.value) trap.activate(modalEl.value, { focusContainer: true })
        })
        return () =>
          h('div', { ref: modalEl, class: 'hostModal' }, [
            h('button', { class: 'hostFirst' }, 'First'),
            h(InfoPopover, { label: 'e1RM', title: 'Estimated 1-rep max' }, () => 'Explanation.'),
            h('button', { class: 'hostLast' }, 'Last'),
          ])
      },
    })

    const wrapper = mount(Host, { attachTo: document.body })
    const trigger = wrapper.get('button.infoPopover').element as HTMLElement
    await wrapper.get('button.infoPopover').trigger('click')
    expect(document.querySelector('.infoPopoverBubble')).not.toBeNull()

    // Dispatch on the focused element, as a real browser does, so the event
    // walks the full path (window capture -> ... -> document bubble) and the
    // host trap's document-level handler actually gets a turn.
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    await wrapper.vm.$nextTick()

    // Focus must not have been dumped on a control hidden behind the backdrop.
    expect(document.activeElement).not.toBe(wrapper.get('button.hostFirst').element)
    expect(document.activeElement).toBe(trigger)
    // ...and the dialog must not be left open and orphaned from focus.
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
