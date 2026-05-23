import { watch, nextTick, type WatchSource } from 'vue'
import { useFocusTrap, type UseFocusTrapReturn } from './useFocusTrap'

/**
 * Wraps useFocusTrap with the watch → nextTick → activate/deactivate
 * lifecycle that every v-if modal in the app needs.
 *
 * Usage:
 *   useModalFocusTrap(showModal, '.repMaxModal')
 *   useModalFocusTrap(detailExerciseId, () => detailSheetEl.value)
 */
export function useModalFocusTrap(
  /** Truthy = modal open, falsy = modal closed */
  source: WatchSource<unknown>,
  /** CSS selector string, or a function returning the HTMLElement (e.g. a template ref getter) */
  target: string | (() => HTMLElement | null | undefined),
  options?: {
    /** Called after the focus trap activates (e.g. to focus a specific input) */
    onActivated?: (el: HTMLElement) => void
    /** Called when the modal closes, before deactivation */
    onDeactivated?: () => void
  },
): UseFocusTrapReturn {
  const focusTrap = useFocusTrap()

  watch(source, async (val) => {
    if (val) {
      await nextTick()
      const el = typeof target === 'string'
        ? document.querySelector<HTMLElement>(target)
        : target()
      if (el) {
        focusTrap.activate(el)
        options?.onActivated?.(el)
      }
    } else {
      options?.onDeactivated?.()
      focusTrap.deactivate()
    }
  })

  return focusTrap
}
