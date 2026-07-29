/**
 * Custom service-worker logic for rest-timer notification action buttons (LIFT-751).
 *
 * The Workbox `generateSW` build has no `notificationclick` handler of its own, so
 * without this an action button on the "Rest Complete" notification would render but
 * do nothing. This script is injected into the generated SW via `workbox.importScripts`
 * (see vite.config.js) and handles the two rest-timer actions plus the default body tap:
 *
 *   - "Log Set" (`log-set`) / body tap  → focus the open app (or open it at the workouts tab)
 *   - "Rest Again" (`rest-again`)        → focus the app and postMessage so the client can
 *                                          restart the rest timer for another round
 *
 * It intentionally scopes itself to the `lift-rest-timer` tag so unrelated future
 * notifications are left to their own handling.
 */
/* global self, clients */

self.addEventListener('notificationclick', (event) => {
  const notification = event.notification
  if (notification.tag !== 'lift-rest-timer') return

  const action = event.action
  notification.close()

  event.waitUntil(
    (async () => {
      const windowClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })

      // Prefer focusing an already-open window so we land back on the workout in progress.
      let client = windowClients.find((c) => 'focus' in c) || null
      if (client) {
        await client.focus()
      } else if (self.clients.openWindow) {
        client = await self.clients.openWindow('/?tab=workouts')
      }

      if (action === 'rest-again' && client) {
        client.postMessage({ type: 'rest-timer-action', action: 'rest-again' })
      }
    })(),
  )
})
