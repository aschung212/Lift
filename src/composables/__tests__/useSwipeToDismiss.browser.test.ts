import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { onMounted } from 'vue'
import { useSwipeToDismiss, type UseSwipeToDismissReturn } from '../useSwipeToDismiss'
import { mountComposable } from './browserMount'

/**
 * Browser-mode tests for useSwipeToDismiss.
 *
 * The happy-dom suite (useSwipeToDismiss.test.ts) has to fake `scrollTop` and
 * `offsetHeight` with Object.defineProperty because happy-dom reports them as
 * 0. Here we run in real Chromium against a genuinely scrollable container, so
 * the gesture's scroll-aware guard and animate-out height come from actual
 * layout — the behavior that ships to iOS.
 */

// Real Chromium requires genuine Touch objects (with a target), unlike
// happy-dom which accepts plain literals.
function createTouchEvent(type: string, clientY: number, target: EventTarget): TouchEvent {
  const touch = new Touch({ identifier: 0, target, clientX: 0, clientY })
  return new TouchEvent(type, {
    touches: type === 'touchend' ? [] : [touch],
    changedTouches: [touch],
    bubbles: true,
    cancelable: true,
  })
}

// A real, scrollable bottom-sheet: 200px viewport wrapping 1000px of content.
function createScrollContainer(): HTMLElement {
  const el = document.createElement('div')
  el.style.cssText = 'height:200px;overflow:auto;'
  const inner = document.createElement('div')
  inner.style.height = '1000px'
  inner.textContent = 'tall content'
  el.appendChild(inner)
  document.body.appendChild(el)
  return el
}

describe('useSwipeToDismiss (browser)', () => {
  let onDismiss: () => void
  let container: HTMLElement | null = null
  let mounted: { exposed: UseSwipeToDismissReturn; unmount: () => void } | null = null

  function mountSwipe(el: HTMLElement, threshold?: number) {
    mounted = mountComposable<UseSwipeToDismissReturn>(() => {
      const swipe = useSwipeToDismiss({ threshold, onDismiss })
      onMounted(() => swipe.attach(el))
      return swipe
    })
    return mounted.exposed
  }

  beforeEach(() => {
    onDismiss = vi.fn()
  })

  afterEach(() => {
    mounted?.unmount()
    mounted = null
    container?.remove()
    container = null
  })

  it('reads real scrollTop: drag-to-dismiss is blocked while content is scrolled', () => {
    container = createScrollContainer()
    // Genuinely scroll the container — no Object.defineProperty mock.
    container.scrollTop = 120
    expect(container.scrollTop).toBeGreaterThan(0) // proves real layout, not a stub

    const exposed = mountSwipe(container, 80)
    container.dispatchEvent(createTouchEvent('touchstart', 100, container))
    container.dispatchEvent(createTouchEvent('touchmove', 250, container))

    // Because scrollTop > 0, the gesture must not begin dragging the sheet.
    expect(exposed.isDragging.value).toBe(false)
    expect(exposed.offsetY.value).toBe(0)
  })

  it('begins dragging once the container is scrolled back to the top', () => {
    container = createScrollContainer()
    container.scrollTop = 0

    const exposed = mountSwipe(container, 80)
    container.dispatchEvent(createTouchEvent('touchstart', 100, container))
    container.dispatchEvent(createTouchEvent('touchmove', 160, container))

    expect(exposed.isDragging.value).toBe(true)
    expect(exposed.offsetY.value).toBe(60)
  })

  it('animates out to the real rendered height when dismissed past threshold', () => {
    container = createScrollContainer()
    // Real offsetHeight from layout — should equal the 200px viewport box.
    expect(container.offsetHeight).toBe(200)

    const exposed = mountSwipe(container, 80)
    container.dispatchEvent(createTouchEvent('touchstart', 100, container))
    container.dispatchEvent(createTouchEvent('touchmove', 200, container))
    container.dispatchEvent(createTouchEvent('touchend', 200, container))

    // offsetY is set to the element's real offsetHeight to slide it off-screen.
    expect(exposed.offsetY.value).toBe(200)

    container.dispatchEvent(new Event('transitionend'))
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
