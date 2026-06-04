/**
 * Guards an auto-update `window.location.reload()` so it never fires
 * mid-interaction (LIFT-707).
 *
 * When a new service worker activates (`controllerchange`), the page must
 * reload to pick up fresh hashed-chunk filenames — without it, lazy-loaded tabs
 * request old chunk names that no longer exist on the server. But that reload is
 * triggered by an uncontrolled signal (a deploy activating) and can land while
 * the user is mid-set-entry: the settled set-logging modal keeps unsaved
 * weight/reps fields open, and a silent refresh would discard them. That
 * contradicts the app's local-first, never-interrupt-the-UI ethos.
 *
 * This module defers the reload until the user is back in a safe state — no
 * modal open, no input focused — instead of reloading immediately.
 */

/** True when reloading now would not interrupt the user. */
export function isSafeToReload(): boolean {
  if (typeof document === 'undefined') return true
  // A modal is open (it toggles the scroll-lock `modal-open` class on <html>)
  // and may be holding unsaved fields, e.g. the set-logging weight/reps inputs.
  if (document.documentElement.classList.contains('modal-open')) return false
  // The user is actively typing into a field outside a modal (e.g. bodyweight).
  const el = document.activeElement as HTMLElement | null
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
    return false
  }
  return true
}

// Module-scoped guard so overlapping controllerchange events (e.g. two deploys
// landing close together) only ever schedule a single deferred reload.
let reloadScheduled = false

/**
 * Reload immediately if it's safe, otherwise defer until the user returns to a
 * safe state — a modal closes or focus leaves an input. Idempotent: a second
 * call while a reload is already pending is a no-op.
 *
 * @param reload Injectable reload action (defaults to `window.location.reload`);
 *               parameterised so tests don't have to navigate the document.
 */
export function reloadWhenSafe(reload: () => void = () => window.location.reload()): void {
  if (isSafeToReload()) {
    reload()
    return
  }
  if (reloadScheduled) return
  reloadScheduled = true

  let pending: ReturnType<typeof setTimeout> | null = null

  const tryReload = () => {
    if (!isSafeToReload()) return
    cleanup()
    reloadScheduled = false
    reload()
  }

  // Re-check on the next macrotask rather than synchronously. `focusout` fires
  // during the `mousedown`/`touchstart` that moves focus off an input — e.g.
  // tapping a Save button — so a synchronous reload would unload the page before
  // the ensuing `click` handler runs, swallowing that action and losing the
  // user's data. Deferring lets the queued pointer/click events flush first.
  const scheduleCheck = () => {
    if (pending !== null) return
    pending = setTimeout(() => {
      pending = null
      tryReload()
    }, 0)
  }

  // Modal close toggles the `modal-open` class on <html>; an attribute observer
  // re-checks the moment that class changes.
  const observer = typeof MutationObserver !== 'undefined'
    ? new MutationObserver(scheduleCheck)
    : null

  function cleanup() {
    observer?.disconnect()
    document.removeEventListener('focusout', scheduleCheck)
    if (pending !== null) {
      clearTimeout(pending)
      pending = null
    }
  }

  observer?.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  // Blurring out of an input fires a bubbling focusout — re-check then too,
  // since losing focus isn't a class mutation.
  document.addEventListener('focusout', scheduleCheck)
}
