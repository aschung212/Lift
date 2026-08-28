/**
 * Global error/rejection capture floor (LIFT-1227).
 *
 * `app.config.errorHandler` (main.ts) and ErrorBoundary's `onErrorCaptured`
 * both only see SYNCHRONOUS Vue render/lifecycle/watcher errors. Neither catches
 * unhandled promise rejections from the app's many fire-and-forget async calls
 * (the un-awaited `initStores` on re-auth, `void ensureFreshSession()`, async
 * store actions fired from event handlers) or uncaught runtime errors thrown
 * outside a component. Sentry installs its own global handlers, but ONLY when
 * `VITE_SENTRY_DSN` is set in a PROD build — in dev or a DSN-less build those
 * failures vanish entirely.
 *
 * This module provides an app-level `window` capture floor that routes every
 * unhandled rejection / error through the app's own `logError` convention
 * (console always, Sentry when configured), independent of whether Sentry is
 * installed. It is deliberately thin: it does NOT `preventDefault()`, so the
 * browser's default logging — and Sentry's own handlers, whose Dedupe
 * integration drops the resulting duplicate — still run.
 *
 * Like the CSP reporter, it dedupes by error signature and rate-caps total
 * forwards per page load so a tight rejection loop can never flood the sink.
 */

/** Where the handler is a floor to catch, tagged for context in telemetry. */
export type GlobalErrorSource = 'unhandledrejection' | 'window.onerror'

/** Coerce an arbitrary thrown/rejected value into an Error for logging. */
export function toError(value: unknown): Error {
  if (value instanceof Error) return value
  // Some rejections carry a plain string or a `{ message }` object; preserve
  // whatever readable text we can rather than emitting "[object Object]".
  if (typeof value === 'string') return new Error(value)
  if (value && typeof value === 'object' && 'message' in value) {
    return new Error(String((value as { message: unknown }).message))
  }
  return new Error(String(value))
}

/** Stable dedupe key — one forward per (name, message) signature. */
export function errorSignature(error: Error): string {
  return `${error.name}: ${error.message}`
}

export interface GlobalErrorHandler {
  /** Process a single promise rejection (exposed for testing). */
  handleRejection: (event: PromiseRejectionEvent) => void
  /** Process a single uncaught error (exposed for testing). */
  handleError: (event: ErrorEvent) => void
  /** Begin listening on the given target (defaults to window). */
  start: (target?: EventTarget) => void
  /** Stop listening. */
  stop: (target?: EventTarget) => void
}

export interface GlobalErrorHandlerOptions {
  /** Max number of errors forwarded per page load (default 25). */
  maxReports?: number
}

/**
 * Create a global error handler that forwards deduped, rate-capped uncaught
 * errors and promise rejections to the supplied sink. The sink is where the
 * `logError` (and thus Sentry) wiring lives — the module itself has no logger
 * dependency, which keeps it trivially testable.
 */
export function createGlobalErrorHandler(
  forward: (error: Error, source: GlobalErrorSource) => void,
  options: GlobalErrorHandlerOptions = {},
): GlobalErrorHandler {
  const maxReports = options.maxReports ?? 25
  const seen = new Set<string>()
  let count = 0
  let rejectionListener: ((event: Event) => void) | null = null
  let errorListener: ((event: Event) => void) | null = null

  function report(error: Error, source: GlobalErrorSource): void {
    if (count >= maxReports) return
    const key = `${source}|${errorSignature(error)}`
    if (seen.has(key)) return
    seen.add(key)
    count += 1
    forward(error, source)
  }

  function handleRejection(event: PromiseRejectionEvent): void {
    report(toError(event.reason), 'unhandledrejection')
  }

  function handleError(event: ErrorEvent): void {
    // Uncaught exceptions carry the real Error on `.error`; fall back to the
    // message string when a cross-origin script yields only "Script error.".
    report(toError(event.error ?? event.message), 'window.onerror')
  }

  function start(target: EventTarget = window): void {
    if (rejectionListener || errorListener) return
    rejectionListener = (event: Event): void =>
      handleRejection(event as PromiseRejectionEvent)
    errorListener = (event: Event): void => handleError(event as ErrorEvent)
    target.addEventListener('unhandledrejection', rejectionListener)
    target.addEventListener('error', errorListener)
  }

  function stop(target: EventTarget = window): void {
    if (rejectionListener) {
      target.removeEventListener('unhandledrejection', rejectionListener)
      rejectionListener = null
    }
    if (errorListener) {
      target.removeEventListener('error', errorListener)
      errorListener = null
    }
  }

  return { handleRejection, handleError, start, stop }
}
