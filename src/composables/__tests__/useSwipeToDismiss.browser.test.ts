/* eslint-disable vue/one-component-per-file -- throwaway harness components defined inline per test */
/**
 * Browser-mode counterpart to useSwipeToDismiss.test.ts (LIFT-666).
 *
 * The happy-dom suite has to fake the very geometry this gesture depends on —
 * it does `Object.defineProperty(el, 'offsetHeight', { value: 400 })` and
 * `Object.defineProperty(el, 'scrollTop', { value: 50 })` because happy-dom
 * reports 0 for both. Those tests therefore prove the wiring but not that the
 * gesture reacts to REAL layout.
 *
 * This file runs under vitest.browser.config.js in a real Chromium (Playwright
 * provider), so offsetHeight and scrollTop are measured from actual rendered
 * layout. Nothing here mocks geometry: the container is given a real fixed
 * height with overflowing content and is scrolled for real.
 *
 * Run with: npm run test:browser  (see docs/browser-mode-testing.md)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import { useSwipeToDismiss } from '../useSwipeToDismiss'

function createTouchEvent(type: string, clientY: number): TouchEvent {
  return new TouchEvent(type, {
    touches: type === 'touchend' ? [] : [{ clientY, clientX: 0 } as Touch],
    changedTouches: [{ clientY, clientX: 0 } as Touch],
    bubbles: true,
    cancelable: true,
  })
}

// A bottom-sheet-shaped harness: a fixed-height, real-overflow container whose
// inner content is taller than the viewport of the sheet, so scrollTop is a
// genuine, browser-computed value.
function createSheet(options: { threshold?: number; onDismiss: () => void }) {
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
    template: `
      <div
        ref="target"
        style="height:300px;overflow:auto;-webkit-overflow-scrolling:touch"
      >
        <div style="height:1200px">tall scrollable content</div>
      </div>
    `,
  })
  return mount(Comp, { attachTo: document.body })
}

describe('useSwipeToDismiss (browser mode — real layout)', () => {
  let onDismiss: () => void

  beforeEach(() => {
    onDismiss = vi.fn()
  })

  it('measures a real, non-zero offsetHeight to animate out on dismiss', async () => {
    const wrapper = createSheet({ onDismiss, threshold: 80 })
    await nextTick()
    const el = wrapper.element as HTMLElement

    // Real browser layout — no offsetHeight mock. happy-dom would report 0 here.
    expect(el.offsetHeight).toBe(300)

    el.dispatchEvent(createTouchEvent('touchstart', 100))
    el.dispatchEvent(createTouchEvent('touchmove', 220)) // 120px > 80 threshold
    el.dispatchEvent(createTouchEvent('touchend', 220))

    // Animate-out sets offset to the element's *measured* height.
    expect(wrapper.vm.offsetY).toBe(el.offsetHeight)
    expect(wrapper.vm.offsetY).toBe(300)

    el.dispatchEvent(new Event('transitionend'))
    expect(onDismiss).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('starts a drag when the sheet is really scrolled to the top', async () => {
    const wrapper = createSheet({ onDismiss })
    await nextTick()
    const el = wrapper.element as HTMLElement

    expect(el.scrollTop).toBe(0) // real measurement, not a defineProperty stub

    el.dispatchEvent(createTouchEvent('touchstart', 100))
    el.dispatchEvent(createTouchEvent('touchmove', 150))

    expect(wrapper.vm.isDragging).toBe(true)
    expect(wrapper.vm.offsetY).toBe(50)
    wrapper.unmount()
  })

  it('suppresses the drag when the sheet is really scrolled down', async () => {
    const wrapper = createSheet({ onDismiss })
    await nextTick()
    const el = wrapper.element as HTMLElement

    // Scroll for real — the browser honors this because the content overflows.
    el.scrollTop = 120
    await nextTick()
    expect(el.scrollTop).toBeGreaterThan(0)

    el.dispatchEvent(createTouchEvent('touchstart', 100))
    el.dispatchEvent(createTouchEvent('touchmove', 200))

    // scrollTop > 0 means the user is scrolling content, not dismissing.
    expect(wrapper.vm.isDragging).toBe(false)
    expect(wrapper.vm.offsetY).toBe(0)
    expect(onDismiss).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
