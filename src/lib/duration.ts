/**
 * Duration-set helpers (LIFT-836).
 *
 * Timed strength movements (planks, dead hangs, loaded carries, isometric
 * holds) are logged as a number of SECONDS rather than weight × reps. This
 * module is the single source of truth for turning that raw second count into a
 * display string and for parsing the user's typed input back into seconds.
 *
 * Storage convention: a duration set stores its seconds in `WorkoutSet.duration`
 * and carries `weight`/`reps`/`estimated1RM` as 0 so it is naturally excluded
 * from 1RM/PR math (which maxes over `estimated1RM`). See docs / CLAUDE.md.
 *
 * Everything here is pure and side-effect free.
 */

/** 23:59:59 — a single set longer than a day is a typo, not a hold. */
export const MAX_DURATION_SECONDS = 86399

/**
 * Format a second count as a compact clock string:
 *   45      → "0:45"
 *   90      → "1:30"
 *   3600    → "1:00:00"
 *   3725    → "1:02:05"
 * Minutes/seconds are zero-padded; the leading unit is not. Negative,
 * non-finite, or fractional inputs are coerced to a sane non-negative integer.
 */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) totalSeconds = 0
  const s = Math.floor(totalSeconds)
  const hours = Math.floor(s / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const seconds = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`
  return `${minutes}:${pad(seconds)}`
}

/**
 * Parse a user-typed duration into whole seconds, or `null` when the input
 * can't be read as a duration. Accepts:
 *   - bare seconds:            "90"     → 90
 *   - m:ss / mm:ss:            "1:30"   → 90
 *   - h:mm:ss:                 "1:02:05"→ 3725
 * Colon-separated minute/second fields must be in [0, 59]; a bare number is
 * treated as a raw second count. The result is clamped to
 * [0, MAX_DURATION_SECONDS]. Empty/whitespace input returns `null`.
 */
export function parseDurationInput(raw: string): number | null {
  const str = raw.trim()
  if (str === '') return null

  if (str.includes(':')) {
    const parts = str.split(':')
    if (parts.length < 2 || parts.length > 3) return null
    const nums: number[] = []
    for (const part of parts) {
      if (!/^\d+$/.test(part)) return null
      nums.push(Number(part))
    }
    // The seconds field, and the minutes field when hours are present, must be
    // a valid sexagesimal digit — "1:90" is a mistype, not 150 seconds.
    const seconds = nums[nums.length - 1]
    const minutes = nums[nums.length - 2]
    if (seconds > 59) return null
    if (nums.length === 3 && minutes > 59) return null
    let total = 0
    for (const n of nums) total = total * 60 + n
    return clampDuration(total)
  }

  if (!/^\d+$/.test(str)) return null
  return clampDuration(Number(str))
}

/** Clamp a raw second count into the valid stored range. */
export function clampDuration(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) return 0
  return Math.min(MAX_DURATION_SECONDS, Math.floor(seconds))
}

/**
 * Boundary sanitizer for a persisted/synced `duration` value (localStorage or
 * Supabase). Returns a valid positive second count, or `null` for anything that
 * isn't a usable duration (missing, zero, negative, non-finite, non-numeric) —
 * so a set only counts as a duration set when it carries a real hold time.
 */
export function sanitizeDuration(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(n) || n <= 0) return null
  return clampDuration(n)
}
