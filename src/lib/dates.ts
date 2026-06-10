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
