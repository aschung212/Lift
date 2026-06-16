/*
 * Rest-timer notification action handling (LIFT-751).
 *
 * Imported into the Workbox-generated service worker via `workbox.importScripts`
 * (see vite.config.js). The rest-timer notification declares action buttons
 * ("+1 min" / "Log next set"); when one is tapped — or the notification body
 * itself is tapped — the platform fires `notificationclick` in THIS service
 * worker, not in the page. We close the notification, surface/focus an open
 * Lift window, and relay the chosen action to the page so it can react (e.g.
 * snooze the rest timer). If no window is open we open one on the Workouts tab.
 *
 * Action buttons render fully on Android/desktop Chromium and partially on
 * iOS 16.4+ Home-Screen PWAs; the default body tap is handled identically so
 * the feature degrades gracefully where buttons are not shown.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  // '' (empty) means the notification body itself was tapped, not a button.
  const action = event.action || 'open'

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            return client.focus().then((focused) => {
              ;(focused || client).postMessage({
                type: 'lift-rest-timer-action',
                action,
              })
            })
          }
        }
        // No open window — launch one on the Workouts tab.
        if (self.clients.openWindow) {
          return self.clients.openWindow('./?tab=workouts')
        }
        return undefined
      }),
  )
})
