import { useAnalytics } from './useAnalytics'

// One-time persisted flag. Presence of this key means the inbound source has
// already been captured for this install, so we never re-log on reload.
const STORAGE_KEY = 'acquisition-source-v1'

// Cap each captured value so a malformed or oversized inbound param can't bloat
// the analytics payload. Marketing source tokens are short by convention.
const MAX_LEN = 64

// The short ?ref= alias (used by Product Hunt, link-in-bio tools) plus the
// standard UTM set. Only these keys are read — arbitrary query params are
// ignored so we never capture unrelated state (e.g. ?tab=).
const PARAM_KEYS = [
  'ref',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
] as const

export type AcquisitionSource = Partial<Record<(typeof PARAM_KEYS)[number], string>>

function sanitize(value: string): string {
  // Bound the token and strip surrounding whitespace. Values are sent as-is to
  // analytics, so keeping them short and trimmed avoids noisy dimensions.
  return value.trim().slice(0, MAX_LEN)
}

/**
 * One-time capture of the inbound acquisition source (`?ref=` / `?utm_*=`).
 *
 * On the first load that carries attribution params, this logs a single
 * `acquisition_source` analytics event, persists a flag so it never re-logs,
 * and strips the params from the URL so they don't persist on reload, get
 * bookmarked, or leak into shared links. Paramless first visits are recorded
 * as `direct` (persisted but not logged) so organic opens aren't re-evaluated.
 *
 * Local-first: nothing is sent to a backend beyond the existing analytics pipe.
 *
 * @param search query string to parse (defaults to the live `location.search`)
 */
export function captureAcquisitionSource(search: string = window.location.search): void {
  let alreadyCaptured = false
  try {
    alreadyCaptured = localStorage.getItem(STORAGE_KEY) !== null
  } catch { /* storage blocked — fall through and attempt a best-effort capture */ }
  if (alreadyCaptured) return

  const params = new URLSearchParams(search)
  const captured: AcquisitionSource = {}
  for (const key of PARAM_KEYS) {
    const raw = params.get(key)
    if (raw) {
      const clean = sanitize(raw)
      if (clean) captured[key] = clean
    }
  }

  const hasSource = Object.keys(captured).length > 0

  // Mark captured even on a paramless first visit so a direct/organic open is
  // recorded once and never re-evaluated against a later inbound link.
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(hasSource ? captured : { ref: 'direct' }))
  } catch { /* storage blocked — the worst case is a duplicate log on next load */ }

  if (!hasSource) return

  // Only attributable (non-direct) first visits emit an event — 'direct' is the
  // absence of a campaign and would just add noise to the analytics dimension.
  useAnalytics().logEvent('acquisition_source', captured)

  // Strip the acquisition params from the URL, preserving any other params
  // (e.g. ?tab=) so they don't persist on reload or leak into shared links.
  if (typeof window !== 'undefined' && window.history?.replaceState) {
    const url = new URL(window.location.href)
    let mutated = false
    for (const key of PARAM_KEYS) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key)
        mutated = true
      }
    }
    if (mutated) {
      const next = url.searchParams.toString()
      window.history.replaceState({}, '', url.pathname + (next ? `?${next}` : '') + url.hash)
    }
  }
}
