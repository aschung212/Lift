import { registerSW } from 'virtual:pwa-register'
import { isNative } from '../lib/platform'

/**
 * Service worker lifecycle management for the web (PWA) build.
 *
 * On the native Capacitor build (#532) the entire service worker is skipped:
 * WKWebView serves the web assets bundled inside the .ipa at build time, and
 * those assets are refreshed via `cap sync` — not through a web caching layer.
 * Registering Workbox there is at best redundant and at worst harmful: the
 * `controllerchange → window.location.reload()` handler can trigger reload
 * loops in the native shell, and a stale SW cache could shadow the freshly
 * bundled native assets. The Vite PWA plugin is also disabled at build time
 * for Capacitor builds (see `CAPACITOR_BUILD` in `vite.config.js`), so this
 * runtime guard is the belt-and-suspenders second layer.
 *
 * @returns `checkForSWUpdate` — call after meaningful user actions to poll for
 *          a new version. A no-op on native.
 */
export function useServiceWorker(): { checkForSWUpdate: () => void } {
  // Native Capacitor build: no service worker at all.
  if (isNative) {
    return { checkForSWUpdate: () => {} }
  }

  let swRegistration: ServiceWorkerRegistration | undefined
  registerSW({
    onRegisteredSW(_url, registration) {
      swRegistration = registration ?? undefined
      // Poll for updates every 10 minutes
      setInterval(() => registration?.update(), 10 * 60 * 1000)
    },
    onOfflineReady() { /* SW installed, app works offline */ },
  })

  // Check for SW update on visibility change (tab switch back, app resume)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') swRegistration?.update()
  })

  // Listen for the controlling SW changing — means auto-update activated.
  // On first visit currentController is null; skip reload to avoid a surprise refresh.
  // On subsequent changes a new SW took over — reload to pick up fresh chunk hashes
  // (without this, lazy-loaded tabs request old hashed filenames that no longer exist).
  let currentController = navigator.serviceWorker?.controller
  navigator.serviceWorker?.addEventListener('controllerchange', () => {
    if (currentController) {
      window.location.reload()
    }
    currentController = navigator.serviceWorker?.controller ?? null
  })

  // Expose a function components can call after meaningful user actions
  function checkForSWUpdate() { swRegistration?.update() }

  return { checkForSWUpdate }
}
