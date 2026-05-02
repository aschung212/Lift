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

  function isDismissed(): boolean {
    return localStorage.getItem(DISMISS_KEY) === 'true'
  }

  function handleBeforeInstall(e: Event) {
    e.preventDefault()
    deferredPrompt = e as BeforeInstallPromptEvent
    evaluateVisibility()
  }

  /** Re-evaluate whether the banner should be visible. */
  function evaluateVisibility() {
    if (!deferredPrompt || isDismissed() || isStandalone()) {
      canShow.value = false
      return
    }
    // Only show after the user has logged enough sets to signal engagement
    const totalSets = countUserSets()
    canShow.value = totalSets >= MIN_SETS_BEFORE_PROMPT
  }

  function countUserSets(): number {
    try {
      const raw = localStorage.getItem('exercises')
      if (!raw) return 0
      const exercises = JSON.parse(raw) as { sets?: unknown[] }[]
      return exercises.reduce((sum, ex) => sum + (ex.sets?.length ?? 0), 0)
    } catch {
      return 0
    }
  }

  async function install() {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'dismissed') {
      dismiss()
    }
    deferredPrompt = null
    canShow.value = false
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
