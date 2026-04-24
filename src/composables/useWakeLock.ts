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
const wakeLockActive = ref(false)

/** Whether the browser supports the Screen Wake Lock API */
export function isWakeLockSupported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator
}

async function acquireLock(): Promise<void> {
  if (!isWakeLockSupported()) return
  if (sentinel !== null) return // already held
  try {
    sentinel = await navigator.wakeLock.request('screen')
    wakeLockActive.value = true
    sentinel.addEventListener('release', () => {
      sentinel = null
      wakeLockActive.value = false
    })
  } catch {
    // request() can throw if the page is hidden or on low battery
    sentinel = null
    wakeLockActive.value = false
  }
}

async function releaseLock(): Promise<void> {
  if (sentinel === null) return
  try {
    await sentinel.release()
  } catch {
    // Already released
  }
  sentinel = null
  wakeLockActive.value = false
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
      acquireLock()
    }
  }

  watch(
    () => shouldLock.value && enabled.value,
    async (want) => {
      if (want) {
        await acquireLock()
        document.addEventListener('visibilitychange', onVisibilityChange)
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
