import { ref, onMounted, onUnmounted, readonly, type DeepReadonly, type Ref } from 'vue'

export interface Shortcut {
  key: string
  label: string
  action: () => void
  /** If true, the shortcut fires even when an input/textarea is focused */
  global?: boolean
}

export interface UseKeyboardShortcutsReturn {
  helpOpen: DeepReadonly<Ref<boolean>>
  toggleHelp: () => void
  closeHelp: () => void
}

// `helpOpen` is per-consumer UI state, NOT an app-global singleton. It lives
// inside the composable so each caller gets its own shortcut-help boolean —
// unlike useWakeLock/useServiceWorker, whose module-scoped state deliberately
// models a single shared system resource. Toggling the help overlay in one
// component must never affect another (LIFT-882).
export function useKeyboardShortcuts(shortcuts: () => Shortcut[]): UseKeyboardShortcutsReturn {
  const helpOpen = ref(false)

  function handler(e: KeyboardEvent) {
    // Ignore when modifier keys are held (except Shift for ?)
    if (e.ctrlKey || e.metaKey || e.altKey) return

    const tag = (e.target as HTMLElement)?.tagName
    const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
      (e.target as HTMLElement)?.isContentEditable

    // Escape always works
    if (e.key === 'Escape' && helpOpen.value) {
      helpOpen.value = false
      e.preventDefault()
      return
    }

    for (const s of shortcuts()) {
      if (e.key === s.key) {
        if (isInput && !s.global) continue
        e.preventDefault()
        s.action()
        return
      }
    }
  }

  onMounted(() => window.addEventListener('keydown', handler))
  onUnmounted(() => window.removeEventListener('keydown', handler))

  return {
    helpOpen: readonly(helpOpen),
    toggleHelp() { helpOpen.value = !helpOpen.value },
    closeHelp() { helpOpen.value = false },
  }
}
