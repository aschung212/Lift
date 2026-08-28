/**
 * Native App Store review prompt wrapper.
 *
 * Wraps StoreKit's `SKStoreReviewController.requestReview` (exposed on iOS via
 * the `@capacitor-community/app-review` plugin). On web there is no equivalent
 * API, so this is a no-op — PWA users never see a review prompt.
 *
 * The plugin is loaded through a runtime-constructed dynamic import so the web
 * bundle does not statically depend on it. The plugin itself is installed and
 * wired into the native build as part of the Capacitor iOS setup (#531); until
 * then this resolves to a no-op on every platform. The decision of *when* to
 * prompt (rolling caps, satisfaction moments) lives in `useAppReview` and is
 * fully exercised in tests independent of the native bridge.
 */
import { isNative } from './platform'
import { logWarn } from './logger'

// Constructed at runtime so the bundler does not attempt to resolve the
// native-only plugin during the web build.
const APP_REVIEW_PLUGIN = ['@capacitor-community', 'app-review'].join('/')

interface AppReviewPlugin {
  requestReview: () => Promise<void>
}

/**
 * Ask the OS to present its native "Rate this app" prompt.
 *
 * Returns `true` when the native bridge was invoked, `false` when skipped
 * (web platform, or the plugin is not available in the current build). Apple
 * still decides whether to actually surface the prompt and silently rate-limits
 * to a few prompts per year regardless of how often this is called.
 */
export async function requestNativeReview(): Promise<boolean> {
  if (!isNative) return false
  try {
    const mod = (await import(/* @vite-ignore */ APP_REVIEW_PLUGIN)) as {
      AppReview?: AppReviewPlugin
    }
    if (!mod.AppReview?.requestReview) return false
    await mod.AppReview.requestReview()
    return true
  } catch (e) {
    // Plugin not installed yet (pending native setup) or the bridge failed —
    // never let a review prompt break the calling flow.
    logWarn('Native review prompt unavailable', { error: String(e) })
    return false
  }
}
