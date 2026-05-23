import { ref, watch, nextTick, type Ref } from 'vue'
import { useFocusTrap } from './useFocusTrap'

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
}

/**
 * Encapsulates the repeated modal open/focus-trap/close boilerplate.
 *
 * Handles: watch → nextTick → querySelector/ref → activate focus trap,
 * and deactivate on close. Components just call open()/close() and
 * register lifecycle callbacks via options.
 */
export function useModal(options: UseModalOptions = {}) {
  const isOpen = ref(false)
  const trapRef = ref<HTMLElement | null>(null) as Ref<HTMLElement | null>
  const focusTrap = useFocusTrap()

  function open() {
    isOpen.value = true
  }

  function close() {
    isOpen.value = false
  }

  watch(isOpen, async (open) => {
    if (open) {
      await nextTick()
      const el = options.selector
        ? document.querySelector<HTMLElement>(options.selector)
        : trapRef.value
      if (el) focusTrap.activate(el)
      options.onOpen?.()
    } else {
      focusTrap.deactivate()
      options.onClose?.()
    }
  })

  return { isOpen, open, close, trapRef }
}
