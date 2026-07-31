/**
 * AI Coach daily-spend alert (LIFT-850).
 *
 * The global daily ceiling (`COACH_DAILY_CEILING_CENTS`, default $2) is the abuse
 * brake that auto-pauses the feature at 100%. This module is the *early warning*:
 * pure formatting for the Slack message fired from `api/coach.ts` the first time a
 * day's cumulative spend crosses the alert threshold. The once-per-day guard lives
 * server-side in the `record_coach_usage` RPC (a stateless function can't dedupe);
 * this file only decides the threshold and renders the text.
 */

/** Fraction of the daily ceiling that trips the early-warning alert. */
export const SPEND_ALERT_FRACTION = 0.5

/** The whole-cent spend at which the alert should fire for a given ceiling. */
export function spendAlertThresholdCents(ceilingCents: number): number {
  if (!Number.isFinite(ceilingCents) || ceilingCents <= 0) return 0
  return Math.floor(ceilingCents * SPEND_ALERT_FRACTION)
}

/** Format whole US cents as a `$X.XX` amount. */
function dollars(cents: number): string {
  const safe = Number.isFinite(cents) && cents > 0 ? cents : 0
  return `$${(safe / 100).toFixed(2)}`
}

/**
 * Slack message body for a daily-spend alert. Reports the current spend, the
 * ceiling, and the percentage reached, and names the auto-pause backstop so the
 * on-call reader knows no action is strictly required yet.
 */
export function buildSpendAlertText(spentCents: number, ceilingCents: number): string {
  const pct =
    Number.isFinite(ceilingCents) && ceilingCents > 0
      ? Math.round((spentCents / ceilingCents) * 100)
      : 0
  return (
    `:warning: AI Coach daily spend at ${pct}% of ceiling — ` +
    `${dollars(spentCents)} of ${dollars(ceilingCents)} today. ` +
    `Auto-pauses at 100% (COACH_DAILY_CEILING_CENTS).`
  )
}
