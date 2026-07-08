/**
 * AI Coach — Supporter tier model (LIFT-904).
 *
 * The AI Coach is the ONE Lift feature with a real, recurring per-user API cost
 * (Claude Opus 4.8 through the server proxy in `api/coach.ts`). That makes it the
 * one place a paid tier is philosophically defensible: keep all tracking + a
 * baseline weekly digest FREE, and anchor the Supporter entitlement on
 * *more-frequent* coach runs so supporter revenue funds the API bill instead of
 * taxing the core tracking loop (CLAUDE.md Principle 2 / freemium best practice —
 * gate the feature with a marginal cost, never the core loop).
 *
 * This is a tiny, pure module (no browser/network/store deps) so it is the single
 * source of truth shared by both the client entitlement (`useSupporter`) and the
 * server proxy (`api/coach.ts`, via a re-export from `aiCoach.ts`) for the per-tier
 * weekly review allowance.
 *
 * TRUST NOTE (load-bearing): the server NEVER trusts a client-claimed limit. It
 * passes the FREE baseline as `claim_coach_request`'s `p_default_limit`; a
 * supporter's higher allowance is applied server-side through the trusted
 * `coach_usage.limit_override` column, set from a validated entitlement
 * (RevenueCat / StoreKit IAP — LIFT-598), never from a value the client sends for
 * itself. `weeklyReviewLimit()` here is the source of truth for that override value
 * AND for the client's cosmetic "N reviews left this week" display.
 */

/** Free tier: reviews per rolling 7-day window — the baseline weekly digest, free forever. */
export const FREE_WEEKLY_LIMIT = 3

/**
 * Supporter tier: a higher rolling-7-day allowance — the cost-recovery value prop.
 * Sized so a supporter can run the coach roughly on demand within a week while
 * staying comfortably under the global `$2/day` spend ceiling (docs/ai-coach.md).
 */
export const SUPPORTER_WEEKLY_LIMIT = 10

/** Effective rolling-7-day review allowance for a given entitlement. */
export function weeklyReviewLimit(isSupporter: boolean): number {
  return isSupporter ? SUPPORTER_WEEKLY_LIMIT : FREE_WEEKLY_LIMIT
}
