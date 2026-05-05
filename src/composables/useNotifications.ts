/**
 * Notification composable for the rest timer.
 *
 * Uses the Web Notification API when available (PWA / browser).
 * Falls back to Capacitor Local Notifications when running as a native app.
 *
 * Only fires when the document is hidden (app backgrounded / screen locked),
 * since in-app audio beeps and haptics already handle the foreground case.
 *
 * Respects the user's `experience.restTimerNotifications` preference.
 */

import { usePreferencesStore } from '../stores/preferences'

/** Whether the Notification API is available in this environment. */
export function notificationsAvailable(): boolean {
  return typeof Notification !== 'undefined'
}

/** Current permission state, or 'unavailable' if the API doesn't exist. */
export function notificationPermission(): NotificationPermission | 'unavailable' {
  if (!notificationsAvailable()) return 'unavailable'
  return Notification.permission
}

/**
 * Request notification permission from the user.
 * Returns the resulting permission state.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission | 'unavailable'> {
  if (!notificationsAvailable()) return 'unavailable'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  const result = await Notification.requestPermission()
  return result
}

/**
 * Show a rest timer notification if the app is backgrounded and
 * the user has the preference enabled.
 */
export function showRestTimerNotification(): void {
  // Only notify when backgrounded — foreground has audio beeps
  if (document.visibilityState !== 'hidden') return

  // Check user preference
  try {
    const prefs = usePreferencesStore()
    if (prefs.experience.restTimerNotifications === false) return
  } catch {
    // Pinia not ready — skip
    return
  }

  if (!notificationsAvailable() || Notification.permission !== 'granted') return

  // Try service worker notification first (works on lock screen)
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.ready.then(reg => {
      reg.showNotification('Rest Timer Done', {
        body: 'Time to start your next set!',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: 'rest-timer', // Replace previous notification
        renotify: true,
        requireInteraction: false,
      }).catch(() => {
        // Fallback to basic Notification
        showBasicNotification()
      })
    }).catch(() => {
      showBasicNotification()
    })
  } else {
    showBasicNotification()
  }
}

function showBasicNotification(): void {
  try {
    new Notification('Rest Timer Done', {
      body: 'Time to start your next set!',
      icon: '/icon-192.png',
      tag: 'rest-timer',
    })
  } catch {
    // Notification constructor can throw in some environments
  }
}
