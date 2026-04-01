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
 */
export function useSwipeToDismiss(options: SwipeToDismissOptions) {
  const { threshold = 80, onDismiss, direction = 'down' } = options

  const el = ref<HTMLElement | null>(null) as Ref<HTMLElement | null>
  const offsetY = ref(0)
  const isDragging = ref(false)

  let startY = 0
  let startTime = 0
  let currentY = 0
  let tracking = false // tracking touch but not yet committed to drag

  function onTouchStart(e: TouchEvent) {
    const target = el.value
    if (!target) return

    startY = e.touches[0].clientY
    startTime = Date.now()
    currentY = startY
    isDragging.value = false
    // Always track — we decide in onTouchMove whether this becomes a drag
    tracking = true
  }

  function onTouchMove(e: TouchEvent) {
    if (!tracking) return

    const target = el.value
    if (!target) return

    currentY = e.touches[0].clientY
    const delta = currentY - startY

    if (!isDragging.value) {
      // Not yet dragging — decide if we should start
      if (direction === 'down' && delta > 0 && target.scrollTop <= 0) {
        // User is pulling down and content is at the top — start drag
        isDragging.value = true
        target.style.transition = 'none'
      } else {
        // Let native scroll handle it
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

    const target = el.value
    if (!target) return

    const delta = currentY - startY
    const elapsed = Date.now() - startTime
    const velocity = delta / Math.max(elapsed, 1) // px/ms

    // Dismiss if dragged past threshold OR fast flick (velocity > 0.5 px/ms)
    if ((direction === 'down' && delta > threshold) || (direction === 'down' && velocity > 0.5 && delta > 20)) {
      // Animate out
      target.style.transition = 'transform 0.15s ease-in'
      offsetY.value = target.offsetHeight
      target.addEventListener('transitionend', () => {
        onDismiss()
        offsetY.value = 0
      }, { once: true })
    } else {
      // Snap back
      target.style.transition = 'transform 0.2s ease-out'
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

  function attach(element: HTMLElement) {
    if (boundEl) unbindEvents(boundEl)
    el.value = element
    boundEl = element
    bindEvents(element)
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
