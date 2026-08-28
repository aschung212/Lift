/**
 * Composable for sending browser notifications when the app is backgrounded.
 * Used by the rest timer to alert users when their rest period is complete.
 *
 * Handles two scenarios:
 * 1. App is currently backgrounded — show notification immediately
 * 2. App was backgrounded during a timer — show notification when interval resumes
 *    (mobile browsers suspend JS, so the timer fires when the user returns)
 *
 * Uses ServiceWorkerRegistration.showNotification() when available (required on
 * Android Chrome and iOS 16.4+ PWAs), falling back to the Notification constructor.
 */

import { ref, onUnmounted, type Ref } from 'vue'

const PERMISSION_KEY = 'notification-permission-asked'

/** A single notification action button (subset of the DOM NotificationAction type). */
export interface NotifAction {
  action: string
  title: string
  icon?: string
}

/**
 * Action buttons attached to the "Rest Complete" notification (LIFT-751). They only
 * render when the notification is shown via ServiceWorkerRegistration.showNotification
 * and are handled by public/sw-notification-handler.js. Two is the platform-supported
 * maximum on most surfaces, so keep this list to two.
 */
export const REST_TIMER_NOTIFICATION_ACTIONS: NotifAction[] = [
  { action: 'rest-again', title: 'Rest Again' },
  { action: 'log-set', title: 'Log Set' },
]

/** Whether the browser supports the Notification API */
function isSupported(): boolean {
  return 'Notification' in window
}

/** Whether we already have permission granted */
function hasPermission(): boolean {
  return isSupported() && Notification.permission === 'granted'
}

/** Whether permission was previously denied (don't ask again) */
function isDenied(): boolean {
  return isSupported() && Notification.permission === 'denied'
}

/** Whether the app is currently not visible to the user */
function isBackgrounded(): boolean {
  return document.visibilityState === 'hidden'
}

/**
 * Request notification permission. Returns true if granted.
 * Only asks once — if denied, returns false without prompting.
 */
async function requestPermission(): Promise<boolean> {
  if (!isSupported()) return false
  if (hasPermission()) return true
  if (isDenied()) return false

  const result = await Notification.requestPermission()
  localStorage.setItem(PERMISSION_KEY, 'true')
  return result === 'granted'
}

/**
 * Show a notification via ServiceWorker (preferred) or Notification constructor (fallback).
 * Fires when the app is backgrounded OR was recently backgrounded (covers the case where
 * the browser suspended JS and the timer fires after the user returns).
 */
async function notify(
  title: string,
  options?: NotificationOptions & { wasBackgrounded?: boolean; actions?: NotifAction[] },
): Promise<boolean> {
  if (!hasPermission()) return false

  const { wasBackgrounded: wasBg, ...notifOptions } = options ?? {}

  // Only fire if the app IS backgrounded or WAS backgrounded during the timer
  if (!isBackgrounded() && !wasBg) return false

  // `renotify` is a non-standard but widely-supported Chrome/Android extension
  // that re-fires a notification with the same tag (so a second rest-timer
  // completion still alerts). It's missing from the standard NotificationOptions
  // TS type, so we extend it locally rather than asserting the whole object.
  // `actions` (LIFT-751) is likewise SW-only and absent from the lib type.
  const finalOptions: NotificationOptions & { renotify?: boolean; actions?: NotifAction[] } = {
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'lift-rest-timer',
    renotify: true,
    ...notifOptions,
  }

  try {
    // Prefer ServiceWorker showNotification — required on Android Chrome & iOS PWAs
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg) {
      await reg.showNotification(title, finalOptions)
      return true
    }
  } catch {
    // Fall through to constructor fallback
  }

  try {
    // The Notification constructor rejects `actions` (persistent-notification
    // only — Chrome throws a TypeError), so strip them and show a plain
    // notification rather than none at all.
    const constructorOptions = { ...finalOptions }
    delete constructorOptions.actions
    const notification = new Notification(title, constructorOptions)
    setTimeout(() => notification.close(), 5000)
    notification.onclick = () => {
      window.focus()
      notification.close()
    }
    return true
  } catch {
    // Notification constructor not supported (some mobile browsers)
    return false
  }
}

/** Whether we've already asked the user for permission in a previous session */
function hasAskedBefore(): boolean {
  return localStorage.getItem(PERMISSION_KEY) === 'true'
}

/**
 * Tracks whether the document was backgrounded since calling `startTracking()`.
 * Used by the rest timer to know if a notification should fire even though the
 * app is now visible (because JS was suspended while backgrounded).
 */
export interface UseBackgroundTrackerReturn {
  wasBackgrounded: Ref<boolean>
  startTracking: () => void
  stopTracking: () => void
}

export function useBackgroundTracker(): UseBackgroundTrackerReturn {
  const wasBackgrounded = ref(false)

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      wasBackgrounded.value = true
    }
  }

  function startTracking() {
    wasBackgrounded.value = false
    document.addEventListener('visibilitychange', onVisibilityChange)
  }

  function stopTracking() {
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }

  onUnmounted(() => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
  })

  return { wasBackgrounded, startTracking, stopTracking }
}

export interface UseNotificationReturn {
  isSupported: () => boolean
  hasPermission: () => boolean
  isDenied: () => boolean
  isBackgrounded: () => boolean
  hasAskedBefore: () => boolean
  requestPermission: () => Promise<boolean>
  notify: (title: string, options?: NotificationOptions & { wasBackgrounded?: boolean; actions?: NotifAction[] }) => Promise<boolean>
}

export function useNotification(): UseNotificationReturn {
  return {
    isSupported,
    hasPermission,
    isDenied,
    isBackgrounded,
    hasAskedBefore,
    requestPermission,
    notify,
  }
}
