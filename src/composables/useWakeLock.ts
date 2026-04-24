/**
 * Screen Wake Lock composable.
 *
 * Uses the Screen Wake Lock API to prevent the screen from dimming or
 * locking during active workouts and rest timer countdowns.
 *
 * The API is available in modern browsers (Chrome 84+, Safari 16.4+,
 * Edge 84+) and in Capacitor WKWebView. Falls back to a no-op when
 * the API is unavailable (e.g. Firefox, older browsers).
 *
 * Respects the user's `experience.wakeLock` preference: when the toggle
 * is off (Settings → Experience → Screen Wake Lock), acquire/release no-op.
 */

import { ref } from 'vue'
import { usePreferencesStore } from '../stores/preferences'

let sentinel: WakeLockSentinel | null = null
const active = ref(false)

function isSupported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator
}

function wakeLockAllowed(): boolean {
  try {
    const prefs = usePreferencesStore()
    return prefs.experience?.wakeLock !== false
  } catch {
    return true
  }
}

async function acquire(): Promise<void> {
  if (!wakeLockAllowed() || !isSupported()) return
  // Already held — don't re-acquire
  if (sentinel !== null) return
  try {
    sentinel = await navigator.wakeLock.request('screen')
    active.value = true
    sentinel.addEventListener('release', () => {
      sentinel = null
      active.value = false
    })
  } catch {
    // Request can fail if the document is not visible, or the user
    // denied the permission. Silently ignore — the app still works.
    sentinel = null
    active.value = false
  }
}

async function release(): Promise<void> {
  if (sentinel !== null) {
    try {
      await sentinel.release()
    } catch {
      // Already released or invalid — ignore.
    }
    sentinel = null
    active.value = false
  }
}

export function useWakeLock() {
  return {
    /** Whether the Wake Lock API is available in this browser. */
    isSupported: isSupported(),
    /** Reactive flag — true while a wake lock is actively held. */
    active,
    /** Request a screen wake lock. No-op if unsupported or user disabled. */
    acquire,
    /** Release the current wake lock if held. */
    release,
  }
}
