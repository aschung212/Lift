/**
 * Circuit breaker for AUTOMATIC page reloads (#1155, 2026-08-17 boot-loop
 * hardening).
 *
 * Two boot-path flows legitimately end in a programmatic reload: the
 * IndexedDB-restore path in App.vue (localStorage wiped → restore backup →
 * reload so stores rehydrate) and useServiceWorker's `controllerchange`
 * handler (new SW took control → reload to pick up fresh chunk hashes). Each
 * is correct exactly ONCE. But if the condition that triggered the reload is
 * still true after reloading — a restore that never sticks, an update that
 * re-fires every boot — the page reloads forever. On an installed iOS PWA
 * that presents as the "A problem repeatedly occurred" kill screen, with zero
 * telemetry, because the app never lives long enough to report anything.
 *
 * `guardedReload` allows ONE automatic reload per trigger per browsing
 * session. sessionStorage is the right scope: it survives reloads in the same
 * tab (so the counter is visible to the post-reload page) but resets when the
 * app is relaunched (so every launch gets one fresh attempt). A repeat within
 * the same session is suppressed and reported to Sentry via logError — the
 * would-be crash loop degrades into an observable, still-running app.
 *
 * There is deliberately no "reset on successful boot": a loop in which the
 * app mounts and only THEN reloads would re-arm itself past any such reset.
 * One automatic reload per trigger per session, period.
 *
 * USER-initiated reloads (a tap on a dev-tool button, the offline retry
 * page) must NOT go through this guard — a human in the loop is not a loop.
 * An architectural invariant test bans bare `location.reload()` everywhere
 * else.
 */
import { logError } from './logger'

const KEY_PREFIX = 'auto-reload-guard:'

export interface ReloadGuardDeps {
  /** Injectable for tests — happy-dom's location.reload is not spyable. */
  reload?: () => void
  /** Injectable for tests — defaults to window.sessionStorage. */
  storage?: Pick<Storage, 'getItem' | 'setItem'>
}

/**
 * Reload the page, at most once per `reason` per browsing session.
 *
 * @returns true when the reload was initiated (callers should stop doing
 *          work — the page is going away); false when it was suppressed.
 */
export function guardedReload(reason: string, deps: ReloadGuardDeps = {}): boolean {
  const key = KEY_PREFIX + reason

  // Even ACCESSING window.sessionStorage can throw (storage disabled). If we
  // cannot count reloads we fail open — the legitimate one-shot flows must
  // keep working, and an unbounded loop there is no worse than pre-guard.
  let storage: Pick<Storage, 'getItem' | 'setItem'> | null
  try {
    storage = deps.storage ?? window.sessionStorage
  } catch {
    storage = null
  }

  let alreadyReloaded = false
  try {
    alreadyReloaded = storage?.getItem(key) != null
  } catch {
    // Fail open — see above.
  }

  if (alreadyReloaded) {
    logError(
      new Error(`Automatic reload suppressed — already reloaded once this session (${reason})`),
      { source: 'reloadGuard', reason },
    )
    return false
  }

  try {
    // Timestamp instead of a bare flag: shows up in bug reports / storage
    // dumps as WHEN the one allowed reload happened.
    storage?.setItem(key, new Date().toISOString())
  } catch {
    // Fail open — see above.
  }

  ;(deps.reload ?? (() => window.location.reload()))()
  return true
}
