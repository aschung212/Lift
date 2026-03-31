import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { useSwipeToDismiss } from '../useSwipeToDismiss'

// Helper to create touch events
function createTouchEvent(type: string, clientY: number): TouchEvent {
  return new TouchEvent(type, {
    touches: type === 'touchend' ? [] : [{ clientY, clientX: 0 } as Touch],
    changedTouches: [{ clientY, clientX: 0 } as Touch],
    bubbles: true,
    cancelable: true,
  })
}

// Helper component that mounts the composable and exposes a target element
function createWrapper(options: { threshold?: number; onDismiss: () => void }) {
  const Comp = defineComponent({
    setup() {
      const swipe = useSwipeToDismiss({
        threshold: options.threshold,
        onDismiss: options.onDismiss,
      })
      return { ...swipe }
    },
    mounted() {
      this.attach(this.$refs.target as HTMLElement)
    },
    template: '<div ref="target" style="height:400px">content</div>',
  })
  return mount(Comp, { attachTo: document.body })
}

describe('useSwipeToDismiss', () => {
  let onDismiss: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onDismiss = vi.fn()
  })

  it('starts with zero offset and not dragging', () => {
    const wrapper = createWrapper({ onDismiss })
    expect(wrapper.vm.offsetY).toBe(0)
    expect(wrapper.vm.isDragging).toBe(false)
    wrapper.unmount()
  })

  it('returns empty drag style when offset is zero', () => {
    const wrapper = createWrapper({ onDismiss })
    expect(wrapper.vm.dragStyle()).toEqual({})
    wrapper.unmount()
  })

  it('sets isDragging on touchstart', () => {
    const wrapper = createWrapper({ onDismiss })
    const el = wrapper.element as HTMLElement

    el.dispatchEvent(createTouchEvent('touchstart', 100))
    expect(wrapper.vm.isDragging).toBe(true)
    wrapper.unmount()
  })

  it('tracks downward drag offset on touchmove', () => {
    const wrapper = createWrapper({ onDismiss })
    const el = wrapper.element as HTMLElement

    el.dispatchEvent(createTouchEvent('touchstart', 100))
    el.dispatchEvent(createTouchEvent('touchmove', 150))
    expect(wrapper.vm.offsetY).toBe(50)
    wrapper.unmount()
  })

  it('clamps offset to zero for upward drags', () => {
    const wrapper = createWrapper({ onDismiss })
    const el = wrapper.element as HTMLElement

    el.dispatchEvent(createTouchEvent('touchstart', 100))
    el.dispatchEvent(createTouchEvent('touchmove', 50))
    expect(wrapper.vm.offsetY).toBe(0)
    wrapper.unmount()
  })

  it('returns transform style when offset is positive', () => {
    const wrapper = createWrapper({ onDismiss })
    const el = wrapper.element as HTMLElement

    el.dispatchEvent(createTouchEvent('touchstart', 100))
    el.dispatchEvent(createTouchEvent('touchmove', 160))
    expect(wrapper.vm.dragStyle()).toEqual({ transform: 'translateY(60px)' })
    wrapper.unmount()
  })

  it('snaps back when drag does not exceed threshold', () => {
    const wrapper = createWrapper({ onDismiss, threshold: 80 })
    const el = wrapper.element as HTMLElement

    el.dispatchEvent(createTouchEvent('touchstart', 100))
    el.dispatchEvent(createTouchEvent('touchmove', 130))
    el.dispatchEvent(createTouchEvent('touchend', 130))

    // Should snap back to 0
    expect(wrapper.vm.offsetY).toBe(0)
    expect(onDismiss).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('dismisses when drag exceeds threshold', () => {
    const wrapper = createWrapper({ onDismiss, threshold: 80 })
    const el = wrapper.element as HTMLElement

    // Mock offsetHeight since jsdom returns 0
    Object.defineProperty(el, 'offsetHeight', { value: 400, writable: true })

    el.dispatchEvent(createTouchEvent('touchstart', 100))
    el.dispatchEvent(createTouchEvent('touchmove', 200))
    el.dispatchEvent(createTouchEvent('touchend', 200))

    // Offset should be set to element height (animating out)
    expect(wrapper.vm.offsetY).toBe(400)

    // Simulate transitionend to trigger dismiss
    el.dispatchEvent(new Event('transitionend'))
    expect(onDismiss).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('does not start drag if element is scrolled down', () => {
    const wrapper = createWrapper({ onDismiss })
    const el = wrapper.element as HTMLElement

    // Simulate scrolled content
    Object.defineProperty(el, 'scrollTop', { value: 50, writable: true })

    el.dispatchEvent(createTouchEvent('touchstart', 100))
    expect(wrapper.vm.isDragging).toBe(false)

    el.dispatchEvent(createTouchEvent('touchmove', 200))
    expect(wrapper.vm.offsetY).toBe(0)
    wrapper.unmount()
  })

  it('detach resets state and removes listeners', () => {
    const wrapper = createWrapper({ onDismiss })
    const el = wrapper.element as HTMLElement

    // Start a drag
    el.dispatchEvent(createTouchEvent('touchstart', 100))
    el.dispatchEvent(createTouchEvent('touchmove', 150))
    expect(wrapper.vm.offsetY).toBe(50)

    // Detach
    wrapper.vm.detach()
    expect(wrapper.vm.offsetY).toBe(0)
    expect(wrapper.vm.isDragging).toBe(false)

    // Events should no longer be tracked
    el.dispatchEvent(createTouchEvent('touchstart', 100))
    expect(wrapper.vm.isDragging).toBe(false)
    wrapper.unmount()
  })

  it('uses default threshold of 80px', () => {
    const wrapper = createWrapper({ onDismiss })
    const el = wrapper.element as HTMLElement

    // Drag 79px — should snap back (below default threshold)
    el.dispatchEvent(createTouchEvent('touchstart', 100))
    el.dispatchEvent(createTouchEvent('touchmove', 179))
    el.dispatchEvent(createTouchEvent('touchend', 179))
    expect(onDismiss).not.toHaveBeenCalled()
    expect(wrapper.vm.offsetY).toBe(0)

    wrapper.unmount()
  })

  it('cleans up on unmount', () => {
    const wrapper = createWrapper({ onDismiss })
    const el = wrapper.element as HTMLElement

    wrapper.unmount()

    // After unmount, dispatching touch events should not affect anything
    el.dispatchEvent(createTouchEvent('touchstart', 100))
    el.dispatchEvent(createTouchEvent('touchmove', 200))
    el.dispatchEvent(createTouchEvent('touchend', 200))
    // No crash = success; onDismiss should not be called
    expect(onDismiss).not.toHaveBeenCalled()
  })
})
