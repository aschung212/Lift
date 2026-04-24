/**
 * Screen Wake Lock composable.
 *
 * Requests a screen wake lock via the Screen Wake Lock API to prevent
 * the display from dimming or locking during active rest timer countdowns.
 *
 * Gracefully no-ops when the API is unavailable (older browsers, some
 * iOS versions, Capacitor without the plugin). Re-acquires the lock
 * automatically when the page regains visibility (required by the spec —
 * the browser releases locks on visibility change).
 *
 * Respects the user's `experience.screenWakeLock` preference.
 */

import { ref, onUnmounted } from 'vue'
import { usePreferencesStore } from '../stores/preferences'

let sentinel: WakeLockSentinel | null = null
const active = ref(false)

function isSupported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator
}

async function acquire(): Promise<void> {
  if (!isSupported()) return

  try {
    const prefs = usePreferencesStore()
    if (prefs.experience?.screenWakeLock === false) return
  } catch {
    // Pinia not ready — allow by default
  }

  try {
    sentinel = await navigator.wakeLock.request('screen')
    active.value = true
    sentinel.addEventListener('release', () => {
      active.value = false
      sentinel = null
    })
  } catch {
    // Permission denied or low battery — silently degrade
    active.value = false
  }
}

async function release(): Promise<void> {
  if (sentinel) {
    try {
      await sentinel.release()
    } catch {
      // Already released
    }
    sentinel = null
    active.value = false
  }
}

/**
 * Tracks whether the consumer wants the lock held.
 * Separate from `active` because the browser can release the lock
 * on visibility change even though the timer is still running.
 */
let _shouldHold = false

function onVisibilityChange() {
  if (document.visibilityState === 'visible' && _shouldHold) {
    acquire()
  }
}

export function useWakeLock() {
  const startHolding = async () => {
    _shouldHold = true
    document.addEventListener('visibilitychange', onVisibilityChange)
    await acquire()
  }

  const stopHolding = async () => {
    _shouldHold = false
    document.removeEventListener('visibilitychange', onVisibilityChange)
    await release()
  }

  onUnmounted(() => {
    stopHolding()
  })

  return {
    /** Whether the wake lock is currently active. */
    active,
    /** Whether the Wake Lock API is supported in this browser (evaluated at call time). */
    get supported() { return isSupported() },
    /** Request the wake lock (e.g. when timer starts). */
    startHolding,
    /** Release the wake lock (e.g. when timer stops/completes). */
    stopHolding,
  }
}
