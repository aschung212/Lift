# AI Coach — Weekly Review (design)

Status: **Phase 1 in progress** (backend scaffold landed; UI + consent + deletion wiring remain).

An opt-in feature where a user taps once and gets an LLM-generated **Weekly Review** of
their training — a fixed-shape digest rendered as themed cards. It is the smallest surface
that delivers a genuine, differentiating coaching moment without the cost, abuse,
hallucination, and prompt-injection blast radius of free-form chat.

## Why this earns its place (CLAUDE.md Principle 2: no feature bloat)

The app already computes PRs, e1RM, ladders, overload nudges, and volume **deterministically**.
A coach that merely restates those numbers in prose *is* bloat. The net-new value is the one
thing the deterministic engine cannot do: **cross-signal synthesis** — weighing progress +
volume balance + consistency + the overload suggestion against each other and naming the single
most useful thing to focus on next. If a week has nothing worth saying, the review renders a
graceful "nothing notable changed" state instead of padding.

This collapses the three UX options we considered into the best one:
- **Not** free-form chat (biggest cost/abuse/injection surface; weekly cadence doesn't suit it).
- **Not** an "ask N questions" menu (its value is absorbed by the digest's four sections,
  delivered proactively instead of making the user pick).
- A single **Weekly Review** digest, server-validated against a fixed JSON schema.

## The load-bearing reality

Lift is a pure static SPA today — **zero server-side compute** before this feature. The entire
trust boundary (key secrecy, quota, consent) depends on a backend that did not exist. So the
**first deliverable is the backend** (`api/coach.ts` + the migration), and the client-side
counter is cosmetic — the server is the only real cap.

## Locked decisions

| Decision | Choice | Notes |
|---|---|---|
| Provider/model | **Claude Opus 4.8** (`claude-opus-4-8`), read from `COACH_MODEL` env | Sonnet 4.6 is a 1-line swap; Haiku 4.5 also priced. Never hardcoded (SEV1). |
| Billing | **Anthropic Console API key**, usage-billed | A Claude **Max subscription is NOT API access** and cannot power an app backend. Separate account/bill. |
| Monetization | **Free forever, premium seam built in** | `coach_usage.limit_override` column lets a future premium tier be a config change, not a rewrite. |
| Bodyweight | **Included in v1**, behind its own opt-out | Most sensitive field; named explicitly in consent + App Store label. |
| Per-user quota | **3 reviews / rolling 7-day window** (`DEFAULT_WEEKLY_LIMIT`) | Rolling, not fixed Mon–Sun. UI copy: "Resets in N days" from server `resetsAt`. |
| Cadence | **Weekly only** | No daily flag/tier in v1. |
| Global spend ceiling | **$2/day** (`COACH_DAILY_CEILING_CENTS=200`) | Abuse brake, not a growth limiter. Provider-side monthly cap ≈ $62. |
| Output cap | `max_tokens` 2500 (`MAX_OUTPUT_TOKENS`) | Leaves room for adaptive thinking + the digest; single-shot (non-streaming). |
| Thinking | Adaptive on for Opus/Sonnet; off for Haiku | The synthesis benefits from reasoning. |
| History | Device-local, last-12 ring (Phase 1) | No `coach_insights` sync until Phase 2 (re-triggers consent bump). |

### Cost model (authoritative pricing, ~3K input + ≤2.5K output)

| Model | in / out per 1M | ~Worst-case / review | $2/day buys | Organic @ 100 users (1/wk) |
|---|---|---|---|---|
| Opus 4.8 | $5 / $25 | ~$0.08 | ~25 reviews/day | ~$34/mo |
| Sonnet 4.6 | $3 / $15 | ~$0.05 | ~40 reviews/day | ~$21/mo |
| Haiku 4.5 (no thinking) | $1 / $5 | ~$0.01 | ~200 reviews/day | ~$4/mo |

At Opus + thinking the `$2/day` ceiling is ~25 reviews/day — ample for the early phase, and it
throttles organically around ~150–200 weekly-active users, which is exactly when the premium
gate / model-tier decision gets revisited.

## Architecture & request flow

A single Vercel serverless function at `api/coach.ts` holds the Anthropic key. The web client
calls it same-origin (`/api/coach`); the native Capacitor build calls the absolute
`https://spa-rho-sandy.vercel.app/api/coach` (read from the authoritative domain, never
fabricated) and that origin must be added to the CSP `connect-src` + the function's CORS
allowlist before the native build ships.

Gate order is load-bearing — every cheap check runs **before any spend**:

1. **Kill switch** — `COACH_ENABLED !== 'true'` → 503 (fail-closed; feature off by default).
2. **Production-only** — `VERCEL_ENV !== 'production'` → 503, so preview deploys aren't live
   spending endpoints. `vercel dev` opts in via `COACH_DEV_ALLOW=1`.
3. **Required config** — `COACH_MODEL`, `ANTHROPIC_API_KEY`, `SUPABASE_URL`,
   `SUPABASE_ANON_KEY` present, and the model is priced; else 503 (never fabricate).
4. **Auth** — verify the JWT via `supabase.auth.getUser(token)`, derive identity from the
   verified `sub`, require `email_confirmed_at` (canonical for email + Google OAuth) → 401/403.
5. **Consent** — server-recorded, versioned (`coach_consent.version >= CURRENT_CONSENT_VERSION`)
   → 403 if absent/stale (a stale synced client blob must not re-enable egress).
6. **Payload** — byte cap (413) then allowlist validation; reject < 2 non-null sections (422).
7. **Quota + global pre-charge** — one atomic `claim_coach_request` RPC: pre-charge the max
   possible cost into the daily ledger, then the rolling per-user window reset + increment +
   cap check; refund the global pre-charge if the per-user gate rejects. 429 / 503.
8. **Model call → true-up → sanitize** — single-shot Anthropic call with `output_config.format`
   forcing the schema; `record_coach_usage` trues the global ledger to **actual** token usage
   (refunding the per-user count only on an unbilled upstream failure); then `sanitizeCoachOutput`
   truncates bodies, drops any section with a URL/markdown link, and metric-echoes numbers.

### Data contract (what leaves the device — derived aggregates only)

Assembled into a small typed payload, validated server-side against an allowlist
(`validateCoachPayload` in `src/lib/aiCoach.ts`):

- **progress** — top ~8 exercises: `{ exerciseName, e1rmNow, e1rmDelta, isPR }`
- **volume** — per muscle-group tag: `{ tagName, weeklyVolume }`
- **consistency** — `{ workoutDaysThisWeek, weeklyTarget, streakWeeks, goalMet }`
- **focus** — top 1–2 overload suggestions: `{ exerciseName, type, suggestedWeight, suggestedReps, reason }`
- **bodyweight** (opt-out) — `{ trendDirection, deltaLbs }`

**Never sent:** raw set rows, raw bodyweight timeline, exercise UUIDs, session ids, user_id,
email, auth tokens, XP log, preferences. Identifiers are used for quota/consent only and are
never forwarded to the model. Exercise names are the one semi-PII free-text field that crosses
the boundary; they are length-capped, delimited as data, and treated as untrusted (prompt-injection vector).

## Guardrails (defense in depth)

- **Key** lives only in Vercel server env (Production scope, never `VITE_`-prefixed). The proxy
  keeps `api.anthropic.com` out of the bundle and CSP. (Recommended: a bundle-grep regression
  test asserting the bundle never references `api.anthropic.com`.)
- **Quota** in `coach_usage` with **no client write policy**; written only by the
  `SECURITY DEFINER` RPC that derives `user_id` from `auth.uid()` and `SET search_path = ''`.
- **Global daily ceiling** (`coach_global_spend`) — two-phase pre-charge/true-up, the true bound
  against multi-account farming. On trip → 503 "coach paused for today."
- **Provider-side monthly budget cap** ≈ ceiling × 31 as the dollar backstop.
- **Vercel WAF rate rule + BotID** on `/api/coach`; Attack Mode + the `COACH_ENABLED` flag are
  the documented kill switches.
- **Output is untrusted too** — rendered via Vue text interpolation (never `v-html`), sanitized
  before persist and before the share-card rasterizer.

## Privacy / consent / App Store

Bodyweight + training history go to a new third-party sub-processor (Anthropic). The consent +
disclosure work must ship in the **same PR as the UI** (CLAUDE.md Documentation Mandate):

- Versioned opt-in consent gate (centered modal) before first use; stored in preferences
  (`aiCoachConsent: { accepted, acceptedAt, version }`, sanitized at the same points as
  `intensityPresets`) **and** server-side via `record_coach_consent` (server is authoritative).
- `LegalSheet.vue` updated to name the LLM provider as a processor of health/fitness data, list
  the exact fields sent (call out bodyweight), and state the **actual** retention posture — do
  not write "zero data retention" until verified in writing (SEV1 fabrication trap).
- A hosted `/privacy` route (`public/privacy.html` + a `vercel.json` rewrite exception) for the
  App Store listing.
- App Store nutrition label: Health & Fitness → **Data Linked to You = Yes**,
  **Used for Tracking = No**, **Third-Party Sharing = Yes**.

## UX (Phase 1, after backend)

- One entry point: a **"Coach" card** at the top of the Workouts tab that doubles as the quota
  meter ("Coach · N reviews left this week"). Appears only with ≥2 weeks of data + a trend.
- Tapping opens `CoachSheet` (built on `useModal` for the #830 scroll lock) with four states:
  consent gate → loading skeleton → result cards → quota-exceeded ("Resets in N days").
- No text input on the primary path → sidesteps the iOS-keyboard-modal bug class.

## Status: what landed vs what remains

**Landed (this scaffold PR):**
- `src/lib/aiCoach.ts` — pure contract + guardrails (payload validation, output sanitization,
  cost model, schema, prompt) + unit tests.
- `api/coach.ts` — the Vercel function with the full gate chain.
- `supabase/migrations/20260627000000_add_ai_coach_tables.sql` — `coach_usage`,
  `coach_global_spend`, `coach_usage_log`, `coach_consent`, and the `SECURITY DEFINER` RPCs
  (`claim_coach_request`, `record_coach_usage`, `record_coach_consent`, `delete_coach_data`).
- `vercel.json` `ignoreCommand` now includes `api/` and `vercel.json` (else a function-only
  change ships green in CI and 404s in prod).

**Remaining Phase 1:**
- `coachDigest.ts` payload builder (mirrors `buildSessionSummary`) + minimization tests.
- `CoachSheet` + the Workouts-tab entry card; render output via text interpolation.
- Versioned consent modal + `LegalSheet` update + hosted `/privacy` + nutrition-label answers.
- **Wire `deleteAccount()` to call `delete_coach_data`** and fix the verified resolved-error
  bug at `src/composables/useAuth.ts:225` (`Promise.allSettled` then `filter(status === 'rejected')`
  — supabase-js *resolves* `{ error }` on a failed delete, so a failed delete passes silently
  and leaves health data on the server). Add a regression test.
- Provision env (`COACH_ENABLED`, `COACH_MODEL`, `ANTHROPIC_API_KEY`, `SUPABASE_URL`,
  `SUPABASE_ANON_KEY`, `COACH_DAILY_CEILING_CENTS`) in Vercel Production scope, plus the
  provider-side monthly budget cap and a Slack spend alert from the function.
- WAF rate rule + BotID on `/api/coach`; CSP `connect-src` + CORS for the native origin.

## Known deploy gotcha

`netlify.toml` is committed (publish=dist, `/*` → index.html, **zero functions**), so
`/api/coach` 404s on any Netlify deploy. Confirm Netlify is dead/removed, or scope the feature
to the Vercel origin and document the exclusion, before launch.

## Local dev / testing

`npm run dev` has no Supabase client (DEV short-circuits in `src/lib/supabase.ts` and `useAuth`),
so the auth-gated function is untestable there. Exercise it via `vercel dev` against a dev
Supabase project with a dev sign-in to mint a JWT; the function stays prod-gated except when
`VERCEL_ENV === 'development' && COACH_DEV_ALLOW === '1'` (a local-only var never set in Vercel).
