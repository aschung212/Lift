/**
 * Composable for sending browser/OS notifications when the app is backgrounded.
 * Used by the rest timer to alert users when their rest period is over.
 */

const PERMISSION_KEY = 'notification-permission-asked'

export function useNotification() {
  function isSupported(): boolean {
    return 'Notification' in window
  }

  function isPermissionGranted(): boolean {
    return isSupported() && Notification.permission === 'granted'
  }

  function hasBeenAsked(): boolean {
    return localStorage.getItem(PERMISSION_KEY) === 'true'
  }

  async function requestPermission(): Promise<boolean> {
    if (!isSupported()) return false
    if (Notification.permission === 'granted') return true
    if (Notification.permission === 'denied') return false

    const result = await Notification.requestPermission()
    localStorage.setItem(PERMISSION_KEY, 'true')
    return result === 'granted'
  }

  function notify(title: string, options?: NotificationOptions): void {
    if (!isPermissionGranted()) return
    // Only notify when the app is backgrounded/hidden
    if (document.visibilityState === 'visible') return

    try {
      const swReady = navigator.serviceWorker?.ready
      if (swReady) {
        // Try service worker notification first (works when fully backgrounded)
        swReady.then(registration => {
          registration.showNotification(title, {
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            tag: 'rest-timer',
            renotify: true,
            ...options,
          })
        }).catch(() => {
          // Fallback to basic Notification API
          new Notification(title, {
            icon: '/icon-192.png',
            tag: 'rest-timer',
            ...options,
          })
        })
      } else {
        // No service worker — use basic Notification API
        new Notification(title, {
          icon: '/icon-192.png',
          tag: 'rest-timer',
          ...options,
        })
      }
    } catch {
      // Notification not available in this context
    }
  }

  function notifyRestTimerComplete(): void {
    notify('Rest Complete', {
      body: 'Time to start your next set!',
      tag: 'rest-timer',
      renotify: true,
    })
  }

  return {
    isSupported,
    isPermissionGranted,
    hasBeenAsked,
    requestPermission,
    notify,
    notifyRestTimerComplete,
  }
}
