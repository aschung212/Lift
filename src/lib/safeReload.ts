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
 * This module defers the reload until a genuinely safe moment instead of
 * reloading immediately. The two trigger moments are deliberately chosen to
 * avoid racing with user input:
 *   1. The page becomes hidden (backgrounded or navigated away) — the safest
 *      possible moment: nothing on screen to interrupt, and the user gets the
 *      fresh version when they return.
 *   2. An open modal closes (its scroll-lock class is removed) and nothing else
 *      blocks — re-checked via a class MutationObserver.
 *
 * We deliberately do NOT trigger off `focusout`: it fires synchronously during
 * the `mousedown`/`touchstart` that moves focus off an input (e.g. tapping a
 * Save button), so reloading then would unload the page before the ensuing
 * `click` handler runs and silently swallow the user's action.
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
 * Reload immediately if it's safe, otherwise defer until the next safe moment —
 * the page is hidden, or an open modal closes. Idempotent: a second call while a
 * reload is already pending is a no-op.
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

  const finish = () => {
    cleanup()
    reloadScheduled = false
    reload()
  }

  // (1) Page hidden: the user left/backgrounded the app — reload unconditionally,
  //     it's the safest possible moment and there is nothing to interrupt.
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') finish()
  }

  // (2) A class changed on <html> — if that cleared the modal-open block and we
  //     are now safe, reload. The class only flips on a deliberate open/close,
  //     so this never preempts an in-flight click. The re-check is deferred to a
  //     macrotask: the MutationObserver microtask fires before Vue flushes its
  //     render, so a just-closed modal's focused input is still mounted and
  //     document.activeElement would read as "still typing" — wrongly skipping
  //     the reload. setTimeout(0) runs after Vue's microtasks settle the DOM.
  let pending: ReturnType<typeof setTimeout> | null = null
  const onMutation = () => {
    if (pending !== null) return
    pending = setTimeout(() => {
      pending = null
      if (isSafeToReload()) finish()
    }, 0)
  }
  const observer = typeof MutationObserver !== 'undefined'
    ? new MutationObserver(onMutation)
    : null

  function cleanup() {
    observer?.disconnect()
    document.removeEventListener('visibilitychange', onVisibility)
    if (pending !== null) {
      clearTimeout(pending)
      pending = null
    }
  }

  observer?.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  document.addEventListener('visibilitychange', onVisibility)
}
