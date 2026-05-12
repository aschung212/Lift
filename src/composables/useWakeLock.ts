/**
 * Screen Wake Lock composable.
 *
 * Prevents the screen from dimming during active workouts (rest timer
 * running or set-logging modal open). Uses the Screen Wake Lock API
 * where available; silently no-ops on unsupported browsers.
 *
 * The lock is automatically re-acquired when the page regains visibility
 * (iOS Safari releases wake locks on tab switch / screen lock).
 */

import { ref, watch, onUnmounted, type Ref } from 'vue'

let sentinel: WakeLockSentinel | null = null
// Tracks an in-flight acquire so a rapid second `true` toggle can wait for
// it to settle instead of issuing a duplicate concurrent request.
let acquireInFlight: Promise<void> | null = null
const wakeLockActive = ref(false)

/** Whether the browser supports the Screen Wake Lock API */
export function isWakeLockSupported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator
}

async function acquireLock(isCancelled: () => boolean = () => false): Promise<void> {
  if (!isWakeLockSupported()) return

  if (acquireInFlight) {
    await acquireInFlight
  }

  if (sentinel !== null) return // already held
  if (isCancelled()) return // state flipped while we waited for the previous request

  const task = (async () => {
    let acquired: WakeLockSentinel
    try {
      acquired = await navigator.wakeLock.request('screen')
    } catch {
      // request() can throw if the page is hidden or on low battery
      return
    }

    // State flipped mid-await — release immediately rather than orphaning
    // the lock we just acquired.
    if (isCancelled()) {
      try {
        await acquired.release()
      } catch {
        // Already released
      }
      return
    }

    sentinel = acquired
    wakeLockActive.value = true
    acquired.addEventListener('release', () => {
      if (sentinel === acquired) {
        sentinel = null
        wakeLockActive.value = false
      }
    })
  })()

  acquireInFlight = task
  try {
    await task
  } finally {
    if (acquireInFlight === task) acquireInFlight = null
  }
}

async function releaseLock(): Promise<void> {
  // Wait for any in-flight acquire to settle. Its cancellation signal will
  // already have been raised by the watcher's onCleanup, so the task either
  // skipped the request or released its just-acquired sentinel by the time
  // we get here.
  if (acquireInFlight) {
    await acquireInFlight
  }
  if (sentinel === null) return
  const held = sentinel
  sentinel = null
  wakeLockActive.value = false
  try {
    await held.release()
  } catch {
    // Already released
  }
}

/**
 * Keeps the screen awake while `shouldLock` is true.
 * Automatically re-acquires on visibility change (iOS releases locks
 * when the tab is backgrounded).
 *
 * @param shouldLock — reactive boolean indicating whether the lock is needed
 * @param enabled — reactive boolean for the user's preference toggle
 */
export function useWakeLock(shouldLock: Ref<boolean>, enabled: Ref<boolean>) {
  function onVisibilityChange() {
    if (document.visibilityState === 'visible' && shouldLock.value && enabled.value) {
      // If shouldLock/enabled flip back to false while the request is
      // pending, release the lock instead of orphaning it.
      acquireLock(() => !(shouldLock.value && enabled.value))
    }
  }

  watch(
    () => shouldLock.value && enabled.value,
    async (want, _prev, onCleanup) => {
      let cancelled = false
      onCleanup(() => {
        cancelled = true
      })

      if (want) {
        await acquireLock(() => cancelled)
        if (!cancelled) {
          document.addEventListener('visibilitychange', onVisibilityChange)
        }
      } else {
        document.removeEventListener('visibilitychange', onVisibilityChange)
        await releaseLock()
      }
    },
    { immediate: true },
  )

  onUnmounted(() => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    releaseLock()
  })

  return { wakeLockActive }
}
