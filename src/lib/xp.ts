/**
 * XP Calculation Engine
 *
 * Pure, stateless functions for computing XP from workout data.
 * Foundation for the progression system (issue #114).
 *
 * All tunable values live in XP_CONFIG — change numbers there to rebalance.
 */

import type { WorkoutSet } from '../stores/workout'
import { setDayKey } from './dates'

// --- Types ---

export interface StreakHistoryEntry {
  weekStart: string          // ISO date string (Monday), e.g. "2026-03-30"
  streakCount: number        // consecutive weeks maintained
  weeklyTarget: number       // 1-7 days/week
}

// --- Tuning Config ---

/**
 * Single source of truth for all XP tuning knobs.
 * Change values here to rebalance the progression curve.
 */
export const XP_CONFIG = {
  /** Flat XP for the first N sets on a brand-new exercise */
  newExerciseFlatXP: 50,
  /** How many sets get the flat new-exercise rate */
  newExerciseMaxSets: 3,

  /** Flat XP for warmup sets (below warmupThreshold) */
  warmupFlatXP: 10,
  /** Ratio below which a set is considered warmup */
  warmupThreshold: 0.5,

  /** Base XP at the bottom of the working zone (at warmupThreshold) */
  workingBase: 10,
  /** Linear slope across the working zone (controls how fast XP ramps) */
  workingSlope: 176,

  /** Multiplier when tying all-time best (ratio === 1.0) */
  tieMultiplier: 2,
  /** Multiplier when beating all-time best (ratio > 1.0) */
  prMultiplier: 3,

  /** Multiplier for setting a rep record at a given weight (applied to zone XP) */
  repPRMultiplier: 1.25,

  /** Absolute minimum XP per set */
  minXP: 10,

  /** XP for logging bodyweight (once per calendar date) */
  bodyweightXP: 100,

  /** Default rolling window for best 1RM calculation (months) */
  best1RMWindowMonths: 6,

  /** Streak duration tiers: [minWeeks, multiplier], sorted descending */
  streakDurationTiers: [
    [12, 1.75],
    [8, 1.5],
    [4, 1.25],
    [2, 1.1],
    [1, 1.0],
  ] as [number, number][],

  /** Target aggressiveness tiers: [minDays, multiplier], sorted descending */
  streakTargetTiers: [
    [6, 1.5],
    [5, 1.3],
    [4, 1.2],
    [3, 1.1],
    [1, 1.0],
  ] as [number, number][],
}

// --- Weekly Target Range (LIFT-1505) ---

/**
 * The weekly training goal is a whole number of days in
 * [{@link MIN_WEEKLY_TARGET}, {@link MAX_WEEKLY_TARGET}] — the range
 * `StreakHistoryEntry.weeklyTarget` has always documented, and that
 * `progression.setWeeklyTarget` used to be the only thing enforcing.
 *
 * It lives here, beside `streakTargetTiers`, because the target is only ever
 * read as a streak threshold: `evaluateWeek` compares it to the days trained
 * that week, and `lookupTier(XP_CONFIG.streakTargetTiers, …)` prices it.
 */
export const MIN_WEEKLY_TARGET = 1
export const MAX_WEEKLY_TARGET = 7
/** What a new user starts on, and what `user_progression.weekly_target` defaults to. */
export const DEFAULT_WEEKLY_TARGET = 3

/**
 * Coerce a stored or remote weekly target into the legal range (LIFT-1505).
 *
 * The clamp used to be a property of ONE code path — `setWeeklyTarget` — rather
 * than of the field, and neither hydration boundary applied it: `load()` spread
 * `weekly_target` straight out of the `user-progression` blob, and
 * `_fetchFromSupabase` adopted `data.weekly_target` from a column the migration
 * declares with no CHECK constraint. Out of range is silent and permanent in
 * both directions, and both are worse than a visible error:
 *
 *  - **High** (say 99): `daysTrainedThisWeek >= effectiveTarget` is false no
 *    matter how the user trains, so the streak never advances again, the
 *    duration multiplier never tiers up, `GoalCelebration` never fires, and the
 *    weekly-goal pill reads "0 of 99 days" with nothing saying the goal is
 *    unreachable.
 *  - **Zero or negative**: every week counts, including ones with no training at
 *    all, so a dormant account accrues streak weeks and inflates the multiplier
 *    on the first set logged after a layoff.
 *
 * It also propagates: `_syncToSupabase` pushes `weekly_target` back verbatim, so
 * a value corrupted on one device reaches every other device on its next fetch
 * and survives a reinstall.
 *
 * Only a real finite number is accepted — the trap `sanitizeRecentBaselineWeeks`
 * documents. `Number(null)` and `Number([])` are both 0, so a coerce-then-clamp
 * guard would turn a missing or corrupt field into the every-week-counts
 * MINIMUM rather than falling back to the default a new user gets.
 *
 * Rounds rather than floors, preserving `setWeeklyTarget`'s own behaviour — that
 * setter now delegates here, so the range has exactly one definition.
 */
export function sanitizeWeeklyTarget(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_WEEKLY_TARGET
  return Math.max(MIN_WEEKLY_TARGET, Math.min(MAX_WEEKLY_TARGET, Math.round(value)))
}

/**
 * The same range for the staged next-Monday change, where `null` is a real
 * state meaning "nothing staged" — so a corrupt value falls back to `null`
 * rather than to the default, which would INVENT a target change the user never
 * made and let `evaluateWeek` apply it (resetting the streak if it reads as a
 * decrease).
 *
 * A real but out-of-range number is clamped rather than dropped: the user staged
 * something, and clamping is exactly what `setWeeklyTarget` would have done with
 * it. `evaluateWeek` takes `Math.max(weeklyTarget, pendingTargetChange)` as the
 * anti-gaming target, so a clamped-high value makes the week harder, never
 * easier.
 */
export function sanitizePendingTargetChange(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return sanitizeWeeklyTarget(value)
}

// --- Core Functions ---

/**
 * Compute XP earned from a single set.
 *
 * Five zones:
 * - New exercise (first N sets): flat rate
 * - Warmup (<50% of best): flat 10
 * - Working (50–99%): linear 10–98
 * - Tie (exactly 100%): ratio × 100 × tieMultiplier
 * - PR (>100%): ratio × 100 × prMultiplier
 *
 * Optional repPR bonus is added when the set is a rep record at that weight.
 */
export function calculateSetXP(params: {
  setEstimated1RM: number
  exerciseBest1RM: number | null  // null = new/immature exercise
  setIndex?: number               // unused — kept for API compatibility
  isRepPR?: boolean               // true if this set beats the rep record at its weight
}): number {
  const { setEstimated1RM, exerciseBest1RM, isRepPR } = params
  const cfg = XP_CONFIG

  // New/immature exercise: flat rate for all sets (PR detection is suppressed)
  if (exerciseBest1RM === null) {
    return cfg.newExerciseFlatXP
  }

  // Guard against zero/negative best
  if (exerciseBest1RM <= 0) return cfg.minXP

  const ratio = setEstimated1RM / exerciseBest1RM
  let xp: number

  if (ratio > 1.0) {
    // PR zone — beat the best
    xp = Math.round(ratio * 100 * cfg.prMultiplier)
  } else if (ratio === 1.0) {
    // Tie zone — matched the best exactly
    xp = Math.round(ratio * 100 * cfg.tieMultiplier)
  } else if (ratio < cfg.warmupThreshold) {
    // Warmup zone
    xp = cfg.warmupFlatXP
  } else {
    // Working zone: linear from workingBase (at threshold) to ~98 (at ~100%)
    xp = Math.round(cfg.workingBase + (ratio - cfg.warmupThreshold) * cfg.workingSlope)
  }

  xp = Math.max(cfg.minXP, xp)

  // Rep PR multiplier applied to zone XP
  if (isRepPR) {
    xp = Math.round(xp * cfg.repPRMultiplier)
  }

  return xp
}

/**
 * Check if a set is a rep PR — more reps than ever before at the same weight.
 * Used by both XP calculation and UI hints.
 *
 * @param weight - the weight of the current set
 * @param reps - the reps of the current set
 * @param priorSets - all other sets for this exercise (excluding the current set)
 */
export function checkRepPR(
  weight: number,
  reps: number,
  priorSets: WorkoutSet[]
): boolean {
  const bestReps = priorSets
    .filter(s => s.weight === weight)
    .reduce((max, s) => Math.max(max, s.reps), 0)
  return bestReps > 0 && reps > bestReps
}

/**
 * Check if an exercise is "established" — has sets from at least one day
 * prior to the given date. Until established, PR detection is suppressed
 * to prevent XP farming from warmup progressions on new exercises.
 */
export function isExerciseEstablished(sets: WorkoutSet[], currentDate: string): boolean {
  const today = currentDate.slice(0, 10)
  const priorDays = new Set(sets.map(s => s.date.slice(0, 10)))
  return priorDays.size >= 1 && !([...priorDays].every(d => d === today))
}

/**
 * Calculate the best estimated 1RM for an exercise within a time window.
 *
 * - If `sinceDate` is provided (YYYY-MM-DD or ISO), only sets on or after that
 *   date are considered. Takes precedence over `windowMonths`.
 * - Otherwise falls back to the rolling `windowMonths` window
 *   (default: XP_CONFIG.best1RMWindowMonths).
 *
 * Returns null when no sets fall inside the window.
 */
export function calculateBest1RM(
  sets: WorkoutSet[],
  options: { windowMonths?: number; sinceDate?: string | null } = {}
): number | null {
  if (sets.length === 0) return null

  let cutoff: number
  if (options.sinceDate) {
    // Normalize to start-of-day for YYYY-MM-DD inputs so the anchor day itself is included.
    const anchor = options.sinceDate.length === 10
      ? options.sinceDate + 'T00:00:00'
      : options.sinceDate
    const parsed = new Date(anchor).getTime()
    if (isNaN(parsed)) return calculateBest1RM(sets, { windowMonths: options.windowMonths })
    cutoff = parsed
  } else {
    const months = options.windowMonths ?? XP_CONFIG.best1RMWindowMonths
    const windowMs = months * 30 * 24 * 60 * 60 * 1000
    cutoff = Date.now() - windowMs
  }

  let best: number | null = null

  for (const set of sets) {
    const setTime = new Date(set.date).getTime()
    if (setTime < cutoff) continue

    if (best === null || set.estimated1RM > best) {
      best = set.estimated1RM
    }
  }

  return best
}

/**
 * Look up the streak multiplier for a given date.
 *
 * Multiplier = durationMultiplier × targetMultiplier
 * Uses the streak history entry whose week contains the set date.
 */
export function applyStreakMultiplier(
  baseXP: number,
  streakHistory: StreakHistoryEntry[],
  setDate: string
): number {
  const entry = findStreakEntry(streakHistory, setDate)
  if (!entry || entry.streakCount < 1) return baseXP

  const durationMult = lookupTier(XP_CONFIG.streakDurationTiers, entry.streakCount)
  const targetMult = lookupTier(XP_CONFIG.streakTargetTiers, entry.weeklyTarget)

  return Math.round(baseXP * durationMult * targetMult)
}

// --- Helpers ---

/**
 * Find the streak history entry whose week contains the given date.
 * Week starts on Monday (ISO 8601).
 */
function findStreakEntry(
  history: StreakHistoryEntry[],
  dateStr: string
): StreakHistoryEntry | null {
  // Normalize to a LOCAL day key first (LIFT-1214). A bare YYYY-MM-DD is
  // already the local day key and must pass through untouched; timestamps go
  // through setDayKey, which reconciles both stored shapes (endOfDayISO
  // stamps carry the local day in their prefix; real-time toISOString()
  // instants need local conversion). Local-midnight parsing then keeps
  // getMonday's local read on that exact calendar day. Previously a
  // real-time stamp from a US Sunday-evening set resolved to UTC-Monday and
  // looked up the wrong week's streak entry for the XP multiplier.
  const dayKey = dateStr.length === 10 ? dateStr : setDayKey(dateStr)
  const date = new Date(dayKey + 'T00:00:00')
  const monday = getMonday(date)
  const mondayKey = toDateKey(monday)

  return history.find(e => e.weekStart === mondayKey) ?? null
}

/**
 * Get the Monday of the week containing the given date's LOCAL calendar day.
 * Anchored at UTC midnight of that Monday so stepping/formatting stay exact.
 * LIFT-1214: was pure UTC, which rolled US Sunday evenings into next week.
 * Keep this in sync with the identical helper in src/stores/progression.ts.
 */
function getMonday(date: Date): Date {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay()
  // getUTCDay: 0=Sun, 1=Mon, ..., 6=Sat
  // Shift so Monday=0: (day + 6) % 7
  const diff = (day + 6) % 7
  d.setUTCDate(d.getUTCDate() - diff)
  return d
}

/** Format a Date as YYYY-MM-DD (UTC). */
function toDateKey(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Look up the multiplier from a tier table (sorted descending by threshold). */
function lookupTier(tiers: [number, number][], value: number): number {
  for (const [threshold, multiplier] of tiers) {
    if (value >= threshold) return multiplier
  }
  return 1.0
}
