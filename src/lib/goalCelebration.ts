/**
 * Weekly-goal celebration logic (LIFT-764).
 *
 * The app already surfaces the weekly training goal as inline text ("Goal hit")
 * and credits a streak multiplier at the week boundary, but hitting the goal
 * was never *celebrated* — there was no positive-reinforcement moment. This
 * module decides, purely, when to fire a lightweight celebration: the first
 * time the weekly goal is met each week, with extra emphasis when meeting it
 * bumps the streak-duration multiplier tier.
 *
 * The "already celebrated" bookkeeping is intentionally device-local (see
 * GOAL_CELEBRATION_KEY) — like the overload nudge, a celebration is a
 * momentary, per-device experience, not synced account state.
 */

import { XP_CONFIG } from './xp'
import { loadJSON } from './storage'

/** Device-local localStorage key tracking which weeks already celebrated. */
export const GOAL_CELEBRATION_KEY = 'goal-celebration-state'

export interface GoalCelebrationState {
  /** Monday key (YYYY-MM-DD) of the most recently celebrated week, or '' if none. */
  lastCelebratedWeek: string
}

export interface GoalCelebrationDecision {
  /** Monday key (YYYY-MM-DD) of the celebrated week. */
  weekKey: string
  /** Projected consecutive-week streak after meeting this week's goal. */
  streak: number
  /** True when meeting the goal this week bumps the streak-duration multiplier tier. */
  milestone: boolean
}

/** Local-calendar YYYY-MM-DD key for a Date. */
function localDayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Monday-based week key for the local calendar week containing `now`.
 * Matches the Mon–Sun week used by computeWeeklyGoal.
 */
export function weekKeyOf(now: Date = new Date()): string {
  const dow = now.getDay() // 0=Sun, 1=Mon, ...
  const daysSinceMonday = dow === 0 ? 6 : dow - 1
  const monday = new Date(now)
  monday.setDate(now.getDate() - daysSinceMonday)
  monday.setHours(0, 0, 0, 0)
  return localDayKey(monday)
}

/** Streak-duration multiplier for a given consecutive-week count. */
function durationMultiplier(weeks: number): number {
  for (const [threshold, mult] of XP_CONFIG.streakDurationTiers) {
    if (weeks >= threshold) return mult
  }
  return 1.0
}

/**
 * Decide whether to fire the weekly-goal celebration.
 *
 * @param met - is the weekly goal currently met?
 * @param completedStreak - streakWeeks: consecutive met weeks NOT counting the
 *   current in-progress week (this is what progression.streakWeeks holds until
 *   the week boundary is evaluated on Monday).
 * @param lastCelebratedWeek - Monday key already celebrated, or '' / null.
 * @param now - injectable clock for testing.
 * @returns the decision, or null when no celebration should fire.
 */
export function decideGoalCelebration(
  met: boolean,
  completedStreak: number,
  lastCelebratedWeek: string | null,
  now: Date = new Date(),
): GoalCelebrationDecision | null {
  if (!met) return null
  const weekKey = weekKeyOf(now)
  if (weekKey === lastCelebratedWeek) return null
  // Meeting this week's goal projects the streak forward by one week.
  const streak = completedStreak + 1
  const milestone = durationMultiplier(streak) > durationMultiplier(streak - 1)
  return { weekKey, streak, milestone }
}

/** Read the device-local celebration state (corrupt state falls back to fresh). */
export function readGoalCelebrationState(): GoalCelebrationState {
  return loadJSON<GoalCelebrationState>(GOAL_CELEBRATION_KEY, { lastCelebratedWeek: '' })
}

/** Persist the most recently celebrated week. Best-effort. */
export function markGoalWeekCelebrated(weekKey: string): void {
  try {
    localStorage.setItem(GOAL_CELEBRATION_KEY, JSON.stringify({ lastCelebratedWeek: weekKey }))
  } catch {
    /* best-effort — a failed write just means the celebration may repeat */
  }
}
