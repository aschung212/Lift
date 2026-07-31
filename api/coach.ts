/**
 * AI Coach — server-side proxy (Phase 1 scaffold).
 *
 * This is Lift's FIRST server-side component. It is the entire trust boundary for
 * the AI Coach feature: it holds the Anthropic key, verifies the caller, enforces
 * the per-user quota + global daily spend ceiling, validates the payload and the
 * model output, and only then returns a digest. Nothing in the client bundle is
 * trusted — the client-side counter is cosmetic; THIS is the real cap.
 *
 * Gate order is load-bearing: every cheap check runs BEFORE any spend.
 *   1. kill switch (fail-closed)         5. server-recorded versioned consent
 *   2. production-only (+ dev escape)    6. payload size + allowlist validation
 *   3. required config present           7. atomic quota claim + global pre-charge
 *   4. JWT verify + email confirmed      8. model call -> true-up -> output sanitize
 *
 * Runtime env (provision in Vercel, Production scope; NEVER VITE_-prefixed):
 *   COACH_ENABLED=true            feature kill switch (anything but "true" => 503)
 *   COACH_MODEL=claude-opus-4-8   model id (unset => 503; never fabricated)
 *   ANTHROPIC_API_KEY=...         Console API key — usage-billed, NOT a Max subscription
 *   SUPABASE_URL / SUPABASE_ANON_KEY   server copies (used to verify the caller's JWT)
 *   COACH_DAILY_CEILING_CENTS=200 global spend brake (default $2/day)
 *   SLACK_WEBHOOK_URL=...         optional; server copy for the 50%-of-ceiling spend alert
 *   COACH_DEV_ALLOW=1             local `vercel dev` escape hatch (never set in Vercel)
 *
 * See docs/ai-coach.md for the full design, the remaining Phase 1 work (consent UI,
 * LegalSheet, CoachSheet, deleteAccount wiring), and the migration this depends on.
 */

import { createClient } from '@supabase/supabase-js'
import {
  CURRENT_CONSENT_VERSION,
  DEFAULT_WEEKLY_LIMIT,
  MAX_INPUT_PAYLOAD_BYTES,
  MAX_INPUT_TOKENS,
  MAX_OUTPUT_TOKENS,
  COACH_OUTPUT_SCHEMA,
  COACH_SYSTEM_PROMPT,
  buildCoachUserMessage,
  validateCoachPayload,
  sanitizeCoachOutput,
  estimateInputTokens,
  estimateMaxCostCents,
  costCents,
  supportsAdaptiveThinking,
  type CoachPayload,
} from '../src/lib/aiCoach'
import { buildSpendAlertText } from '../src/lib/coachSpendAlert'

// Headroom for a large per-set payload + adaptive thinking on Opus (single-shot).
export const config = { maxDuration: 60 }

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

// Origins allowed to call the proxy. The native Capacitor build is cross-origin
// (ios.scheme: 'Lift'), so it must be allow-listed explicitly here AND in the CSP
// connect-src (see vercel.json) before the native build ships.
const ALLOWED_ORIGINS = new Set([
  'https://spa-rho-sandy.vercel.app',
  'capacitor://localhost',
  'http://localhost:5173',
])

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Access-Control-Allow-Headers'] = 'authorization, content-type'
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
    headers['Vary'] = 'Origin'
  }
  return headers
}

function json(status: number, body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers })
}

function env(name: string): string | undefined {
  return process.env[name]
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  const n = raw === undefined ? NaN : Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function bearer(header: string | null): string | null {
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1] : null
}

/**
 * Best-effort early-warning Slack alert when the day's spend first crosses the
 * threshold. An alert failure must NEVER surface to the caller or block their
 * review, so every error is swallowed. The once-per-day guard lives in the
 * record_coach_usage RPC — this only fires the message it already decided to send.
 */
async function postSpendAlert(webhook: string, spentCents: number, ceilingCents: number): Promise<void> {
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: buildSpendAlertText(spentCents, ceilingCents) }),
    })
  } catch {
    // Swallow: alerting is observability, not a request-path dependency.
  }
}

interface AnthropicResult {
  json: unknown
  inputTokens: number
  outputTokens: number
  stopReason: string | null
}

async function callAnthropic(opts: {
  apiKey: string
  model: string
  payload: CoachPayload
}): Promise<AnthropicResult> {
  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: COACH_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildCoachUserMessage(opts.payload) }],
    output_config: { format: { type: 'json_schema', schema: COACH_OUTPUT_SCHEMA } },
  }
  if (supportsAdaptiveThinking(opts.model)) {
    body.thinking = { type: 'adaptive' }
  }

  const resp = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': opts.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!resp.ok) {
    throw new Error(`anthropic_http_${resp.status}`)
  }

  const data = (await resp.json()) as {
    content?: Array<{ type: string; text?: string }>
    stop_reason?: string
    usage?: { input_tokens?: number; output_tokens?: number }
  }

  const textBlock = (data.content ?? []).find((b) => b.type === 'text' && typeof b.text === 'string')
  let parsed: unknown = null
  if (textBlock?.text) {
    try {
      parsed = JSON.parse(textBlock.text)
    } catch {
      parsed = null
    }
  }

  return {
    json: parsed,
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
    stopReason: data.stop_reason ?? null,
  }
}

export default async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get('origin')
  const cors = corsHeaders(origin)

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' }, cors)

  // 1. Kill switch — fail closed.
  if (env('COACH_ENABLED') !== 'true') return json(503, { error: 'coach_disabled' }, cors)

  // 2. Production-only. Every preview deploy would otherwise be a live spending
  //    endpoint against the real key. `vercel dev` opts in with COACH_DEV_ALLOW=1.
  const vercelEnv = env('VERCEL_ENV')
  const devAllow = vercelEnv === 'development' && env('COACH_DEV_ALLOW') === '1'
  if (vercelEnv !== 'production' && !devAllow) return json(503, { error: 'not_production' }, cors)

  // 3. Required config present — never fabricate a model id or key (SEV1 rule).
  const model = env('COACH_MODEL')
  const apiKey = env('ANTHROPIC_API_KEY')
  const supabaseUrl = env('SUPABASE_URL')
  const supabaseAnonKey = env('SUPABASE_ANON_KEY')
  if (!model || !apiKey || !supabaseUrl || !supabaseAnonKey) {
    return json(503, { error: 'coach_misconfigured' }, cors)
  }
  if (!MODEL_IS_PRICED(model)) return json(503, { error: 'coach_model_unpriced' }, cors)

  // 4. Auth — verify the JWT and derive identity from the verified token only.
  const token = bearer(req.headers.get('authorization'))
  if (!token) return json(401, { error: 'unauthorized' }, cors)

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  const { data: userData, error: userError } = await supabase.auth.getUser(token)
  if (userError || !userData?.user) return json(401, { error: 'unauthorized' }, cors)
  // Canonical for both email/password and Google OAuth signups.
  if (!userData.user.email_confirmed_at) return json(403, { error: 'email_unverified' }, cors)

  // 5. Server-recorded, versioned consent. Health/fitness data leaves the device,
  //    so a stale client blob must not re-enable egress — the server is authoritative.
  const { data: consent } = await supabase
    .from('coach_consent')
    .select('version')
    .maybeSingle()
  if (!consent || (consent.version as number) < CURRENT_CONSENT_VERSION) {
    return json(403, { error: 'consent_required', consentVersion: CURRENT_CONSENT_VERSION }, cors)
  }

  // 6. Payload: byte cap (cheap) then allowlist validation (rejects thin/oversized).
  const rawBody = await req.text()
  if (rawBody.length > MAX_INPUT_PAYLOAD_BYTES) return json(413, { error: 'payload_too_large' }, cors)
  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return json(400, { error: 'bad_json' }, cors)
  }
  const rawPayload =
    body && typeof body === 'object' && 'payload' in (body as Record<string, unknown>)
      ? (body as Record<string, unknown>).payload
      : body
  const validation = validateCoachPayload(rawPayload)
  if (!validation.ok) return json(validation.status, { error: validation.error }, cors)
  const payload = validation.payload

  // 7. Atomic quota claim + two-phase global pre-charge (max possible cost).
  const inputTokens = estimateInputTokens(rawBody.length)
  if (inputTokens > MAX_INPUT_TOKENS) return json(413, { error: 'payload_too_large' }, cors)
  const maxCostCents = estimateMaxCostCents(model, inputTokens)
  const ceilingCents = intEnv('COACH_DAILY_CEILING_CENTS', 200)

  const { data: claimData, error: claimError } = await supabase.rpc('claim_coach_request', {
    p_max_cost_cents: maxCostCents,
    p_daily_ceiling_cents: ceilingCents,
    p_default_limit: DEFAULT_WEEKLY_LIMIT,
  })
  if (claimError) return json(500, { error: 'quota_error' }, cors)
  const decision = Array.isArray(claimData) ? claimData[0] : claimData
  if (!decision?.allowed) {
    if (decision?.reason === 'global') return json(503, { error: 'coach_paused' }, cors)
    return json(429, { error: 'quota_exceeded', resetsAt: decision?.reset_at }, cors)
  }

  // 8. Model call -> true-up the global ledger to actual usage -> sanitize output.
  let result: AnthropicResult
  try {
    result = await callAnthropic({ apiKey, model, payload })
  } catch {
    // Upstream failure with no usable output: refund the pre-charge AND the per-user count.
    await supabase.rpc('record_coach_usage', {
      p_pre_charge_cents: maxCostCents,
      p_actual_cost_cents: 0,
      p_input_tokens: 0,
      p_output_tokens: 0,
      p_model: model,
      p_billed: false,
      p_daily_ceiling_cents: ceilingCents,
    })
    return json(502, { error: 'coach_upstream_failed' }, cors)
  }

  const actualCostCents = costCents(model, result.inputTokens, result.outputTokens)
  const { data: usageData } = await supabase.rpc('record_coach_usage', {
    p_pre_charge_cents: maxCostCents,
    p_actual_cost_cents: actualCostCents,
    p_input_tokens: result.inputTokens,
    p_output_tokens: result.outputTokens,
    p_model: model,
    p_billed: true,
    p_daily_ceiling_cents: ceilingCents,
  })

  // Early-warning spend alert (LIFT-850): the RPC flags the first crossing of the
  // 50% threshold today; fire the one-shot Slack alert if a webhook is provisioned.
  const usage = Array.isArray(usageData) ? usageData[0] : usageData
  const spendWebhook = env('SLACK_WEBHOOK_URL')
  if (usage?.crossed_alert && spendWebhook) {
    await postSpendAlert(spendWebhook, usage.spent_cents ?? 0, ceilingCents)
  }

  // A safety refusal is a "used" request — spend stands, no refund.
  if (result.stopReason === 'refusal') return json(200, { error: 'coach_unavailable' }, cors)

  let review
  try {
    review = sanitizeCoachOutput(result.json, payload)
  } catch {
    return json(502, { error: 'coach_bad_output' }, cors)
  }

  return json(200, { review, resetsAt: decision.reset_at, remaining: decision.remaining }, cors)
}

// Local guard so an unpriced model fails closed before any spend. Mirrors the
// MODEL_PRICING table in src/lib/aiCoach.ts (costCents throws on unknown models).
function MODEL_IS_PRICED(model: string): boolean {
  try {
    costCents(model, 1, 1)
    return true
  } catch {
    return false
  }
}
