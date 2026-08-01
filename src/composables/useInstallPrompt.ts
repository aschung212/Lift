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

/**
 * Timestamp (ms since epoch) until which the banner stays snoozed after a
 * manual dismissal. A dismissal is a "not now", not a "never" — re-surfacing
 * after a cooldown recovers users who dismissed before understanding the value
 * (installed users return/convert far more often).
 */
const SNOOZE_KEY = 'install-prompt-snoozed-until'
/** Set once the user actually installs — a permanent, honored suppression. */
const INSTALLED_KEY = 'install-prompt-installed'
/**
 * Legacy flag (pre-snooze) that permanently suppressed the banner on any
 * dismissal. Migrated to a bounded snooze on first run so previously-dismissed
 * users are eventually re-surfaced instead of blocked forever.
 */
const LEGACY_DISMISS_KEY = 'install-prompt-dismissed'
const MIN_WORKOUT_DAYS = 3
/** Cooldown after a manual dismissal before the banner may re-surface (~30 days). */
const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000

/** Whether the app is running in standalone (installed) mode. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

/**
 * Migrate the legacy permanent-dismiss flag to a bounded snooze. Runs once:
 * the legacy key is removed, and (for a non-installed user) converted into a
 * fresh cooldown so a past dismissal re-surfaces later instead of blocking
 * forever. Installed users just have the stale flag cleared.
 */
function migrateLegacyDismiss(): void {
  if (typeof localStorage === 'undefined') return
  if (localStorage.getItem(LEGACY_DISMISS_KEY) === null) return
  localStorage.removeItem(LEGACY_DISMISS_KEY)
  if (isStandalone()) return
  // Don't clobber a newer snooze/installed marker if one somehow exists.
  if (localStorage.getItem(SNOOZE_KEY) !== null || localStorage.getItem(INSTALLED_KEY) !== null) {
    return
  }
  localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS))
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
 * A manual dismissal is a bounded snooze (~30 days), not a permanent block —
 * an optional `peakMoment` signal (e.g. a new PR or streak milestone) can also
 * re-surface the banner outside the raw engagement gate.
 *
 * Never shows if:
 * - Already running as installed PWA / native Capacitor
 * - User already installed the app
 * - User dismissed within the snooze cooldown
 * - User hasn't reached the engagement threshold (unless a peak moment fires)
 */
export function useInstallPrompt(
  workoutDayCount: WatchSource<number>,
  peakMoment?: WatchSource<unknown>,
): InstallPromptState {
  const showBanner = ref(false)
  const isIOSPrompt = ref(false)

  let deferredPrompt: BeforeInstallPromptEvent | null = null
  // True when we intercepted beforeinstallprompt but haven't shown the banner yet
  // (waiting for workout data to hydrate past the threshold).
  let hasPendingPrompt = false

  // One-time migration: a legacy dismissal permanently blocked the banner.
  // Convert it into a bounded snooze so those users are re-surfaced later —
  // unless they're already installed (standalone), in which case nothing shows
  // anyway and we simply clear the stale flag.
  migrateLegacyDismiss()

  function getDayCount(): number {
    return typeof workoutDayCount === 'function' ? workoutDayCount() : workoutDayCount.value
  }

  /** True while a manual-dismissal cooldown is still active. */
  function isSnoozed(): boolean {
    const until = Number(localStorage.getItem(SNOOZE_KEY))
    return Number.isFinite(until) && until > 0 && Date.now() < until
  }

  /** Installed for good, or dismissed within the snooze window. */
  function isSuppressed(): boolean {
    return localStorage.getItem(INSTALLED_KEY) !== null || isSnoozed()
  }

  function shouldShow(): boolean {
    // Never show in native or already-installed PWA
    if (isNative || isStandalone()) return false
    // Installed, or dismissed within the cooldown
    if (isSuppressed()) return false
    // Not enough engagement
    if (getDayCount() < MIN_WORKOUT_DAYS) return false
    return true
  }

  // Peak-moment eligibility skips the day-count gate — the moment itself (a PR,
  // a milestone) proves engagement — but still honors an install or an active
  // snooze so we never nag a user who just dismissed.
  function canShowOnPeakMoment(): boolean {
    if (isNative || isStandalone()) return false
    if (isSuppressed()) return false
    return true
  }

  function dismiss() {
    showBanner.value = false
    deferredPrompt = null
    hasPendingPrompt = false
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS))
  }

  async function install() {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    deferredPrompt = null
    // Hide regardless of outcome — the native prompt can only be triggered once
    showBanner.value = false
    if (outcome === 'accepted') {
      localStorage.setItem(INSTALLED_KEY, 'true')
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
    localStorage.setItem(INSTALLED_KEY, 'true')
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

  // Peak-moment re-surface (#1060): a meaningful signal (new PR, streak
  // milestone) is a high-intent moment to install. It bypasses the raw
  // day-count gate but still respects an install or an active dismissal
  // snooze. No-op unless a Chromium deferred prompt exists or we're on iOS.
  if (peakMoment) {
    watch(peakMoment, (signal) => {
      if (!signal || showBanner.value) return
      if (!canShowOnPeakMoment()) return
      if (deferredPrompt) {
        isIOSPrompt.value = false
        showBanner.value = true
      } else if (isIOS && !isNative && !isStandalone()) {
        isIOSPrompt.value = true
        showBanner.value = true
      }
    })
  }

  return {
    showBanner,
    isIOSPrompt,
    dismiss,
    install,
    destroy,
  }
}
