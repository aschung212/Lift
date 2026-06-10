import { nextTick } from 'vue'

/**
 * Shrink the enclosing `.repMaxModal` to fit above the iOS keyboard, then
 * scroll the focused input into view. Centered modals normally need no manual
 * keyboard handling (iOS adjusts the visual viewport natively — see the
 * settled pattern in CLAUDE.md); this exists for inputs near the bottom of a
 * TALL modal, where the native adjustment still leaves the field covered.
 * The max-height override is restored on the keyboard-dismiss resize.
 */
export function scrollInputAboveKeyboard(el: HTMLElement): void {
  setTimeout(() => {
    const modal = el.closest('.repMaxModal') as HTMLElement | null
    if (!modal) return
    const vv = window.visualViewport
    if (!vv) return
    // Shrink modal so it fits within the visible viewport above the keyboard
    const availableHeight = vv.height - 96
    modal.style.maxHeight = `${availableHeight}px`
    // Scroll the input into view within the now-scrollable modal
    nextTick(() => {
      const inputRect = el.getBoundingClientRect()
      const visibleBottom = vv.offsetTop + vv.height
      if (inputRect.bottom > visibleBottom - 16) {
        modal.scrollTop += inputRect.bottom - visibleBottom + 60
      }
    })
    // Restore max-height when keyboard dismisses
    const restore = () => {
      modal.style.maxHeight = ''
      vv.removeEventListener('resize', restore)
    }
    vv.addEventListener('resize', restore)
  }, 400)
}
