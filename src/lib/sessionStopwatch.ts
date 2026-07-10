/**
 * Live in-workout session stopwatch (LIFT-926).
 *
 * Pure helpers for the running "time since your first set today" clock shown
 * next to the Finish-workout affordance. Framework-free so the tick loop lives
 * in a thin composable while the tricky bits — the display format and the
 * decision of when a session actually started — stay unit-testable.
 *
 * Why a persisted start rather than deriving from set timestamps: UI-logged
 * sets are stamped with `endOfDayISO()` (`…T23:59:ssZ`), NOT a real-time
 * instant, so the earliest set carries no usable wall-clock start. The
 * composable persists the real start once (device-local, deliberately NOT
 * synced — like the overload nudge and goal-celebration state) and this module
 * resolves what value to trust on (re)mount.
 */

/** Shape persisted to localStorage under `workout-session-start`. */
export interface StoredSessionStart {
  /** Local day key (YYYY-MM-DD) the session belongs to. */
  dayKey: string
  /** Epoch ms of the session's first set. */
  startedAt: number
}

/** Type guard for a parsed `StoredSessionStart` blob (rejects junk/corrupt storage). */
export function isStoredSessionStart(value: unknown): value is StoredSessionStart {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.dayKey === 'string' &&
    v.dayKey.length > 0 &&
    typeof v.startedAt === 'number' &&
    Number.isFinite(v.startedAt)
  )
}

/**
 * Format an elapsed millisecond span as a wall-clock stopwatch string.
 *
 * - Under an hour: `M:SS` (minutes not zero-padded, seconds padded) → `0:07`, `24:31`.
 * - An hour or more: `H:MM:SS` → `1:05:09`.
 *
 * Negative/non-finite spans clamp to `0:00` so a clock skew can never render a
 * garbage or negative value.
 */
export function formatSessionClock(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0
  const totalSec = Math.floor(safe / 1000)
  const hours = Math.floor(totalSec / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  const seconds = totalSec % 60
  const ss = String(seconds).padStart(2, '0')
  if (hours > 0) {
    const mm = String(minutes).padStart(2, '0')
    return `${hours}:${mm}:${ss}`
  }
  return `${minutes}:${ss}`
}

/**
 * Decide the epoch-ms start to count up from, given the persisted value and the
 * current session context. Returns `null` when there is no active session.
 *
 * - No sets logged today → no active session (`null`), regardless of storage.
 * - A stored start for *today* whose timestamp is not in the future → trust it
 *   (survives reload / backgrounding mid-session).
 * - Otherwise (stale day key, corrupt/absent storage, or a future timestamp
 *   from a clock change) → start fresh at `now`.
 */
export function resolveSessionStart(
  stored: StoredSessionStart | null,
  todayKey: string,
  hasSetsToday: boolean,
  now: number,
): number | null {
  if (!hasSetsToday) return null
  if (stored && stored.dayKey === todayKey && stored.startedAt <= now) {
    return stored.startedAt
  }
  return now
}
