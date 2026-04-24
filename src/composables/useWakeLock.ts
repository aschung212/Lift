/**
 * Screen Wake Lock composable.
 *
 * Prevents the screen from dimming during active workouts and rest timers
 * using the Screen Wake Lock API (supported in Safari 16.4+ and all modern
 * browsers). Gracefully no-ops when the API is unavailable.
 *
 * The wake lock is automatically re-acquired when the page regains visibility
 * (e.g. user switches back from another app) — the browser releases the lock
 * on visibility change, so we need to listen and re-request.
 */

import { ref, readonly, onScopeDispose } from 'vue'

const wakeLockSentinel = ref<WakeLockSentinel | null>(null)
const isSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator

/** Re-acquire the lock when the page becomes visible again. */
function handleVisibilityChange() {
  if (document.visibilityState === 'visible' && wakeLockSentinel.value === null) {
    // Only re-acquire if we had an active lock that was released by the browser
    requestWakeLock()
  }
}

let visibilityListenerAttached = false
let activeRequestCount = 0

async function requestWakeLock(): Promise<void> {
  if (!isSupported) return
  if (wakeLockSentinel.value !== null) return

  try {
    const sentinel = await navigator.wakeLock.request('screen')
    wakeLockSentinel.value = sentinel

    sentinel.addEventListener('release', () => {
      wakeLockSentinel.value = null
    })
  } catch {
    // Wake lock request can fail if the page is not visible or the device
    // is low on battery. This is expected and safe to ignore.
  }
}

function releaseWakeLock(): void {
  if (wakeLockSentinel.value) {
    wakeLockSentinel.value.release()
    wakeLockSentinel.value = null
  }
}

export function useWakeLock() {
  /**
   * Acquire the wake lock. Call when a workout/rest timer starts.
   * Multiple calls are safe — only one lock is held at a time, and
   * a reference count ensures the lock persists until all callers release.
   */
  async function acquire(): Promise<void> {
    activeRequestCount++
    if (!visibilityListenerAttached) {
      document.addEventListener('visibilitychange', handleVisibilityChange)
      visibilityListenerAttached = true
    }
    await requestWakeLock()
  }

  /**
   * Release the wake lock. Call when the workout/rest timer stops.
   * The lock is only actually released when all callers have released.
   */
  function release(): void {
    activeRequestCount = Math.max(0, activeRequestCount - 1)
    if (activeRequestCount === 0) {
      releaseWakeLock()
      if (visibilityListenerAttached) {
        document.removeEventListener('visibilitychange', handleVisibilityChange)
        visibilityListenerAttached = false
      }
    }
  }

  onScopeDispose(() => {
    // If the component unmounts while holding a lock, release it
    if (activeRequestCount > 0) {
      activeRequestCount = 0
      releaseWakeLock()
      if (visibilityListenerAttached) {
        document.removeEventListener('visibilitychange', handleVisibilityChange)
        visibilityListenerAttached = false
      }
    }
  })

  return {
    /** Whether the Screen Wake Lock API is available in this browser */
    isSupported,
    /** Whether a wake lock is currently held */
    isActive: readonly(wakeLockSentinel),
    acquire,
    release,
  }
}
