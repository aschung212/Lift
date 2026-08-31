/**
 * Strength baseline mode — what "your best" means while bulking vs cutting
 * (#1272).
 *
 * Every PR/XP surface in the app already resolves through ONE value: a
 * `sinceDate` day key that says "only sets on or after this day count as your
 * best" (`getExercisePR`, `calculateBest1RM`, `filterSetsSinceBaseline`). Until
 * now that day key had exactly one source — the manual `prBaselineDate` anchor
 * a user sets in Settings, or clears with "Start new training block".
 *
 * That anchor works for a bulk, where the goal is to beat your best every
 * session and the peak IS the target. It fails on a cut: strength drops off as
 * the deficit accumulates, so a peak-bulk anchor gets less meaningful every
 * week, PR detection goes quiet, and the XP curve collapses to the working zone
 * — the app stops rewarding a lifter for the hardest part of the year.
 *
 * The fix is a MODE, not a second measurement path:
 *
 *  - `lifetime` (default) — the anchor as it has always behaved. `null` means
 *    all-time for display PRs and the rolling `XP_CONFIG.best1RMWindowMonths`
 *    window for XP.
 *  - `recent` — a rolling window `recentBaselineWeeks` long, recomputed against
 *    today. "Best" means "best you've hit lately", so equaling recent work is a
 *    tie (2× XP) and edging it is a PR (3× XP) even while the lifetime peak is
 *    out of reach.
 *
 * Both modes resolve to the SAME `sinceDate` day key, which is why nothing
 * downstream needs to know the mode exists: display badges, the PR burst, the
 * intensity lens anchor, the PR-target card, and `scoreSet`'s XP calibration
 * all move together by construction. Adding a parallel "recent best" lookup
 * beside the existing one would have meant two answers to "what's my max?" and
 * two places for every future PR consumer to get wrong.
 *
 * The anchor is NOT discarded in recent mode — the two are both floors, so the
 * effective baseline is the LATER of them. A block started three weeks ago
 * still shadows an eight-week window; a block started last year does not.
 *
 * Ledger invariant (unchanged, see usePRBaseline): XP already awarded is never
 * recomputed. Switching modes only affects future set evaluations and badges
 * computed on the fly.
 *
 * Pure and clock-free: `todayKey` is a parameter, like `buildSessionPlan`'s.
 */

import { localDateKey } from './dates'

export type StrengthBaselineMode = 'lifetime' | 'recent'

/** Order shown in the Settings segmented control. */
export const STRENGTH_BASELINE_MODES: readonly StrengthBaselineMode[] = ['lifetime', 'recent']

export const DEFAULT_STRENGTH_BASELINE_MODE: StrengthBaselineMode = 'lifetime'

/**
 * Default trailing window for recent mode.
 *
 * Eight weeks is long enough to span a full training block (so a deload week or
 * a missed session can't erase your reference point) and short enough that a
 * peak set from before a cut started has aged out. It is also comfortably
 * shorter than the 6-month `XP_CONFIG.best1RMWindowMonths` fallback, so
 * switching to recent mode always narrows the window rather than widening it.
 */
export const DEFAULT_RECENT_BASELINE_WEEKS = 8
export const MIN_RECENT_BASELINE_WEEKS = 2
export const MAX_RECENT_BASELINE_WEEKS = 26
/** Stepper increment in Settings. */
export const RECENT_BASELINE_WEEKS_STEP = 2

const DAYS_PER_WEEK = 7

/** Coerce a stored/user-supplied mode; anything unrecognized falls back to the default. */
export function sanitizeStrengthBaselineMode(value: unknown): StrengthBaselineMode {
  return value === 'recent' || value === 'lifetime' ? value : DEFAULT_STRENGTH_BASELINE_MODE
}

/**
 * Clamp a stored/user-supplied window length into [{@link MIN_RECENT_BASELINE_WEEKS},
 * {@link MAX_RECENT_BASELINE_WEEKS}]. Fractional values are floored. Validated at
 * every boundary (store setter, localStorage load, remote fetch) so a corrupt or
 * hand-edited blob can't produce a nonsense window.
 *
 * Deliberately stricter than `sanitizeIntensityMaxReps`, which coerces with
 * `Number(value)` first: `Number(null)` and `Number([])` are both 0, so a
 * missing/corrupt field would coerce-then-clamp to the 2-week MINIMUM — the most
 * aggressive window there is, silently applied — instead of falling back to the
 * default. Only a real finite number is accepted here.
 */
export function sanitizeRecentBaselineWeeks(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_RECENT_BASELINE_WEEKS
  return Math.max(MIN_RECENT_BASELINE_WEEKS, Math.min(MAX_RECENT_BASELINE_WEEKS, Math.floor(value)))
}

/**
 * First day key inside a `weeks`-long trailing window ending today: sets on or
 * after `todayKey − weeks × 7 days` count.
 *
 * Stepped through local calendar fields (`setDate`) rather than millisecond
 * arithmetic so a DST transition inside the window can't shift the boundary by
 * a day. Returns null for an unparseable key, letting the caller fall back to
 * the anchor rather than inventing a window.
 */
export function recentWindowStart(todayKey: string, weeks: number): string | null {
  const d = new Date(todayKey + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return null
  d.setDate(d.getDate() - sanitizeRecentBaselineWeeks(weeks) * DAYS_PER_WEEK)
  return localDateKey(d)
}

/**
 * The effective PR baseline day key — the single value every PR/XP consumer
 * reads. `null` preserves the legacy all-time (display) / rolling-window (XP)
 * behavior.
 *
 * In recent mode the manual anchor and the rolling window are both floors, so
 * the result is whichever is LATER (the narrower window). Day keys are
 * zero-padded `YYYY-MM-DD`, so a lexical compare is a chronological one.
 */
export function resolveStrengthBaseline(options: {
  mode: StrengthBaselineMode
  /** The user's manual `prBaselineDate` anchor, or null for none. */
  anchor: string | null
  weeks: number
  /** Today's LOCAL day key (`todayISO()` at the call site). */
  todayKey: string
}): string | null {
  const { mode, anchor, weeks, todayKey } = options
  if (mode !== 'recent') return anchor
  const start = recentWindowStart(todayKey, weeks)
  if (start === null) return anchor
  if (!anchor) return start
  return anchor > start ? anchor : start
}
