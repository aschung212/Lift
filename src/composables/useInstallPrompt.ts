import { ref, watch, type Ref, type WatchSource } from 'vue'
import { isNative, isIOS } from '../lib/platform'

/**
 * The `beforeinstallprompt` event fired by Chromium browsers.
 * Not included in TypeScript's lib.dom.d.ts because it is non-standard.
 * @see https://developer.mozilla.org/en-US/docs/Web/API/BeforeInstallPromptEvent
 */
export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
  prompt(): Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// Stores the timestamp (ms) of the user's last banner dismissal. A dismissal
// used to write the literal string 'true' and suppress the prompt forever;
// it now snoozes for SNOOZE_MS so a user who dismisses before understanding
// the value gets a second chance (installed users convert ~5x better).
const DISMISS_KEY = 'install-prompt-dismissed'
// Set once the app is actually installed (native prompt accepted / appinstalled
// fired) — a permanent suppression, distinct from the temporary dismiss snooze.
const INSTALLED_KEY = 'install-prompt-installed'
const MIN_WORKOUT_DAYS = 3
// Re-surface a dismissed prompt after ~30 days.
const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000

/** Whether the app is running in standalone (installed) mode. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
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
  /**
   * Re-surface the banner at a high-engagement "peak moment" (a new PR, a
   * streak milestone). Bypasses the MIN_WORKOUT_DAYS engagement gate — a peak
   * moment is itself the engagement signal — but still respects an installed
   * app and an active dismiss snooze. No-op if already visible/suppressed.
   */
  surfaceAtPeakMoment: () => void
  /** Remove event listeners. Call when the consumer unmounts. */
  destroy: () => void
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

  let deferredPrompt: BeforeInstallPromptEvent | null = null
  // True when we intercepted beforeinstallprompt but haven't shown the banner yet
  // (waiting for workout data to hydrate past the threshold).
  let hasPendingPrompt = false

  function getDayCount(): number {
    return typeof workoutDayCount === 'function' ? workoutDayCount() : workoutDayCount.value
  }

  /** True once the app has actually been installed — a permanent suppression. */
  function isInstallRemembered(): boolean {
    return localStorage.getItem(INSTALLED_KEY) === '1'
  }

  /**
   * True while a dismissal is still within its snooze window. Legacy dismissals
   * (and legacy installs) wrote the literal 'true' before snoozing existed; we
   * can't tell the two apart, so treat 'true' as a permanent suppression to
   * avoid re-prompting someone who may already have installed.
   */
  function isSnoozeActive(): boolean {
    const raw = localStorage.getItem(DISMISS_KEY)
    if (raw === null) return false
    if (raw === 'true') return true
    const ts = Number(raw)
    if (!Number.isFinite(ts)) return false
    return Date.now() - ts < SNOOZE_MS
  }

  /** Permanently installed, or temporarily snoozed after a dismissal. */
  function isSuppressed(): boolean {
    return isInstallRemembered() || isSnoozeActive()
  }

  function rememberInstalled() {
    localStorage.setItem(INSTALLED_KEY, '1')
  }

  function shouldShow(): boolean {
    // Never show in native or already-installed PWA
    if (isNative || isStandalone()) return false
    // User already installed, or dismissed within the snooze window
    if (isSuppressed()) return false
    // Not enough engagement
    if (getDayCount() < MIN_WORKOUT_DAYS) return false
    return true
  }

  function dismiss() {
    showBanner.value = false
    deferredPrompt = null
    hasPendingPrompt = false
    // Snooze (timestamp) rather than suppress forever — re-surfaces after SNOOZE_MS.
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
  }

  function surfaceAtPeakMoment() {
    if (showBanner.value) return
    if (isNative || isStandalone()) return
    if (isSuppressed()) return
    if (deferredPrompt) {
      isIOSPrompt.value = false
      showBanner.value = true
      hasPendingPrompt = false
    } else if (isIOS && !isNative && !isStandalone()) {
      isIOSPrompt.value = true
      showBanner.value = true
      hasPendingPrompt = false
    }
  }

  async function install() {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    deferredPrompt = null
    // Hide regardless of outcome — the native prompt can only be triggered once
    showBanner.value = false
    if (outcome === 'accepted') {
      rememberInstalled()
    }
  }

  function onBeforeInstallPrompt(e: BeforeInstallPromptEvent) {
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
    rememberInstalled()
  }

  // Register listeners — cleaned up via destroy() if the consumer unmounts.
  // 'beforeinstallprompt' is not in WindowEventMap, so we cast the handler.
  const promptHandler = onBeforeInstallPrompt as EventListener
  window.addEventListener('beforeinstallprompt', promptHandler)
  window.addEventListener('appinstalled', onAppInstalled)

  function destroy() {
    window.removeEventListener('beforeinstallprompt', promptHandler)
    window.removeEventListener('appinstalled', onAppInstalled)
  }

  // iOS Safari: no beforeinstallprompt ever fires — show manual instructions
  if (isIOS && !isNative && !isStandalone()) {
    if (shouldShow()) {
      isIOSPrompt.value = true
      showBanner.value = true
    } else if (!isSuppressed()) {
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
    surfaceAtPeakMoment,
    destroy,
  }
}
