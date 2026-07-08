/**
 * Duration-set helpers for time-based exercises (LIFT-836).
 *
 * Planks, dead hangs, loaded carries and isometric holds are measured in
 * seconds, not weight × reps. A duration exercise (`exerciseType: 'duration'`)
 * stores its work on `WorkoutSet.durationSeconds`; `weight`/`reps`/`estimated1RM`
 * stay 0 so the set contributes nothing to volume, e1RM or PR math (it is
 * deliberately excluded — a 60s plank has no meaningful 1RM).
 *
 * These helpers are pure (no store / DOM access) so they can be unit-tested and
 * reused by the log modal, the timeline and any summary surface.
 */

/** Hard cap on a logged duration: 24h − 1s. Keeps the integer column sane. */
export const MAX_DURATION_SECONDS = 86399

/**
 * Clamp an arbitrary number to a valid, whole-second duration. Floors
 * fractional input and clamps to [0, MAX_DURATION_SECONDS]. Non-finite input
 * (NaN/Infinity) collapses to 0 so corrupt storage can never poison the table.
 */
export function sanitizeDurationSeconds(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(MAX_DURATION_SECONDS, Math.max(0, Math.floor(value)))
}

/**
 * Format a whole-second duration for display.
 *   45    → "0:45"
 *   90    → "1:30"
 *   600   → "10:00"
 *   3665  → "1:01:05"  (hours appear only when present)
 * Minutes/seconds are zero-padded; the leading component is not.
 */
export function formatDuration(totalSeconds: number): string {
  const s = sanitizeDurationSeconds(totalSeconds)
  const hours = Math.floor(s / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const seconds = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`
  }
  return `${minutes}:${pad(seconds)}`
}

/**
 * Parse a user-typed duration into whole seconds.
 *
 * Accepts:
 *   "90"       → 90        (a bare number is seconds)
 *   "1:30"     → 90        (mm:ss)
 *   "1:01:05"  → 3665      (hh:mm:ss)
 *
 * Colon-separated minute/second components are clamped to a 0–59 contribution
 * is NOT enforced — "1:90" parses as 1*60+90; the caller gets the literal sum,
 * which keeps the parser forgiving for users who type "0:90" meaning 90s. The
 * result is sanitized (floored, clamped). Returns null for empty/invalid input
 * (non-numeric parts, too many colon segments) so the caller can keep the field
 * un-committed.
 */
export function parseDurationInput(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null

  if (trimmed.includes(':')) {
    const parts = trimmed.split(':')
    if (parts.length > 3) return null
    let total = 0
    for (const part of parts) {
      if (!/^\d+$/.test(part.trim())) return null
      total = total * 60 + Number(part.trim())
    }
    return sanitizeDurationSeconds(total)
  }

  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null
  return sanitizeDurationSeconds(Number(trimmed))
}
