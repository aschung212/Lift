/**
 * Composable for sending browser notifications when the app is backgrounded.
 * Used by the rest timer to alert users when their rest period is complete.
 */

const PERMISSION_KEY = 'notification-permission-asked'

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
 * Show a notification if the app is backgrounded and permission is granted.
 * Returns the Notification instance if shown, null otherwise.
 */
function notify(title: string, options?: NotificationOptions): Notification | null {
  if (!hasPermission() || !isBackgrounded()) return null

  const notification = new Notification(title, {
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'lift-rest-timer',
    renotify: true,
    ...options,
  })

  // Auto-close after 5 seconds
  setTimeout(() => notification.close(), 5000)

  // Focus the app when the notification is clicked
  notification.onclick = () => {
    window.focus()
    notification.close()
  }

  return notification
}

/** Whether we've already asked the user for permission in a previous session */
function hasAskedBefore(): boolean {
  return localStorage.getItem(PERMISSION_KEY) === 'true'
}

export function useNotification() {
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
