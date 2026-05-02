import { ref, onMounted, onUnmounted } from 'vue'

/**
 * Captures the browser's `beforeinstallprompt` event and defers it
 * so the app can show a custom install banner at a contextually
 * appropriate time (e.g. after the user has logged a few sets).
 *
 * The prompt is suppressed if:
 * - The user previously dismissed it
 * - The app is already running in standalone/PWA mode
 * - The browser doesn't support `beforeinstallprompt` (Safari/iOS)
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'pwa-install-dismissed'
const MIN_SETS_BEFORE_PROMPT = 3

/** Whether the app is running as an installed PWA (standalone mode). */
function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  )
}

export function useInstallPrompt() {
  const canShow = ref(false)
  let deferredPrompt: BeforeInstallPromptEvent | null = null
  let lastKnownSets = 0

  function isDismissed(): boolean {
    return localStorage.getItem(DISMISS_KEY) === 'true'
  }

  function handleBeforeInstall(e: Event) {
    e.preventDefault()
    deferredPrompt = e as BeforeInstallPromptEvent
    evaluate()
  }

  function evaluate() {
    if (!deferredPrompt || isDismissed() || isStandalone()) {
      canShow.value = false
      return
    }
    canShow.value = lastKnownSets >= MIN_SETS_BEFORE_PROMPT
  }

  /**
   * Update the set count and re-evaluate whether the banner should show.
   * Called by the parent component when the workout store's total set count changes.
   */
  function evaluateVisibility(totalSets: number) {
    lastKnownSets = totalSets
    evaluate()
  }

  async function install() {
    const prompt = deferredPrompt
    if (!prompt) return
    // Clear immediately to prevent double-click race
    deferredPrompt = null
    canShow.value = false
    try {
      await prompt.prompt()
      const { outcome } = await prompt.userChoice
      if (outcome === 'dismissed') {
        localStorage.setItem(DISMISS_KEY, 'true')
      }
    } catch {
      // prompt() throws InvalidStateError if called twice — already guarded above
    }
  }

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, 'true')
    canShow.value = false
    deferredPrompt = null
  }

  onMounted(() => {
    if (isStandalone() || isDismissed()) return
    window.addEventListener('beforeinstallprompt', handleBeforeInstall)
  })

  onUnmounted(() => {
    window.removeEventListener('beforeinstallprompt', handleBeforeInstall)
  })

  return {
    canShow,
    install,
    dismiss,
    /** Call after the user logs a set to re-check the threshold. */
    evaluateVisibility,
  }
}
