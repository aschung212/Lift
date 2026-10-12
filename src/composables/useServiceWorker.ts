import { registerSW } from 'virtual:pwa-register'
import { isNative } from '../lib/platform'
import { guardedReload } from '../lib/reloadGuard'

/**
 * Service worker lifecycle management for the web (PWA) build.
 *
 * On the native Capacitor build (#532) the entire service worker is skipped:
 * WKWebView serves the web assets bundled inside the .ipa at build time, and
 * those assets are refreshed via `cap sync` — not through a web caching layer.
 * Registering Workbox there is at best redundant and at worst harmful: the
 * `controllerchange` → reload handler can trigger reload loops in the
 * native shell, and a stale SW cache could shadow the freshly
 * bundled native assets. The Vite PWA plugin is also disabled at build time
 * for Capacitor builds (see `CAPACITOR_BUILD` in `vite.config.js`), so this
 * runtime guard is the belt-and-suspenders second layer.
 *
 * @returns `checkForSWUpdate` — call after meaningful user actions to poll for
 *          a new version. A no-op on native.
 */
// Module-scoped singleton state. The SW must be registered exactly once per
// document; guarding here keeps the composable safe to call from multiple
// components without leaking duplicate listeners or overlapping update polls.
let swRegistration: ServiceWorkerRegistration | undefined
let registered = false
// Whether this document has already decided what a new worker means for it.
let newWorkerHandled = false

/**
 * The guardedReload reason for a new service worker, scoped to the build this
 * document booted (LIFT-1511). index.html names that build with two hashed
 * assets: the entry script, whose hash covers every chunk the page can still
 * lazy-load (a chunk's hash covers the hashed names of what it imports), and
 * the stylesheet, the one asset the script does not name.
 *
 * One reload per reason per session is the right bound for a loop: a loop
 * keeps booting the same build, so its second reload from that build finds
 * the reason spent. It is the wrong bound for a session that sees two
 * deploys. A session-wide reason would suppress the second one and leave this
 * document asking for chunk hashes the new worker no longer serves, so the
 * first lazy surface opened after it (Settings, Workout Complete) would fail
 * into the ErrorBoundary. vite-plugin-pwa's unguarded reload had been covering
 * that. What this cannot tell apart is a deploy that changes neither asset (a
 * public/ file, the Workbox config): it still installs a new worker, its
 * reload lands on the same build, and that build's reason is spent for the
 * rest of the session.
 */
function newWorkerReloadReason(): string {
  const entry = document.querySelector('script[type="module"][src]')?.getAttribute('src')
  const styles = document.querySelector('link[rel="stylesheet"][href]')?.getAttribute('href')
  const build = [entry, styles].filter(Boolean).join(' ')
  return build ? `sw-controllerchange ${build}` : 'sw-controllerchange'
}

/**
 * Reload, at most once per document, for a service worker that took control
 * of this page (LIFT-1511). Both signals for that event end here: the
 * `controllerchange` listener below, and vite-plugin-pwa's `activated` handler
 * through `onNeedReload`. Without that callback the plugin runs a bare
 * `window.location.reload()` of its own in autoUpdate mode, outside the #1155
 * guard, so a worker that re-activated on every boot reloaded forever whatever
 * the guard answered.
 *
 * A normal update fires both signals in one document, controllerchange first.
 * The first one decides and the second is dropped. The reason cannot change
 * within a document, so asking again could only find it spent and report a
 * loop to Sentry that is not one.
 */
function reloadForNewWorker(): void {
  if (newWorkerHandled) return
  newWorkerHandled = true
  guardedReload(newWorkerReloadReason())
}

export function useServiceWorker(): { checkForSWUpdate: () => void } {
  // Native Capacitor build: no service worker at all.
  if (isNative) {
    return { checkForSWUpdate: () => {} }
  }

  // Expose a function components can call after meaningful user actions.
  // Reads the module-scoped registration so it stays valid across callers.
  const checkForSWUpdate = () => swRegistration?.update()

  // Already wired up by an earlier caller — reuse the existing registration.
  if (registered) {
    return { checkForSWUpdate }
  }
  registered = true

  registerSW({
    onRegisteredSW(_url, registration) {
      swRegistration = registration ?? undefined
      // Poll for updates every 10 minutes
      setInterval(() => registration?.update(), 10 * 60 * 1000)
    },
    onOfflineReady() { /* SW installed, app works offline */ },
    // Passing this is what stops registerSW running its own bare
    // window.location.reload() when a new worker activates (LIFT-1511).
    onNeedReload: reloadForNewWorker,
  })

  // Check for SW update on visibility change (tab switch back, app resume)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') swRegistration?.update()
  })

  // Listen for the controlling SW changing — means auto-update activated.
  // On first visit currentController is null; skip reload to avoid a surprise refresh.
  // On subsequent changes a new SW took over — reload to pick up fresh chunk hashes
  // (without this, lazy-loaded tabs request old hashed filenames that no longer exist).
  // The reload is circuit-broken (#1155): one automatic reload per build per
  // session, so a controllerchange that re-fires every boot degrades into a
  // Sentry report instead of an infinite reload loop on the installed PWA.
  let currentController = navigator.serviceWorker?.controller
  navigator.serviceWorker?.addEventListener('controllerchange', () => {
    if (currentController) reloadForNewWorker()
    currentController = navigator.serviceWorker?.controller ?? null
  })

  return { checkForSWUpdate }
}
