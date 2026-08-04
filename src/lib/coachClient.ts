/**
 * AI Coach — client-side request layer (issue LIFT-848).
 *
 * The browser/native client never holds the Anthropic key; it POSTs the validated
 * payload to the server proxy (`api/coach.ts`), which is the real trust boundary.
 * This module is the thin, PURE-where-possible glue:
 *   - `coachEndpoint` picks same-origin vs the absolute prod origin (native build).
 *   - `mapCoachResponse` turns an HTTP status + parsed body into a typed result —
 *     pure, so the full status matrix is unit-testable without a network.
 *   - `requestCoachReview` does the fetch with an abort-based client timeout.
 *
 * The server response shapes this mirrors (see api/coach.ts):
 *   200 { review, resetsAt, remaining }            success
 *   200 { error: 'coach_unavailable' }             model safety refusal (spend stood)
 *   401 { error: 'unauthorized' }
 *   403 { error: 'consent_required', consentVersion } | { error: 'email_unverified' }
 *   413 { error: 'payload_too_large' }
 *   422 { error: <validation> }                    too-thin / malformed
 *   429 { error: 'quota_exceeded', resetsAt }
 *   502 { error: 'coach_upstream_failed' | 'coach_bad_output' }
 *   503 { error: 'coach_paused' | 'coach_disabled' | 'not_production' | ... }
 */

import type { CoachPayload, CoachReview } from './aiCoach'

/** Same-origin path on web/PWA. */
export const COACH_PATH = '/api/coach'

/**
 * The native Capacitor build is cross-origin (ios scheme 'Lift'), so it must call
 * the absolute production origin. This is the authoritative deployment domain
 * (CLAUDE.md SEV1 rule — never fabricate); it matches `PROD_HOSTNAME` in supabase.ts
 * and the function's CORS allowlist in api/coach.ts.
 */
export const COACH_PROD_ORIGIN = 'https://spa-rho-sandy.vercel.app'

/** Client abort just past the function's `maxDuration` (60s) is overkill; 28s keeps the UI honest. */
export const COACH_TIMEOUT_MS = 28_000

/** Discriminated reason a review could not be produced — drives the sheet's copy. */
export type CoachErrorKind =
  | 'unauthorized'
  | 'email_unverified'
  | 'consent_required'
  | 'quota_exceeded'
  | 'paused'
  | 'disabled'
  | 'too_large'
  | 'insufficient'
  | 'bad_output'
  | 'unavailable'
  | 'timeout'
  | 'network'
  | 'unknown'

export interface CoachSuccess {
  ok: true
  review: CoachReview
  remaining: number
  resetsAt: string | null
}

export interface CoachFailure {
  ok: false
  kind: CoachErrorKind
  /** HTTP status, or 0 for a network/timeout failure that never reached the server. */
  status: number
  /** Server-accurate quota reset instant, when the failure carries one (429). */
  resetsAt?: string | null
  /** The version the user must (re)consent to, when `kind === 'consent_required'`. */
  consentVersion?: number
  /**
   * True when retrying could succeed WITHOUT consuming quota — the request either
   * never billed (network/timeout/upstream) or is a transient server state (paused).
   * A retry on a non-retryable failure (quota/consent/too-thin) is pointless.
   */
  retryable: boolean
}

export type CoachResult = CoachSuccess | CoachFailure

/** Same-origin on web; the absolute prod origin inside the native shell. */
export function coachEndpoint(native: boolean): string {
  return native ? `${COACH_PROD_ORIGIN}${COACH_PATH}` : COACH_PATH
}

function isReview(v: unknown): v is CoachReview {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>).headline === 'string' &&
    Array.isArray((v as Record<string, unknown>).sections)
  )
}

/**
 * Map an HTTP status + parsed JSON body to a typed `CoachResult`. Pure and total:
 * every server branch in api/coach.ts has a deterministic mapping here.
 */
export function mapCoachResponse(status: number, body: unknown): CoachResult {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const err = typeof b.error === 'string' ? b.error : ''
  const resetsAt = typeof b.resetsAt === 'string' ? b.resetsAt : null
  const consentVersion = typeof b.consentVersion === 'number' ? b.consentVersion : undefined

  if (status === 200 && !err && isReview(b.review)) {
    return {
      ok: true,
      review: b.review,
      remaining: typeof b.remaining === 'number' ? b.remaining : 0,
      resetsAt,
    }
  }

  switch (status) {
    case 200:
      // 200 with an error body == the model safety-refused; the request was billed.
      return { ok: false, kind: 'unavailable', status, retryable: true }
    case 401:
      return { ok: false, kind: 'unauthorized', status, retryable: false }
    case 403:
      return err === 'consent_required'
        ? { ok: false, kind: 'consent_required', status, consentVersion, retryable: false }
        : { ok: false, kind: 'email_unverified', status, retryable: false }
    case 413:
      return { ok: false, kind: 'too_large', status, retryable: false }
    case 422:
      return { ok: false, kind: 'insufficient', status, retryable: false }
    case 429:
      return { ok: false, kind: 'quota_exceeded', status, resetsAt, retryable: false }
    case 502:
      return { ok: false, kind: 'bad_output', status, retryable: true }
    case 503:
      return err === 'coach_paused'
        ? { ok: false, kind: 'paused', status, retryable: true }
        : { ok: false, kind: 'disabled', status, retryable: false }
    default:
      return { ok: false, kind: 'unknown', status, retryable: status >= 500 }
  }
}

export interface RequestCoachOptions {
  payload: CoachPayload
  /** Supabase access token (Bearer). */
  token: string
  /** Running inside the native Capacitor shell — selects the absolute origin. */
  native?: boolean
  /** Injectable for tests; defaults to global fetch. */
  fetchFn?: typeof fetch
  /** Client-side abort timeout in ms (default COACH_TIMEOUT_MS). */
  timeoutMs?: number
}

/**
 * POST the validated payload to the proxy and return a typed result. An abort
 * timeout maps to a retryable `timeout` (the request may not have billed); any
 * other thrown error maps to a retryable `network` failure.
 */
export async function requestCoachReview(opts: RequestCoachOptions): Promise<CoachResult> {
  const fetchFn = opts.fetchFn ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? COACH_TIMEOUT_MS)
  try {
    const resp = await fetchFn(coachEndpoint(!!opts.native), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${opts.token}`,
      },
      body: JSON.stringify({ payload: opts.payload }),
      signal: controller.signal,
    })
    let parsed: unknown = null
    try {
      parsed = await resp.json()
    } catch {
      parsed = null
    }
    return mapCoachResponse(resp.status, parsed)
  } catch (e) {
    const aborted = !!e && typeof e === 'object' && (e as { name?: string }).name === 'AbortError'
    return { ok: false, kind: aborted ? 'timeout' : 'network', status: 0, retryable: true }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Whole days until `resetsAt` (rolling 7-day window), for the "Resets in N days"
 * copy. Always ≥1 so the user never sees "Resets in 0 days" for a future instant.
 */
export function daysUntilReset(resetsAt: string | null, now: Date = new Date()): number | null {
  if (!resetsAt) return null
  const t = Date.parse(resetsAt)
  if (Number.isNaN(t)) return null
  const ms = t - now.getTime()
  if (ms <= 0) return 0
  return Math.max(1, Math.ceil(ms / 86_400_000))
}
