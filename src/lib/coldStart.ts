/**
 * Cold-start measurement (#1582).
 *
 * #1580 took the token refresh and the durable-journal read out of the
 * splash's critical path, and until then the only measurement of a cold
 * start was Aaron's phone each morning. This module is what makes the boot
 * visible: a `performance.mark` when the splash comes down, so the boot shows
 * in a devtools profile, and the one analytics event App.vue fires at that
 * moment, carrying how long it took and which path lifted the splash.
 *
 * `performance.now()` measures from navigation start, which on a Home-Screen
 * launch is the process start: the number is the time the lifter stared at
 * the wordmark. The path comes from `useAuth`, where every site that lifts
 * `loading` names it through one helper (`liftSplash`), so a lift can never go
 * unattributed. Nothing here is about the account: a mode, a duration and two
 * booleans, so it adds no data category to the privacy answers.
 */

/** How `useAuth` lifted the splash. */
export type StartupPath =
  /** Rendered from the session stored on the device, before it was confirmed (#1580). */
  | 'stored-session'
  /** A confirmed session, with the stores bound. */
  | 'session'
  /** A persisted guest, or the guest button. */
  | 'guest'
  /** No session: the sign-in screen. */
  | 'signed-out'
  /** Local-only: DEV, or no Supabase client. */
  | 'local'
  /** getSession() rejected outright. */
  | 'error'

export const COLD_START_EVENT = 'cold_start'
export const SPLASH_DOWN_MARK = 'logbook:splash-down'

export interface ColdStartEvent {
  path: StartupPath | 'unknown'
  /** Milliseconds from navigation start to the splash coming down. */
  ms: number
  /** Launched from the Home Screen (standalone display mode), not a browser tab. */
  standalone: boolean
  /** The Capacitor shell. */
  native: boolean
}

/** The event payload, with the duration rounded to whole milliseconds. */
export function buildColdStartEvent(input: {
  path: StartupPath | null
  elapsedMs: number
  standalone: boolean
  native: boolean
}): ColdStartEvent {
  return {
    path: input.path ?? 'unknown',
    ms: Math.max(0, Math.round(input.elapsedMs)),
    standalone: input.standalone,
    native: input.native,
  }
}

/** Whether the page runs as an installed PWA rather than in a browser tab. */
export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true
  } catch {
    // matchMedia unavailable: fall through to the iOS flag.
  }
  // iOS Safari's own flag for a Home-Screen web app.
  return (navigator as Navigator & { standalone?: boolean }).standalone === true
}

/**
 * Mark the splash coming down and return the time since navigation start, or
 * null where the Performance API is missing (never in a browser; only in a
 * bare test environment).
 */
export function recordSplashDown(): number | null {
  if (typeof performance === 'undefined' || typeof performance.now !== 'function') return null
  try {
    performance.mark?.(SPLASH_DOWN_MARK)
  } catch {
    // A user-timing mark is a nicety for profiling; never let it break boot.
  }
  return performance.now()
}
