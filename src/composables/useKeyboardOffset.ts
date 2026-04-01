import { ref, onMounted, onUnmounted } from 'vue'

/**
 * Tracks the iOS virtual keyboard height using the visualViewport API.
 * Returns a reactive `keyboardHeight` (px) that updates when the keyboard
 * opens or closes. Returns 0 on browsers without visualViewport support.
 */
export function useKeyboardOffset() {
  const keyboardHeight = ref(0)

  function update() {
    const vv = window.visualViewport
    if (!vv) return
    // On iOS, innerHeight stays fixed when the keyboard opens.
    // visualViewport.height shrinks and offsetTop shifts.
    keyboardHeight.value = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
  }

  onMounted(() => {
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)
  })

  onUnmounted(() => {
    window.visualViewport?.removeEventListener('resize', update)
    window.visualViewport?.removeEventListener('scroll', update)
  })

  return { keyboardHeight }
}
