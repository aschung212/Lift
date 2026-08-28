/**
 * Client-side Content-Security-Policy violation reporting (LIFT-810).
 *
 * Why not `report-uri` / `report-to` in vercel.json?
 * Those directives need a *static* endpoint URL baked into the HTTP header at
 * build time. Our Sentry ingest endpoint is derived from `VITE_SENTRY_DSN`, a
 * runtime env var — hardcoding (or worse, fabricating) the Sentry security URL
 * into the static `vercel.json` header would violate the SEV1 no-fabricate rule
 * and leak/duplicate the DSN. Instead we listen for the browser's
 * `securitypolicyviolation` event, which carries the same fields a CSP report
 * would, and forward it through the already-initialized Sentry transport. This
 * keeps the single source of truth for the DSN in one place (main.ts) and works
 * in any browser that enforces the CSP header Vercel serves.
 *
 * The reporter dedupes by directive+resource and caps total forwards per page
 * load so a misconfiguration (or a hostile injection loop) can never flood
 * Sentry from a single session.
 */

/** Normalized subset of `SecurityPolicyViolationEvent` we forward. */
export interface CspViolationReport {
  documentURI: string
  violatedDirective: string
  effectiveDirective: string
  blockedURI: string
  sourceFile: string
  lineNumber: number
  columnNumber: number
  disposition: string
}

/** Pull the reportable fields off a `securitypolicyviolation` event. */
export function extractViolation(event: SecurityPolicyViolationEvent): CspViolationReport {
  return {
    documentURI: event.documentURI ?? '',
    // `effectiveDirective` is the modern field; `violatedDirective` is the
    // legacy alias some engines still emit, so fall back between them.
    violatedDirective: event.violatedDirective || event.effectiveDirective || '',
    effectiveDirective: event.effectiveDirective || event.violatedDirective || '',
    blockedURI: event.blockedURI ?? '',
    sourceFile: event.sourceFile ?? '',
    lineNumber: event.lineNumber ?? 0,
    columnNumber: event.columnNumber ?? 0,
    disposition: event.disposition ?? '',
  }
}

/** Stable dedupe key — one report per (directive, blocked resource) pair. */
export function violationKey(report: CspViolationReport): string {
  return `${report.effectiveDirective}|${report.blockedURI}`
}

/** Human-readable one-line summary used as the Sentry issue title. */
export function violationSummary(report: CspViolationReport): string {
  const directive = report.effectiveDirective || 'unknown-directive'
  const resource = report.blockedURI || 'inline'
  return `CSP violation: ${directive} blocked ${resource}`
}

export interface CspReporter {
  /** Process a single violation event (exposed for testing). */
  handleViolation: (event: SecurityPolicyViolationEvent) => void
  /** Begin listening for violations on the given target (defaults to document). */
  start: (target?: EventTarget) => void
  /** Stop listening. */
  stop: () => void
}

export interface CspReporterOptions {
  /** Max number of violations forwarded per page load (default 20). */
  maxReports?: number
}

/**
 * Create a CSP reporter that forwards deduped, rate-capped violations to the
 * supplied sink. The sink is where Sentry wiring lives (see main.ts) — the
 * module itself has no Sentry dependency, which keeps it trivially testable.
 */
export function createCspReporter(
  forward: (report: CspViolationReport) => void,
  options: CspReporterOptions = {},
): CspReporter {
  const maxReports = options.maxReports ?? 20
  const seen = new Set<string>()
  let count = 0
  let listener: ((event: Event) => void) | null = null

  function handleViolation(event: SecurityPolicyViolationEvent): void {
    if (count >= maxReports) return
    const report = extractViolation(event)
    const key = violationKey(report)
    if (seen.has(key)) return
    seen.add(key)
    count += 1
    forward(report)
  }

  function start(target: EventTarget = document): void {
    if (listener) return
    listener = (event: Event): void => handleViolation(event as SecurityPolicyViolationEvent)
    target.addEventListener('securitypolicyviolation', listener)
  }

  function stop(target: EventTarget = document): void {
    if (!listener) return
    target.removeEventListener('securitypolicyviolation', listener)
    listener = null
  }

  return { handleViolation, start, stop }
}
