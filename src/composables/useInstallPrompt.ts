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
 * Permanent suppression — set only when the user actually installs (accepts the
 * native prompt or `appinstalled` fires). Once installed, never nudge again.
 */
const DISMISS_KEY = 'install-prompt-dismissed'
/**
 * Soft dismissal — a timestamp (epoch ms) until which the banner stays hidden.
 * Tapping the banner's X snoozes rather than suppressing forever, so a user who
 * dismisses before understanding the value gets a second chance ~30 days later.
 */
const SNOOZE_KEY = 'install-prompt-snoozed-until'
const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const MIN_WORKOUT_DAYS = 3

/** True when a soft-dismiss snooze is currently active. */
function isSnoozed(): boolean {
  const raw = localStorage.getItem(SNOOZE_KEY)
  if (!raw) return false
  const until = Number(raw)
  // A corrupt/non-numeric value should not wedge the banner off forever.
  if (!Number.isFinite(until)) return false
  return Date.now() < until
}

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
  /** Soft-dismiss the banner (snoozes for ~30 days rather than forever). */
  dismiss: () => void
  /** Trigger the native install prompt (Chrome/Edge). No-op on iOS. */
  install: () => Promise<void>
  /**
   * Re-surface the banner at a peak engagement moment (a fresh PR, streak
   * milestone, etc.). Bypasses the raw workout-day gate — a PR is a stronger
   * install signal than 3 logged days — but still honors an installed device,
   * an active snooze, and standalone/native. No-op when nothing to install.
   */
  resurface: () => void
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

  /**
   * @param ignoreEngagementGate skip the MIN_WORKOUT_DAYS check — used by
   *   {@link resurface} when a peak moment already proves engagement.
   */
  function shouldShow(ignoreEngagementGate = false): boolean {
    // Never show in native or already-installed PWA
    if (isNative || isStandalone()) return false
    // User already installed — permanent suppression
    if (localStorage.getItem(DISMISS_KEY)) return false
    // User soft-dismissed recently — respect the snooze window
    if (isSnoozed()) return false
    // Not enough engagement (unless a peak moment overrides the gate)
    if (!ignoreEngagementGate && getDayCount() < MIN_WORKOUT_DAYS) return false
    return true
  }

  function dismiss() {
    showBanner.value = false
    deferredPrompt = null
    hasPendingPrompt = false
    // Snooze rather than suppress forever — re-surface after the cooldown so a
    // user who dismissed before seeing the value gets another chance.
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS))
  }

  function resurface() {
    if (showBanner.value) return
    if (!shouldShow(true)) return
    if (deferredPrompt) {
      isIOSPrompt.value = false
      showBanner.value = true
    } else if (isIOS && !isNative && !isStandalone()) {
      isIOSPrompt.value = true
      showBanner.value = true
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
      localStorage.setItem(DISMISS_KEY, 'true')
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
    localStorage.setItem(DISMISS_KEY, 'true')
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
    resurface,
    destroy,
  }
}
