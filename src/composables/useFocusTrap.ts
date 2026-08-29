import { onUnmounted } from 'vue'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/**
 * Traps keyboard focus within a modal element and restores focus
 * to the previously-focused element when the modal closes.
 *
 * Usage:
 *   const focusTrap = useFocusTrap()
 *   // When modal mounts:  focusTrap.activate(el)
 *   // When modal closes:  focusTrap.deactivate()
 */
export interface FocusTrapActivateOptions {
  /**
   * Focus the container element itself instead of the first focusable
   * descendant. Use for modals whose first field is a text/number input:
   * on iOS, programmatically focusing such an input on open shows the caret
   * but withholds the soft keyboard, and a later tap on the already-focused
   * field won't summon it either (a deadlock). Focusing the container avoids
   * that AND matches the WAI-ARIA dialog pattern — announce the dialog, then
   * let the user tap the field to type (a fresh, gesture-driven focus that
   * does raise the keyboard).
   */
  focusContainer?: boolean
}

export interface UseFocusTrapReturn {
  activate: (el: HTMLElement, opts?: FocusTrapActivateOptions) => void
  deactivate: () => void
}

export function useFocusTrap(): UseFocusTrapReturn {
  let trapEl: HTMLElement | null = null
  let previouslyFocused: HTMLElement | null = null

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Tab' || !trapEl) return

    // NOTE (LIFT-1266): the `!trapEl.contains(document.activeElement)` branches
    // below reclaim focus whenever it sits outside the trap. That is right for
    // focus escaping to the page, but a layer Teleported to <body> from INSIDE
    // this modal (e.g. InfoPopover's bubble) is also "outside" by containment
    // while being visually on top — reclaiming there would pull focus under the
    // layer's own backdrop and orphan it. This handler is document-level and
    // bubble-phase, so such a layer gets first refusal from a capture-phase
    // window listener; InfoPopover uses that window to close itself and restore
    // focus into the trap before this runs. Any new teleported layer must do the
    // same (close or stop the event) rather than relying on the trap to notice.

    const focusable = Array.from(trapEl.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (focusable.length === 0) {
      e.preventDefault()
      return
    }

    const first = focusable[0]
    const last = focusable[focusable.length - 1]

    if (e.shiftKey) {
      if (document.activeElement === first || !trapEl.contains(document.activeElement)) {
        e.preventDefault()
        last.focus()
      }
    } else {
      if (document.activeElement === last || !trapEl.contains(document.activeElement)) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  function activate(el: HTMLElement, opts: FocusTrapActivateOptions = {}) {
    // Store the element that was focused before the modal opened
    previouslyFocused = document.activeElement as HTMLElement | null
    trapEl = el

    // Focus the first focusable element, or the container itself.
    // focusContainer skips the first-focusable lookup so the container takes
    // focus (see FocusTrapActivateOptions — iOS keyboard deadlock).
    const first = opts.focusContainer ? null : el.querySelector<HTMLElement>(FOCUSABLE)
    if (first) {
      first.focus()
    } else {
      el.setAttribute('tabindex', '-1')
      el.focus()
    }

    document.addEventListener('keydown', onKeyDown)
  }

  function deactivate() {
    document.removeEventListener('keydown', onKeyDown)
    trapEl = null

    // Restore focus to the element that triggered the modal
    if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
      previouslyFocused.focus()
      previouslyFocused = null
    }
  }

  onUnmounted(() => {
    deactivate()
  })

  return { activate, deactivate }
}
