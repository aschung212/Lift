import { ref, watch, type Ref, type WatchSource } from 'vue'
import { isNative, isIOS } from '../lib/platform'

const DISMISS_KEY = 'install-prompt-dismissed'
const MIN_WORKOUT_DAYS = 3

/** Whether the app is running in standalone (installed) mode. */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

export interface InstallPromptState {
  /** True when a native or iOS install banner should be visible. */
  showBanner: Ref<boolean>
  /** True when this is an iOS device needing manual add-to-home-screen instructions. */
  isIOSPrompt: Ref<boolean>
  /** Dismiss the banner and remember the preference. */
  dismiss: () => void
  /** Trigger the native install prompt (Chrome/Edge). No-op on iOS. */
  install: () => Promise<void>
}

/**
 * Composable that manages PWA install prompt state.
 *
 * On Chromium browsers, intercepts `beforeinstallprompt` and defers it
 * until the user has enough engagement (≥ MIN_WORKOUT_DAYS unique days).
 *
 * On iOS Safari (which never fires `beforeinstallprompt`), detects that
 * the app is not installed and shows an instructional card instead.
 *
 * Never shows if:
 * - Already running as installed PWA / native Capacitor
 * - User previously dismissed the banner
 * - User hasn't reached the engagement threshold
 */
export function useInstallPrompt(workoutDayCount: WatchSource<number>): InstallPromptState {
  const showBanner = ref(false)
  const isIOSPrompt = ref(false)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let deferredPrompt: any = null
  // True when we intercepted beforeinstallprompt but haven't shown the banner yet
  // (waiting for workout data to hydrate past the threshold).
  let hasPendingPrompt = false

  function getDayCount(): number {
    return typeof workoutDayCount === 'function' ? workoutDayCount() : workoutDayCount.value
  }

  function shouldShow(): boolean {
    // Never show in native or already-installed PWA
    if (isNative || isStandalone()) return false
    // User already dismissed
    if (localStorage.getItem(DISMISS_KEY)) return false
    // Not enough engagement
    if (getDayCount() < MIN_WORKOUT_DAYS) return false
    return true
  }

  function dismiss() {
    showBanner.value = false
    deferredPrompt = null
    hasPendingPrompt = false
    localStorage.setItem(DISMISS_KEY, 'true')
  }

  async function install() {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    deferredPrompt = null
    // Hide regardless of outcome — the native prompt can only be triggered once
    showBanner.value = false
    if (outcome === 'accepted') {
      localStorage.setItem(DISMISS_KEY, 'true')
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function onBeforeInstallPrompt(e: any) {
    // Prevent the browser's mini-infobar
    e.preventDefault()
    deferredPrompt = e

    if (shouldShow()) {
      isIOSPrompt.value = false
      showBanner.value = true
    } else {
      // Store may not be hydrated yet — mark as pending
      hasPendingPrompt = true
    }
  }

  function onAppInstalled() {
    showBanner.value = false
    deferredPrompt = null
    hasPendingPrompt = false
    localStorage.setItem(DISMISS_KEY, 'true')
  }

  // Register listeners immediately — this composable lives for the app's lifetime
  window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  window.addEventListener('appinstalled', onAppInstalled)

  // iOS Safari: no beforeinstallprompt ever fires — show manual instructions
  if (isIOS && !isNative && !isStandalone()) {
    if (shouldShow()) {
      isIOSPrompt.value = true
      showBanner.value = true
    } else if (!localStorage.getItem(DISMISS_KEY)) {
      // Data may not be loaded yet — watch for threshold crossing
      hasPendingPrompt = true
    }
  }

  // Watch for workout data hydration — the store loads asynchronously, so
  // the day count may be 0 when listeners first fire. Re-evaluate once
  // the threshold is crossed.
  watch(workoutDayCount, (count) => {
    if (!hasPendingPrompt || showBanner.value) return
    if (count < MIN_WORKOUT_DAYS) return
    if (!shouldShow()) return

    hasPendingPrompt = false
    if (deferredPrompt) {
      isIOSPrompt.value = false
      showBanner.value = true
    } else if (isIOS && !isNative && !isStandalone()) {
      isIOSPrompt.value = true
      showBanner.value = true
    }
  })

  return {
    showBanner,
    isIOSPrompt,
    dismiss,
    install,
  }
}
