import { ref, readonly, onUnmounted } from 'vue'

const DISMISS_KEY = 'pwa-install-dismissed'
const MIN_TRAINING_DAYS = 3

/** Matches iOS Safari (not Chrome on iOS, not standalone mode) */
function isIOSSafari(): boolean {
  const ua = navigator.userAgent
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|OPiOS|EdgiOS/.test(ua)
  return isIOS && isSafari
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true
}

function wasDismissed(): boolean {
  return localStorage.getItem(DISMISS_KEY) === 'true'
}

/**
 * Manages the PWA install prompt lifecycle.
 *
 * On Chromium browsers: intercepts `beforeinstallprompt`, defers it,
 * and exposes a `triggerInstall()` to invoke the native prompt.
 *
 * On iOS Safari: detects non-standalone mode and shows a manual
 * "Add to Home Screen" instruction banner.
 *
 * The banner only appears after the user has logged sets on at least
 * `MIN_TRAINING_DAYS` unique days, ensuring it surfaces at a
 * high-engagement moment rather than interrupting first-time users.
 */
export function useInstallPrompt() {
  const showBanner = ref(false)
  const isIOS = ref(false)

  let deferredPrompt: (Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }) | null = null

  // Already installed or previously dismissed — bail out early
  if (isStandalone() || wasDismissed()) {
    return { showBanner: readonly(showBanner), isIOS: readonly(isIOS), triggerInstall, dismiss }
  }

  function onBeforeInstallPrompt(e: Event) {
    e.preventDefault()
    deferredPrompt = e as typeof deferredPrompt
    // Don't show banner yet — wait for checkEngagement() call
  }

  window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)

  onUnmounted(() => {
    window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  })

  // Detect iOS Safari (no beforeinstallprompt event)
  if (isIOSSafari()) {
    isIOS.value = true
  }

  /**
   * Call this after workout data is available to check whether the user
   * has reached the engagement threshold. Pass the count of unique
   * training days (YYYY-MM-DD dates with at least one logged set).
   */
  function checkEngagement(uniqueTrainingDays: number) {
    if (isStandalone() || wasDismissed()) return
    if (uniqueTrainingDays < MIN_TRAINING_DAYS) return

    // Chromium: only show if we captured the deferred prompt
    // iOS: always show (manual instructions)
    if (deferredPrompt || isIOS.value) {
      showBanner.value = true
    }
  }

  async function triggerInstall() {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') {
      showBanner.value = false
    }
    deferredPrompt = null
  }

  function dismiss() {
    showBanner.value = false
    localStorage.setItem(DISMISS_KEY, 'true')
  }

  return {
    showBanner: readonly(showBanner),
    isIOS: readonly(isIOS),
    checkEngagement,
    triggerInstall,
    dismiss,
  }
}
