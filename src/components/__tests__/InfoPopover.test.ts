import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount, enableAutoUnmount, VueWrapper } from '@vue/test-utils'
import { defineComponent, h, onMounted, ref } from 'vue'
import InfoPopover from '../InfoPopover.vue'
import { useFocusTrap } from '../../composables/useFocusTrap'

enableAutoUnmount(afterEach)

const MARGIN = 12
const GAP = 8

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

  // LIFT-1264: happy-dom has no layout engine, so getBoundingClientRect reports
  // zeros — the vertical clamp is only exercisable with stubbed rects.
  describe('viewport clamping (LIFT-1264)', () => {
    const realRect = Element.prototype.getBoundingClientRect
    const realHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight')

    function rect(partial: Partial<DOMRect>): DOMRect {
      const base = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }
      const r = { ...base, ...partial }
      return { ...r, toJSON: () => r } as DOMRect
    }

    /** Fake a layout engine: the trigger sits where the test says, and the
     *  bubble measures the given height once mounted. */
    function stubLayout(opts: { viewportHeight: number; triggerTop: number; bubbleHeight: number }): void {
      Object.defineProperty(window, 'innerHeight', { value: opts.viewportHeight, configurable: true })
      Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
        if (this.classList.contains('infoPopoverBubble')) return rect({ height: opts.bubbleHeight })
        if (this.classList.contains('infoPopover')) {
          return rect({ top: opts.triggerTop, bottom: opts.triggerTop + 15, left: 100, width: 15 })
        }
        return rect({})
      }
    }

    afterEach(() => {
      Element.prototype.getBoundingClientRect = realRect
      if (realHeight) Object.defineProperty(window, 'innerHeight', realHeight)
    })

    async function openAndReadTop(): Promise<number> {
      const wrapper = mountPopover()
      await wrapper.get('button.infoPopover').trigger('click')
      const bubble = document.querySelector('.infoPopoverBubble') as HTMLElement
      expect(bubble).not.toBeNull()
      return parseFloat(bubble.style.top)
    }

    it('anchors below the trigger when the bubble fits', async () => {
      stubLayout({ viewportHeight: 667, triggerTop: 100, bubbleHeight: 90 })
      expect(await openAndReadTop()).toBe(100 + 15 + GAP)
    })

    it('flips above the trigger when the below-placement would run past the fold', async () => {
      // Trigger low on a short (iPhone SE) viewport: 615 + 15 + 8 + 90 = 728 > 667.
      stubLayout({ viewportHeight: 667, triggerTop: 615, bubbleHeight: 90 })
      expect(await openAndReadTop()).toBe(615 - GAP - 90)
    })

    it('clamps into the viewport when neither side has room', async () => {
      // A tall bubble with the trigger mid-screen: below overflows, and above
      // would land at a negative top.
      stubLayout({ viewportHeight: 667, triggerTop: 300, bubbleHeight: 500 })
      const top = await openAndReadTop()
      expect(top).toBe(667 - MARGIN - 500)
      expect(top).toBeGreaterThanOrEqual(MARGIN)
    })

    it('never positions above the top margin, even for a bubble taller than the viewport', async () => {
      stubLayout({ viewportHeight: 667, triggerTop: 300, bubbleHeight: 900 })
      expect(await openAndReadTop()).toBe(MARGIN)
    })

    it('keeps the below-placement when the bubble height is unmeasurable', async () => {
      stubLayout({ viewportHeight: 667, triggerTop: 640, bubbleHeight: 0 })
      expect(await openAndReadTop()).toBe(640 + 15 + GAP)
    })
  })

  it('removes its global listeners on unmount so it cannot fire on a dead component', async () => {
    const wrapper = mountPopover()
    await wrapper.get('button.infoPopover').trigger('click')
    wrapper.unmount()
    // A stray scroll after unmount must not throw or resurrect the bubble.
    window.dispatchEvent(new Event('scroll'))
    expect(document.querySelector('.infoPopoverBubble')).toBeNull()
  })

  it('registers its scroll/resize dismiss listeners as passive (LIFT-1238)', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const wrapper = mountPopover()
    await wrapper.get('button.infoPopover').trigger('click')

    // `close` never calls preventDefault, so a non-passive listener would make
    // the compositor block on the main thread for every scroll frame.
    const scroll = addSpy.mock.calls.find(([type]) => type === 'scroll')
    expect(scroll?.[2]).toMatchObject({ passive: true, capture: true })

    const resize = addSpy.mock.calls.find(([type]) => type === 'resize')
    expect(resize?.[2]).toMatchObject({ passive: true })
    addSpy.mockRestore()
  })

  it('still detaches the passive scroll listener on close', async () => {
    const wrapper = mountPopover()
    const trigger = wrapper.get('button.infoPopover')
    await trigger.trigger('click')
    expect(document.querySelector('.infoPopoverBubble')).not.toBeNull()

    // Closes via the scroll dismiss path...
    window.dispatchEvent(new Event('scroll'))
    await wrapper.vm.$nextTick()
    expect(document.querySelector('.infoPopoverBubble')).toBeNull()

    // ...and the removal must have matched on the capture flag, so re-opening
    // registers exactly one listener rather than stacking a leaked duplicate.
    const addSpy = vi.spyOn(window, 'addEventListener')
    await trigger.trigger('click')
    expect(addSpy.mock.calls.filter(([type]) => type === 'scroll')).toHaveLength(1)
    addSpy.mockRestore()
  })
})
