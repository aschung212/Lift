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

const DISMISS_KEY = 'install-prompt-dismissed'
const MIN_WORKOUT_DAYS = 3

/** Analytics property values accepted by the injected logger (mirrors useAnalytics). */
type InstallEventValue = string | number | boolean | null | undefined

/** Optional analytics sink for install-funnel instrumentation (LIFT-1061). */
export type InstallEventLogger = (
  name: string,
  props?: Record<string, InstallEventValue>,
) => void

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
 *
 * Pass `logEvent` to instrument the install funnel (LIFT-1061): the composable
 * emits `install_prompt_available` (beforeinstallprompt intercepted),
 * `install_banner_shown` (impression, once per session), `install_prompt_result`
 * (native prompt accepted/dismissed), `install_banner_dismissed`, and
 * `app_installed`. Analytics failures never affect banner behavior.
 */
export function useInstallPrompt(
  workoutDayCount: WatchSource<number>,
  logEvent?: InstallEventLogger,
): InstallPromptState {
  const showBanner = ref(false)
  const isIOSPrompt = ref(false)

  let deferredPrompt: BeforeInstallPromptEvent | null = null
  // True when we intercepted beforeinstallprompt but haven't shown the banner yet
  // (waiting for workout data to hydrate past the threshold).
  let hasPendingPrompt = false
  // Guard so the impression event fires at most once per composable lifetime,
  // even though several code paths (immediate, iOS, post-hydration watch) reveal it.
  let bannerShownLogged = false

  function track(name: string, props?: Record<string, InstallEventValue>): void {
    if (!logEvent) return
    try { logEvent(name, props) } catch { /* analytics must never break the prompt */ }
  }

  /**
   * Single reveal path for the banner so the impression is logged exactly once
   * regardless of which trigger (Chromium intercept, iOS, or hydration watch)
   * surfaces it.
   */
  function revealBanner(ios: boolean): void {
    isIOSPrompt.value = ios
    showBanner.value = true
    if (!bannerShownLogged) {
      bannerShownLogged = true
      track('install_banner_shown', { platform: ios ? 'ios' : 'chromium' })
    }
  }

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
    const wasVisible = showBanner.value
    showBanner.value = false
    deferredPrompt = null
    hasPendingPrompt = false
    localStorage.setItem(DISMISS_KEY, 'true')
    if (wasVisible) track('install_banner_dismissed', { platform: isIOSPrompt.value ? 'ios' : 'chromium' })
  }

  async function install() {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    deferredPrompt = null
    // Hide regardless of outcome — the native prompt can only be triggered once
    showBanner.value = false
    track('install_prompt_result', { outcome })
    if (outcome === 'accepted') {
      localStorage.setItem(DISMISS_KEY, 'true')
    }
  }

  function onBeforeInstallPrompt(e: BeforeInstallPromptEvent) {
    // Prevent the browser's mini-infobar
    e.preventDefault()
    deferredPrompt = e

    const ready = shouldShow()
    track('install_prompt_available', { deferred: !ready })
    if (ready) {
      revealBanner(false)
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
    track('app_installed')
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
      revealBanner(true)
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
      revealBanner(false)
    } else if (isIOS && !isNative && !isStandalone()) {
      revealBanner(true)
    }
  })

  return {
    showBanner,
    isIOSPrompt,
    dismiss,
    install,
    destroy,
  }
}
