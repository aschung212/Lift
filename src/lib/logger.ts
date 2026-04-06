/**
 * Structured error logging — routes errors to Sentry in production,
 * always logs to console with context.
 */

type ErrorContext = Record<string, unknown>
type CaptureExceptionFn = (err: Error, ctx?: ErrorContext) => void

let _captureException: CaptureExceptionFn | null = null

/** Called by main.ts after Sentry initializes. */
export function setSentryCaptureException(fn: CaptureExceptionFn): void {
  _captureException = fn
}

/** Log an error with structured context. Sends to Sentry in production. */
export function logError(err: unknown, context?: ErrorContext): void {
  const error = err instanceof Error ? err : new Error(String(err))
  console.error(`[Lift]`, error.message, context ?? '')
  _captureException?.(error, context)
}

/** Log a warning (console only, no Sentry). */
export function logWarn(message: string, context?: ErrorContext): void {
  console.warn(`[Lift]`, message, context ?? '')
}
