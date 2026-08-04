/**
 * Composable wrapping the App Badging API (`navigator.setAppBadge` /
 * `navigator.clearAppBadge`) to surface an unfinished-workout nudge on the
 * Home-Screen app icon.
 *
 * When the user backgrounds the app with sets logged today, a subtle count
 * badge re-engages them to come back and finish — a "visual over verbal"
 * cue (Design Principle 4) rather than a notification or extra screen.
 *
 * Supported on iOS 16.4+ Home-Screen PWAs and installed Chromium PWAs. The
 * API is gated behind capability detection and every call is wrapped so it
 * silently no-ops where unsupported (desktop browser tabs, older iOS, the
 * Capacitor WKWebView) — callers never need to branch.
 */

interface BadgeNavigator {
  setAppBadge?: (contents?: number) => Promise<void>
  clearAppBadge?: () => Promise<void>
}

/** Whether the running environment exposes the Badging API. */
function isSupported(): boolean {
  return typeof navigator !== 'undefined' && 'setAppBadge' in navigator
}

/**
 * Set the app-icon badge. A positive `count` shows that number; omitting it
 * (or passing 0) shows a generic dot. Resolves false when unsupported or the
 * platform rejects the request (e.g. permission not granted).
 */
async function setBadge(count?: number): Promise<boolean> {
  if (!isSupported()) return false
  try {
    const nav = navigator as BadgeNavigator
    await nav.setAppBadge?.(count && count > 0 ? count : undefined)
    return true
  } catch {
    return false
  }
}

/** Clear the app-icon badge. Resolves false when unsupported or rejected. */
async function clearBadge(): Promise<boolean> {
  if (!isSupported()) return false
  try {
    const nav = navigator as BadgeNavigator
    await nav.clearAppBadge?.()
    return true
  } catch {
    return false
  }
}

export interface UseAppBadgeReturn {
  isSupported: () => boolean
  setBadge: (count?: number) => Promise<boolean>
  clearBadge: () => Promise<boolean>
}

export function useAppBadge(): UseAppBadgeReturn {
  return { isSupported, setBadge, clearBadge }
}
