/**
 * Plateau / stall detection for an exercise's estimated-1RM trend (LIFT-1025).
 *
 * The #1 competitor complaint in 2026 reviews is "it records, it doesn't
 * think" — loggers show a flat curve but never name the stall. Lift already
 * computes `estimated1RM` per set; this pure helper reads the per-session
 * daily-best e1RM sequence and flags when an exercise's best e1RM has not made
 * a new high across the most recent N sessions.
 *
 * Local-first and always-on: it powers a subtle on-graph badge (visual over
 * verbal, design principle #4) and reaches users who never opt into the
 * server-side AI Coach weekly digest.
 */

export interface PlateauInput {
  /** ISO-ish day key (YYYY-MM-DD…); only chronological order is used. */
  date: string
  /** Best estimated 1RM for that session. */
  value: number
}

export interface PlateauResult {
  /** True when the peak e1RM is at least `stallSessions` sessions in the past. */
  isPlateau: boolean
  /**
   * Number of consecutive most-recent sessions that failed to beat the peak
   * e1RM. Zero when the latest session itself set the peak.
   */
  sessionsStalled: number
  /** The peak (best) e1RM across the analyzed sessions. */
  peakValue: number
}

/** Minimum sessions of history required before a plateau can be claimed. */
export const PLATEAU_MIN_SESSIONS = 4
/** Trailing sessions without a new peak that constitute a stall. */
export const PLATEAU_STALL_SESSIONS = 3

const NO_PLATEAU: PlateauResult = { isPlateau: false, sessionsStalled: 0, peakValue: 0 }

/**
 * Detects an e1RM plateau over a chronologically-sorted daily-best sequence.
 *
 * Algorithm: find the first session that reached the maximum e1RM, then count
 * how many sessions came after it. Those trailing sessions all failed to set a
 * new high, so `trailing >= stallSessions` (with enough total history) is a
 * stall. Using the *first* peak session as the anchor means a lifter who ties
 * their best repeatedly is still counted as stalled — a tie is not progress.
 *
 * Requires `minSessions` of history so a brand-new exercise with two flat
 * sessions is never mislabeled, and returns the raw `sessionsStalled` count so
 * callers can phrase the nudge ("no new best in 4 sessions").
 */
export function detectPlateau(
  entries: readonly PlateauInput[],
  opts: { minSessions?: number; stallSessions?: number } = {},
): PlateauResult {
  const minSessions = opts.minSessions ?? PLATEAU_MIN_SESSIONS
  const stallSessions = opts.stallSessions ?? PLATEAU_STALL_SESSIONS
  if (entries.length < minSessions) return NO_PLATEAU

  let peakValue = -Infinity
  let peakIndex = 0
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].value > peakValue) {
      peakValue = entries[i].value
      peakIndex = i
    }
  }

  const sessionsStalled = entries.length - 1 - peakIndex
  return {
    isPlateau: sessionsStalled >= stallSessions,
    sessionsStalled,
    peakValue,
  }
}
