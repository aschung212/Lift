import { ref, watch, nextTick, onUnmounted, type Ref } from 'vue'
import { useFocusTrap } from './useFocusTrap'

/**
 * Shared, reference-counted background-scroll lock.
 *
 * Adding `modal-open` to <html> drives `overflow: hidden` on `.tabContent`
 * (see index.css) — the iOS-correct way to stop the background from
 * scrolling, since `touch-action: none` on the overlay does NOT prevent
 * background scroll in iOS Safari/WKWebView (settled pattern in CLAUDE.md).
 *
 * Locking is CRITICAL, not cosmetic: a `position: fixed` modal whose
 * background is still scrollable desyncs its paint coordinates from its
 * hit-test coordinates the moment the iOS keyboard opens (the visual
 * viewport shifts but the scrollable layout viewport does not), so taps
 * land a row low — the caret renders over the wrong control and the wrong
 * element receives the tap.
 *
 * A reference count (not a boolean) keeps the lock applied until the LAST
 * open modal releases it: a share sheet stacked over the workout-complete
 * view must not re-enable background scroll when only the inner sheet
 * closes. Per-instance `holdsLock` guards ensure each modal contributes at
 * most 1 and releases exactly once (close OR unmount, never both).
 */
let scrollLockCount = 0
function applyScrollLock() {
  document.documentElement.classList.toggle('modal-open', scrollLockCount > 0)
}

export interface UseModalOptions {
  /**
   * CSS selector to find the modal element for focus trapping.
   * If not provided, `trapRef` template ref is used instead.
   */
  selector?: string

  /**
   * Called after the modal opens and focus trap activates.
   */
  onOpen?: () => void

  /**
   * Called after the modal closes and focus trap deactivates.
   */
  onClose?: () => void

  /**
   * Lock background scroll (`html.modal-open`) while open. Defaults to true.
   * Set false only when an ancestor modal already owns the lock for this
   * surface (e.g. the share sheet nested inside WorkoutCompleteView / PRBurst,
   * whose parents toggle `modal-open` themselves).
   */
  lockScroll?: boolean

  /**
   * On open, focus the dialog container instead of its first focusable
   * field. Set true for modals whose first field is a text/number input,
   * so iOS raises the soft keyboard on the user's first tap rather than
   * deadlocking on a pre-focused field (see FocusTrapActivateOptions).
   */
  focusContainer?: boolean
}

/**
 * Encapsulates the repeated modal open/focus-trap/close boilerplate.
 *
 * Handles: watch → nextTick → querySelector/ref → activate focus trap,
 * deactivate on close, and a reference-counted background-scroll lock.
 * Components just call open()/close() and register lifecycle callbacks
 * via options.
 */
export function useModal(options: UseModalOptions = {}) {
  const isOpen = ref(false)
  const trapRef = ref<HTMLElement | null>(null) as Ref<HTMLElement | null>
  const focusTrap = useFocusTrap()
  const lockScroll = options.lockScroll !== false

  // Per-instance: contribute at most 1 to the shared count, release once.
  let holdsLock = false
  function acquireLock() {
    if (!lockScroll || holdsLock) return
    holdsLock = true
    scrollLockCount++
    applyScrollLock()
  }
  function releaseLock() {
    if (!holdsLock) return
    holdsLock = false
    scrollLockCount--
    applyScrollLock()
  }

  function open() {
    if (isOpen.value) return
    isOpen.value = true
    acquireLock()
  }

  function close() {
    if (!isOpen.value) return
    isOpen.value = false
    releaseLock()
  }

  watch(isOpen, async (open) => {
    if (open) {
      await nextTick()
      const el = options.selector
        ? document.querySelector<HTMLElement>(options.selector)
        : trapRef.value
      if (el) focusTrap.activate(el, { focusContainer: options.focusContainer })
      options.onOpen?.()
    } else {
      focusTrap.deactivate()
      options.onClose?.()
    }
  })

  onUnmounted(() => {
    // Safety net: a parent may stop rendering the modal without calling
    // close() (e.g. v-if flips), which would otherwise leak the lock and
    // freeze the whole app behind a permanent `modal-open`.
    releaseLock()
  })

  return { isOpen, open, close, trapRef }
}
