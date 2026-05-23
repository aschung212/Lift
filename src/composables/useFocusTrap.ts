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
export interface UseFocusTrapReturn {
  activate: (el: HTMLElement) => void
  deactivate: () => void
}

export function useFocusTrap(): UseFocusTrapReturn {
  let trapEl: HTMLElement | null = null
  let previouslyFocused: HTMLElement | null = null

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Tab' || !trapEl) return

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

  function activate(el: HTMLElement) {
    // Store the element that was focused before the modal opened
    previouslyFocused = document.activeElement as HTMLElement | null
    trapEl = el

    // Focus the first focusable element, or the container itself
    const first = el.querySelector<HTMLElement>(FOCUSABLE)
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
