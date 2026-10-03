/**
 * Keeps navigation preload OFF on this service worker's registration (LIFT-1512).
 *
 * Navigation preload makes the browser start a network fetch for every navigation
 * in parallel with booting the service worker, for the worker to answer with via
 * `event.preloadResponse`. Logbook's worker never reads it: every navigation the
 * app makes is taken by the `navigateFallback` route, which generateSW registers
 * ahead of every runtime route and which answers from the precache. So with the
 * preload on, every launch also fetched the page over the network, at the moment
 * a gym connection can least afford it, and the worker threw that response away;
 * Chrome logs "The service worker navigation preload request was cancelled before
 * 'preloadResponse' settled" for each one.
 *
 * WHY `navigationPreload: false` IN vite.config.js IS NOT ENOUGH ON ITS OWN. The
 * setting is not part of the worker: `navigationPreload.enable()` sets a flag on
 * the REGISTRATION, and the registration outlives every worker update. From
 * 2026-05-06 (#443) to LIFT-1512 the generated worker called `enable()` on every
 * activation, so every install from that window has the flag set. A worker that
 * merely stops calling `enable()` leaves it set for good, and generateSW has no
 * option that emits the `disable()` call. This script, pulled into the generated
 * worker by `workbox.importScripts` (see vite.config.js), makes that call.
 *
 * It runs on every activation, not once. That keeps the registration's state a
 * function of the worker that is running rather than of every worker that ever
 * ran, at the cost of one call per update.
 *
 * serviceWorkerNavigationPreload.test.ts drives this script against a
 * registration an older worker left preload enabled on, and derives from the
 * evaluated vite.config.js why the preload must stay off.
 */
/* global self */

self.addEventListener('activate', (event) => {
  // Safari before 15.4 has no NavigationPreloadManager, and so no preload to stop.
  const preload = self.registration && self.registration.navigationPreload
  if (!preload) return
  // waitUntil keeps the worker alive until the browser has recorded the change.
  // During `activate` the registration's active worker is this one, so the
  // spec's only rejection (no active worker) cannot apply, and a rejected
  // activate promise would not fail activation anyway.
  event.waitUntil(preload.disable())
})
