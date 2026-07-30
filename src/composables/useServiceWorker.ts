import { registerSW } from 'virtual:pwa-register'
import { isNative } from '../lib/platform'
import { syncQueue } from '../lib/syncQueue'

/**
 * A reload triggered by a newly-activated service worker must never destroy
 * in-flight user work (LIFT-1047). Reloading is UNSAFE while:
 *   - a modal is open — the set-logging sheet may hold unsaved weight/reps
 *     typed but not yet saved (`html.modal-open` is set by every modal,
 *     including the log-set sheet), or
 *   - the syncQueue still has un-flushed writes that a reload could interrupt.
 *
 * Pure predicate so the data-integrity decision is unit-testable without a DOM
 * or timers. `true` means "hold the reload for now".
 */
export function shouldDeferReload(modalOpen: boolean, pendingWrites: number): boolean {
  return modalOpen || pendingWrites > 0
}

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
// Module-scoped singleton state. The SW must be registered exactly once per
// document; guarding here keeps the composable safe to call from multiple
// components without leaking duplicate listeners or overlapping update polls.
let swRegistration: ServiceWorkerRegistration | undefined
let registered = false

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
  })

  // Check for SW update on visibility change (tab switch back, app resume)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') swRegistration?.update()
  })

  // Is it safe to reload right now? Reads the live modal-open flag and the
  // pending-write count and defers to the pure predicate above.
  const isReloadUnsafe = () =>
    shouldDeferReload(
      document.documentElement.classList.contains('modal-open'),
      syncQueue.pending,
    )

  // When a reload has to wait for a safe moment, poll for one. 3s is frequent
  // enough to feel instant after the user closes the modal / writes drain, but
  // idle-cheap while they keep logging.
  const DEFER_POLL_MS = 3 * 1000
  let deferTimer: ReturnType<typeof setInterval> | undefined
  const reloadWhenSafe = () => {
    if (isReloadUnsafe()) return
    if (deferTimer !== undefined) clearInterval(deferTimer)
    window.location.reload()
  }
  const scheduleDeferredReload = () => {
    if (deferTimer !== undefined) return // already waiting
    deferTimer = setInterval(reloadWhenSafe, DEFER_POLL_MS)
  }

  // Listen for the controlling SW changing — means auto-update activated.
  // On first visit currentController is null; skip reload to avoid a surprise refresh.
  // On subsequent changes a new SW took over — reload to pick up fresh chunk hashes
  // (without this, lazy-loaded tabs request old hashed filenames that no longer exist).
  // But NOT while the user is mid-set: a deploy landing during active logging must
  // not discard unsaved input or interrupt a write — defer until it's safe (LIFT-1047).
  let currentController = navigator.serviceWorker?.controller
  navigator.serviceWorker?.addEventListener('controllerchange', () => {
    if (currentController) {
      if (isReloadUnsafe()) {
        scheduleDeferredReload()
      } else {
        window.location.reload()
      }
    }
    currentController = navigator.serviceWorker?.controller ?? null
  })

  return { checkForSWUpdate }
}
