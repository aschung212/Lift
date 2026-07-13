import { describe, it, expect, vi } from 'vitest'
import {
  coachEndpoint,
  mapCoachResponse,
  daysUntilReset,
  requestCoachReview,
  COACH_PROD_ORIGIN,
  COACH_PATH,
  type CoachResult,
} from '../coachClient'
import type { CoachPayload, CoachReview } from '../aiCoach'

const REVIEW: CoachReview = {
  headline: 'Solid week',
  sections: [{ type: 'progress', title: 'Bench up', body: 'Top set climbed.' }],
  focusNext: 'Add a rep on squats.',
}

const PAYLOAD: CoachPayload = {
  unit: 'lb',
  sets: [],
  personalRecords: [],
  volume: [],
  consistency: null,
  focus: [],
  bodyweight: null,
  sessions: [],
}

describe('coachEndpoint', () => {
  it('is same-origin on web and absolute prod origin in the native shell', () => {
    expect(coachEndpoint(false)).toBe(COACH_PATH)
    expect(coachEndpoint(true)).toBe(`${COACH_PROD_ORIGIN}${COACH_PATH}`)
  })
})

describe('mapCoachResponse', () => {
  it('maps a 200 with a valid review to success', () => {
    const r = mapCoachResponse(200, { review: REVIEW, remaining: 2, resetsAt: '2026-07-06T00:00:00Z' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.review.headline).toBe('Solid week')
      expect(r.remaining).toBe(2)
      expect(r.resetsAt).toBe('2026-07-06T00:00:00Z')
    }
  })

  it('treats a 200 with an error body (model refusal) as a retryable unavailable', () => {
    const r = mapCoachResponse(200, { error: 'coach_unavailable' })
    expect(r).toMatchObject({ ok: false, kind: 'unavailable', retryable: true })
  })

  it('maps 401 to a non-retryable unauthorized', () => {
    expect(mapCoachResponse(401, { error: 'unauthorized' })).toMatchObject({
      ok: false,
      kind: 'unauthorized',
      retryable: false,
    })
  })

  it('distinguishes consent_required from email_unverified on 403', () => {
    const consent = mapCoachResponse(403, { error: 'consent_required', consentVersion: 1 })
    expect(consent).toMatchObject({ ok: false, kind: 'consent_required', consentVersion: 1 })
    const email = mapCoachResponse(403, { error: 'email_unverified' })
    expect(email).toMatchObject({ ok: false, kind: 'email_unverified' })
  })

  it('maps 413 and 422 to non-retryable payload failures', () => {
    expect(mapCoachResponse(413, { error: 'payload_too_large' })).toMatchObject({ kind: 'too_large', retryable: false })
    expect(mapCoachResponse(422, { error: 'insufficient_signal' })).toMatchObject({ kind: 'insufficient', retryable: false })
  })

  it('carries resetsAt through a 429 quota_exceeded', () => {
    const r = mapCoachResponse(429, { error: 'quota_exceeded', resetsAt: '2026-07-06T00:00:00Z' })
    expect(r).toMatchObject({ ok: false, kind: 'quota_exceeded', resetsAt: '2026-07-06T00:00:00Z', retryable: false })
  })

  it('maps 502 to a retryable bad_output', () => {
    expect(mapCoachResponse(502, { error: 'coach_bad_output' })).toMatchObject({ kind: 'bad_output', retryable: true })
  })

  it('distinguishes a retryable pause from a non-retryable disabled on 503', () => {
    expect(mapCoachResponse(503, { error: 'coach_paused' })).toMatchObject({ kind: 'paused', retryable: true })
    expect(mapCoachResponse(503, { error: 'coach_disabled' })).toMatchObject({ kind: 'disabled', retryable: false })
  })

  it('falls back to unknown for an unmapped status', () => {
    expect(mapCoachResponse(418, {})).toMatchObject({ ok: false, kind: 'unknown', retryable: false })
    expect(mapCoachResponse(500, {})).toMatchObject({ ok: false, kind: 'unknown', retryable: true })
  })

  it('rejects a 200 whose review is structurally invalid', () => {
    expect(mapCoachResponse(200, { review: { headline: 5 } })).toMatchObject({ ok: false })
  })
})

describe('daysUntilReset', () => {
  const now = new Date('2026-07-01T12:00:00Z')
  it('returns null for missing or unparseable input', () => {
    expect(daysUntilReset(null, now)).toBeNull()
    expect(daysUntilReset('not-a-date', now)).toBeNull()
  })
  it('ceils to whole days and floors at 1 for any future instant', () => {
    expect(daysUntilReset('2026-07-03T12:00:00Z', now)).toBe(2)
    expect(daysUntilReset('2026-07-01T13:00:00Z', now)).toBe(1)
  })
  it('returns 0 for a past instant', () => {
    expect(daysUntilReset('2026-06-30T12:00:00Z', now)).toBe(0)
  })
})

describe('requestCoachReview', () => {
  it('POSTs the payload wrapped under { payload } with a bearer token', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ review: REVIEW, remaining: 1, resetsAt: null }), { status: 200 }),
    )
    const result = await requestCoachReview({ payload: PAYLOAD, token: 'tok', fetchFn })
    expect(result.ok).toBe(true)
    expect(fetchFn).toHaveBeenCalledOnce()
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe(COACH_PATH)
    expect(init.method).toBe('POST')
    expect(init.headers.authorization).toBe('Bearer tok')
    expect(JSON.parse(init.body)).toEqual({ payload: PAYLOAD })
  })

  it('maps a thrown network error to a retryable network failure', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('offline'))
    const result = await requestCoachReview({ payload: PAYLOAD, token: 'tok', fetchFn })
    expect(result).toMatchObject({ ok: false, kind: 'network', status: 0, retryable: true })
  })

  it('maps an aborted request (client timeout) to a retryable timeout', async () => {
    const fetchFn: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        const signal = (init as RequestInit).signal
        signal?.addEventListener('abort', () => {
          const err = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    const result = (await requestCoachReview({
      payload: PAYLOAD,
      token: 'tok',
      fetchFn,
      timeoutMs: 5,
    })) as CoachResult
    expect(result).toMatchObject({ ok: false, kind: 'timeout', retryable: true })
  })

  it('targets the absolute prod origin when native', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{}', { status: 503 }))
    await requestCoachReview({ payload: PAYLOAD, token: 'tok', native: true, fetchFn })
    expect(fetchFn.mock.calls[0][0]).toBe(`${COACH_PROD_ORIGIN}${COACH_PATH}`)
  })
})
