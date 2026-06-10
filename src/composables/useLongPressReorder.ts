import { reactive, type Ref } from 'vue'

/**
 * Long-press-to-reorder gesture for a vertical list.
 *
 * Accidental reorders were common when a touchstart on the left-edge drag
 * handle fired immediately. Instead, the whole row is the handle and pickup
 * requires a ~400ms hold (matching iOS Reminders / Files / Music). Short taps
 * still propagate as clicks; scrolls past the move tolerance cancel the hold.
 *
 * The caller binds the returned handlers on each list item and renders drag
 * affordances from `dragState`. Indices are positions in the *rendered* list —
 * mapping them to any underlying store order is the caller's job (inside
 * `onReorder`).
 */

export interface LongPressReorderOptions {
  /** The list container; used to hit-test which item is under the pointer mid-drag. */
  listEl: Ref<HTMLElement | null>
  /** Selector matching the list's items inside `listEl`. */
  itemSelector: string
  /** Presses on (or inside) elements matching this never start a drag — e.g. per-row action buttons. */
  ignoreSelector?: string
  /** When true, the gesture is fully disabled (e.g. while the list is filtered). */
  disabled?: () => boolean
  /** Haptic/visual confirmation when the hold threshold fires and the row is picked up. */
  onPickup?: () => void
  /** Commit a completed drag. Only called when the drop position differs from the pickup position. */
  onReorder: (fromIndex: number, toIndex: number) => void
}

export interface DragState {
  dragging: boolean
  fromIndex: number
  overIndex: number
}

const LONG_PRESS_MS = 400
const MOVE_TOLERANCE_PX = 8
const SUPPRESS_CLICK_MS = 50

export function useLongPressReorder(options: LongPressReorderOptions) {
  const dragState = reactive<DragState>({ dragging: false, fromIndex: -1, overIndex: -1 })

  let longPressTimer: ReturnType<typeof setTimeout> | null = null
  let pressStartX = 0
  let pressStartY = 0
  let suppressClickUntil = 0

  function clearLongPress() {
    if (longPressTimer) {
      clearTimeout(longPressTimer)
      longPressTimer = null
    }
  }

  function shouldIgnorePressTarget(event: TouchEvent | MouseEvent): boolean {
    if (options.disabled?.()) return true
    const target = event.target as HTMLElement | null
    if (options.ignoreSelector && target?.closest(options.ignoreSelector)) return true
    return false
  }

  function getItemIndexFromPoint(clientY: number): number {
    const list = options.listEl.value
    if (!list) return -1
    const items = list.querySelectorAll(options.itemSelector)
    for (let i = 0; i < items.length; i++) {
      const rect = items[i].getBoundingClientRect()
      if (clientY >= rect.top && clientY <= rect.bottom) return i
      // If between items, snap to closest
      if (clientY < rect.top) return Math.max(0, i)
    }
    return items.length - 1
  }

  function onItemTouchStart(index: number, event: TouchEvent) {
    if (shouldIgnorePressTarget(event)) return
    const t = event.touches[0]
    if (!t) return
    pressStartX = t.clientX
    pressStartY = t.clientY
    clearLongPress()
    longPressTimer = setTimeout(() => {
      longPressTimer = null
      beginDrag(index)
    }, LONG_PRESS_MS)
  }

  function onItemTouchMove(event: TouchEvent) {
    if (!longPressTimer) return
    const t = event.touches[0]
    if (!t) return
    const dx = Math.abs(t.clientX - pressStartX)
    const dy = Math.abs(t.clientY - pressStartY)
    if (dx > MOVE_TOLERANCE_PX || dy > MOVE_TOLERANCE_PX) {
      clearLongPress()
    }
  }

  function onItemTouchEnd() {
    clearLongPress()
  }

  function onItemMouseDown(index: number, event: MouseEvent) {
    if (shouldIgnorePressTarget(event)) return
    pressStartX = event.clientX
    pressStartY = event.clientY
    clearLongPress()
    longPressTimer = setTimeout(() => {
      longPressTimer = null
      beginDrag(index)
    }, LONG_PRESS_MS)

    const onMouseMove = (e: MouseEvent) => {
      if (!longPressTimer) {
        document.removeEventListener('mousemove', onMouseMove)
        return
      }
      if (
        Math.abs(e.clientX - pressStartX) > MOVE_TOLERANCE_PX ||
        Math.abs(e.clientY - pressStartY) > MOVE_TOLERANCE_PX
      ) {
        clearLongPress()
        document.removeEventListener('mousemove', onMouseMove)
      }
    }
    const onMouseUp = () => {
      clearLongPress()
      document.removeEventListener('mousemove', onMouseMove)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp, { once: true })
  }

  /** iOS synthesizes a click on touchend — bind on click.capture to swallow the stale click after a drop. */
  function onItemClickCapture(event: MouseEvent) {
    if (performance.now() < suppressClickUntil) {
      event.stopPropagation()
      event.preventDefault()
    }
  }

  function beginDrag(index: number) {
    options.onPickup?.()
    dragState.dragging = true
    dragState.fromIndex = index
    dragState.overIndex = index

    const onMove = (e: MouseEvent | TouchEvent) => {
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
      const idx = getItemIndexFromPoint(clientY)
      if (idx !== -1) dragState.overIndex = idx
      // Block page scroll while the user is dragging.
      if (e.cancelable) e.preventDefault()
    }

    const onEnd = () => {
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
      document.removeEventListener('touchcancel', onEnd)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onEnd)

      if (dragState.fromIndex !== dragState.overIndex) {
        options.onReorder(dragState.fromIndex, dragState.overIndex)
      }

      dragState.dragging = false
      dragState.fromIndex = -1
      dragState.overIndex = -1
      suppressClickUntil = performance.now() + SUPPRESS_CLICK_MS
    }

    // Non-passive so the move handler can preventDefault page scroll.
    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend', onEnd, { once: true })
    document.addEventListener('touchcancel', onEnd, { once: true })
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onEnd, { once: true })
  }

  return {
    dragState,
    onItemTouchStart,
    onItemTouchMove,
    onItemTouchEnd,
    onItemMouseDown,
    onItemClickCapture,
  }
}
