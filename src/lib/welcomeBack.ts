/**
 * Welcome-back re-entry logic (LIFT-1107).
 *
 * When a user returns after a long gap (default ≥14 days since their last logged
 * workout), Lift shows the same cold normal state as any session — no
 * acknowledgement, no "your data is safe", no bridge back in. Churn research on
 * the first-30-day window favors an "educate, don't apologize" win-back moment
 * over a silent cold start. This module decides, purely, whether to surface a
 * one-time warm banner recapping the absence and offering a one-tap way back in.
 *
 * The "already welcomed" bookkeeping is intentionally device-local (see
 * WELCOME_BACK_KEY) — like the overload nudge and goal celebration, a re-entry
 * moment is a momentary per-device experience, not synced account state. It is
 * keyed on the LAST WORKOUT DATE (not a timestamp) so the banner shows once per
 * absence: it stays suppressed while the user browses without logging, and
 * re-arms only after they log a fresh workout and then lapse again.
 */

import { loadJSON } from './storage'
import { localDateKey, daysBetweenISO } from './dates'

/** Device-local localStorage key tracking the last absence we welcomed back. */
export const WELCOME_BACK_KEY = 'welcome-back-state'

/** Minimum days since the last workout before the re-entry banner fires. */
export const INACTIVITY_GAP_DAYS = 14

export interface WelcomeBackState {
  /**
   * The last-workout day key (YYYY-MM-DD) an earlier session already welcomed the
   * user back for, or '' if none. Suppresses a repeat banner for the same absence.
   */
  acknowledgedWorkoutDate: string
}

export interface WelcomeBackDecision {
  /** Day key (YYYY-MM-DD) of the most recent logged workout. */
  lastWorkoutDate: string
  /** Whole days between that workout and today. */
  daysAway: number
}

/**
 * Decide whether to show the welcome-back banner.
 *
 * @param workoutDates - the store's sorted-ascending unique workout day keys.
 * @param acknowledgedWorkoutDate - last absence already welcomed, or '' / null.
 * @param now - injectable clock for testing.
 * @returns the decision, or null when no banner should show.
 */
export function decideWelcomeBack(
  workoutDates: string[],
  acknowledgedWorkoutDate: string | null,
  now: Date = new Date(),
): WelcomeBackDecision | null {
  if (workoutDates.length === 0) return null
  const lastWorkoutDate = workoutDates[workoutDates.length - 1]
  const daysAway = daysBetweenISO(lastWorkoutDate, localDateKey(now))
  // Guard against a future-dated last workout (clock skew / bad data): a negative
  // or short gap is not an absence.
  if (daysAway < INACTIVITY_GAP_DAYS) return null
  // Already welcomed for this exact absence — don't nag on every re-open.
  if (lastWorkoutDate === acknowledgedWorkoutDate) return null
  return { lastWorkoutDate, daysAway }
}

/** Read the device-local welcome-back state (corrupt state falls back to fresh). */
export function readWelcomeBackState(): WelcomeBackState {
  return loadJSON<WelcomeBackState>(WELCOME_BACK_KEY, { acknowledgedWorkoutDate: '' })
}

/** Persist the absence we just welcomed the user back for. Best-effort. */
export function markWelcomedBack(lastWorkoutDate: string): void {
  try {
    localStorage.setItem(WELCOME_BACK_KEY, JSON.stringify({ acknowledgedWorkoutDate: lastWorkoutDate }))
  } catch {
    /* best-effort — a failed write just means the banner may repeat next open */
  }
}
