import { ref, onUnmounted, type Ref } from 'vue'

interface SwipeToDismissOptions {
  /** Minimum distance (px) to trigger dismiss. Default: 80 */
  threshold?: number
  /** Called when swipe exceeds threshold */
  onDismiss: () => void
  /** Direction of dismissal. Default: 'down' */
  direction?: 'down'
}

/**
 * Adds swipe-to-dismiss touch gesture to a bottom sheet or modal.
 * Returns refs for the container element and current drag offset,
 * plus a style binding for the transform.
 *
 * `attach(container)` — binds touch events to the container itself.
 * `attach(container, handle)` — binds touch events only to the handle
 * element while using the container for scroll checks and animation.
 * The second form avoids interfering with native scroll inside the container.
 */
export interface UseSwipeToDismissReturn {
  offsetY: Ref<number>
  isDragging: Ref<boolean>
  attach: (container: HTMLElement, handle?: HTMLElement) => void
  detach: () => void
  dragStyle: () => { transform?: string }
}

export function useSwipeToDismiss(options: SwipeToDismissOptions): UseSwipeToDismissReturn {
  const { threshold = 80, onDismiss, direction = 'down' } = options

  const el = ref<HTMLElement | null>(null) as Ref<HTMLElement | null>
  const offsetY = ref(0)
  const isDragging = ref(false)

  let startY = 0
  let startTime = 0
  let currentY = 0
  let tracking = false

  function onTouchStart(e: TouchEvent) {
    const container = el.value
    if (!container) return

    startY = e.touches[0].clientY
    startTime = Date.now()
    currentY = startY
    isDragging.value = false
    tracking = true
  }

  function onTouchMove(e: TouchEvent) {
    if (!tracking) return

    const container = el.value
    if (!container) return

    currentY = e.touches[0].clientY
    const delta = currentY - startY

    if (!isDragging.value) {
      if (direction === 'down' && delta > 0 && container.scrollTop <= 0) {
        isDragging.value = true
        container.style.transition = 'none'
      } else {
        return
      }
    }

    if (direction === 'down') {
      offsetY.value = Math.max(0, delta)
      if (delta > 0) {
        e.preventDefault()
      }
    }
  }

  function onTouchEnd() {
    tracking = false
    if (!isDragging.value) return
    isDragging.value = false

    const container = el.value
    if (!container) return

    const delta = currentY - startY
    const elapsed = Date.now() - startTime
    const velocity = delta / Math.max(elapsed, 1) // px/ms

    // Dismiss if dragged past threshold OR fast flick (velocity > 0.5 px/ms)
    if ((direction === 'down' && delta > threshold) || (direction === 'down' && velocity > 0.5 && delta > 20)) {
      // Animate out
      container.style.transition = 'transform 0.15s ease-in'
      offsetY.value = container.offsetHeight
      container.addEventListener('transitionend', () => {
        onDismiss()
        offsetY.value = 0
      }, { once: true })
    } else {
      // Snap back
      container.style.transition = 'transform 0.2s ease-out'
      offsetY.value = 0
    }
  }

  function bindEvents(element: HTMLElement) {
    element.addEventListener('touchstart', onTouchStart, { passive: true })
    element.addEventListener('touchmove', onTouchMove, { passive: false })
    element.addEventListener('touchend', onTouchEnd, { passive: true })
  }

  function unbindEvents(element: HTMLElement) {
    element.removeEventListener('touchstart', onTouchStart)
    element.removeEventListener('touchmove', onTouchMove)
    element.removeEventListener('touchend', onTouchEnd)
  }

  let boundEl: HTMLElement | null = null

  function attach(container: HTMLElement, handle?: HTMLElement) {
    if (boundEl) unbindEvents(boundEl)
    el.value = container
    const touchTarget = handle ?? container
    boundEl = touchTarget
    bindEvents(touchTarget)
  }

  function detach() {
    if (boundEl) {
      unbindEvents(boundEl)
      boundEl = null
    }
    el.value = null
    offsetY.value = 0
    isDragging.value = false
  }

  onUnmounted(() => {
    detach()
  })

  return {
    offsetY,
    isDragging,
    attach,
    detach,
    /** Computed inline style for the drag transform */
    dragStyle: () => offsetY.value > 0 ? { transform: `translateY(${offsetY.value}px)` } : {},
  }
}
