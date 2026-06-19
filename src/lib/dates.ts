/**
 * Shared local-calendar date helpers.
 *
 * The workout store persists full UTC ISO timestamps (`Date.toISOString()`),
 * but the user's mental model — and every screen in the app — operates on the
 * LOCAL calendar day. These helpers are the single source of truth for that
 * conversion. Deriving a day key from `toISOString().slice(0, 10)` instead
 * shifts evening dates to tomorrow in US timezones (UTC midnight arrives
 * mid-evening local time), which is how the same bug was fixed independently
 * in three components before this module existed.
 */

function localDayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Today's date as a local-calendar YYYY-MM-DD key. */
export function todayISO(): string {
  return localDayKey(new Date())
}

/**
 * Convert an ISO timestamp to its local-calendar YYYY-MM-DD key.
 * Unparseable input falls back to the raw date prefix.
 */
export function toLocalDateKey(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso.slice(0, 10)
  return localDayKey(new Date(t))
}

/**
 * Day key for a stored set/bodyweight date, correct for BOTH storage
 * conventions the app produces:
 *
 *  - **endOfDayISO stamps** (`YYYY-MM-DDT23:59:ss.SSSZ`) — written by every
 *    UI-logged set and bodyweight entry — carry the user's chosen LOCAL day
 *    directly in the prefix. `slice(0, 10)` is the right key; `toLocalDateKey`
 *    would shift it +1 in UTC+ timezones (`…T23:59Z` is the next morning local
 *    in Tokyo).
 *  - **Real-time stamps** (`logSet`'s no-date fallback, legacy data) are true
 *    UTC instants. `toLocalDateKey` returns the correct local day, while
 *    `slice(0, 10)` rolls an Americas-evening set forward to tomorrow.
 *
 * Detection mirrors `sessionSummary.isEndOfDayJitter`: the `23:59` UTC window is
 * the signature of `endOfDayISO()`. A real-time stamp landing in that one-minute
 * UTC window is the same unavoidable edge case that prior art already accepts.
 *
 * Use this for any day-bucketing or local-day comparison of a `set.date` /
 * `entry.date`. A blanket swap to `toLocalDateKey` regresses every UTC+ user on
 * the dominant endOfDayISO path; a blanket `slice(0, 10)` regresses Americas
 * evenings on real-time data. This helper is the single reconciliation point.
 */
export function setDayKey(iso: string): string {
  return iso.slice(11, 16) === '23:59' ? iso.slice(0, 10) : toLocalDateKey(iso)
}

/**
 * Short locale-aware display date, e.g. "Jan 5".
 * Accepts anything `new Date()` parses; pass date-only keys with a noon
 * suffix (`key + 'T12:00:00'`) to avoid timezone rollover at the boundary.
 */
export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Whole days between two local YYYY-MM-DD keys (positive when `b` is later). */
export function daysBetweenISO(a: string, b: string): number {
  return Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000)
}
