/* global self, caches, Response */
/**
 * Web Share Target handler for Lift.
 *
 * The PWA manifest registers a `share_target` (POST, multipart/form-data) at
 * /share-target so users can share a Strong/Hevy/Lift CSV export from another
 * app directly into Lift. This script is injected into the generated Workbox
 * service worker via `workbox.importScripts` so its `fetch` listener is
 * registered before Workbox's navigation routing — the first listener to call
 * `respondWith` wins, so the POST never falls through to the index.html
 * navigateFallback.
 *
 * Flow: extract the shared file -> stash its text in the Cache API under a
 * known key -> 303-redirect to /?share-target=csv. The app reads and clears
 * the cached entry on launch (see useShareTargetImport).
 *
 * Chromium/Android PWA only; iOS Safari does not implement Web Share Target.
 */
const SHARE_INBOX_CACHE = 'lift-share-inbox'
const SHARE_INBOX_KEY = '/__shared-csv'

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method === 'POST' && url.pathname === '/share-target') {
    event.respondWith(handleShareTarget(event.request))
  }
})

async function handleShareTarget(request) {
  try {
    const formData = await request.formData()
    const file = formData.get('file')
    if (file && typeof file.text === 'function') {
      const text = await file.text()
      if (text) {
        const cache = await caches.open(SHARE_INBOX_CACHE)
        await cache.put(
          SHARE_INBOX_KEY,
          new Response(text, { headers: { 'Content-Type': 'text/csv' } })
        )
      }
    }
  } catch {
    // Swallow — a malformed share still redirects into the app, which simply
    // finds nothing in the inbox and shows no import.
  }
  return Response.redirect('/?share-target=csv', 303)
}
