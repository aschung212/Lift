import { createApp } from 'vue'

export interface MountedComposable<E> {
  /** Whatever the composable's setup returned. */
  exposed: E
  /** Unmount the app, firing onUnmounted hooks, and remove the host node. */
  unmount: () => void
}

/**
 * Minimal real-DOM lifecycle host for browser-mode composable tests.
 *
 * We deliberately avoid @vue/test-utils and string templates here:
 *  - @vue/test-utils drags in @babel/parser (CJS), which esbuild cannot
 *    down-transpile for the Vite browser target.
 *  - The runtime-only Vue bundle this project ships cannot compile string
 *    templates at runtime.
 *
 * Composables that use lifecycle hooks (onMounted/onUnmounted) need an active
 * component instance, which this provides via a render-function-only app.
 * Tests create whatever real DOM elements they need with document.createElement
 * so layout (scrollTop, offsetHeight, focus order) is genuine.
 */
export function mountComposable<E>(setup: () => E): MountedComposable<E> {
  const host = document.createElement('div')
  document.body.appendChild(host)

  let exposed!: E
  const app = createApp({
    setup() {
      exposed = setup()
      return () => null
    },
  })
  app.mount(host)

  return {
    exposed,
    unmount: () => {
      app.unmount()
      host.remove()
    },
  }
}
