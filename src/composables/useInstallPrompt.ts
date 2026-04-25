import { ref, readonly, onMounted, onUnmounted } from 'vue'
import { isNative, isIOS } from '../lib/platform'

const DISMISS_KEY = 'install-prompt-dismissed'
const MIN_WORKOUT_SESSIONS = 3

/**
 * Intercepts `beforeinstallprompt` (Chrome/Android) and detects iOS Safari
 * to show a custom in-app install banner at the right moment.
 *
 * The banner only shows when:
 * 1. The app is NOT already installed (standalone) or running in Capacitor
 * 2. The user has NOT previously dismissed the banner
 * 3. The user has logged at least MIN_WORKOUT_SESSIONS unique workout dates
 */
export function useInstallPrompt(workoutDateCount: () => number) {
  // Chrome/Edge/Samsung: deferred prompt from the browser
  let deferredPrompt: BeforeInstallPromptEvent | null = null
  const showBanner = ref(false)
  const isIOSPrompt = ref(false)

  const isStandalone =
    isNative ||
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true

  function shouldShow(): boolean {
    if (isStandalone) return false
    if (localStorage.getItem(DISMISS_KEY)) return false
    if (workoutDateCount() < MIN_WORKOUT_SESSIONS) return false
    return true
  }

  function handleBeforeInstallPrompt(e: Event) {
    // Suppress the browser's mini-infobar
    e.preventDefault()
    deferredPrompt = e as BeforeInstallPromptEvent
    if (shouldShow()) {
      isIOSPrompt.value = false
      showBanner.value = true
    }
  }

  /** Trigger the native install prompt (Chrome/Android only). */
  async function install() {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') {
      showBanner.value = false
    }
    deferredPrompt = null
  }

  /** User explicitly dismisses the banner — don't show again. */
  function dismiss() {
    showBanner.value = false
    localStorage.setItem(DISMISS_KEY, new Date().toISOString())
  }

  /** Re-evaluate visibility — call when workout count changes. */
  function check() {
    if (showBanner.value) return // already showing
    if (!shouldShow()) return

    if (deferredPrompt) {
      isIOSPrompt.value = false
      showBanner.value = true
    } else if (isIOS && !isStandalone) {
      // iOS Safari doesn't fire beforeinstallprompt — show manual instructions
      isIOSPrompt.value = true
      showBanner.value = true
    }
  }

  onMounted(() => {
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    // Also hide if the app gets installed while the banner is up
    window.addEventListener('appinstalled', () => {
      showBanner.value = false
    })
    // Initial check (iOS path or if beforeinstallprompt already fired)
    check()
  })

  onUnmounted(() => {
    window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
  })

  return {
    showBanner: readonly(showBanner),
    isIOSPrompt: readonly(isIOSPrompt),
    install,
    dismiss,
    check,
  }
}

/**
 * Type for the `beforeinstallprompt` event (not in lib.dom.d.ts).
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}
