/**
 * Canonical, app-wide identity constants for sharing and attribution.
 *
 * The deployment domain is the single SEV1-critical value here (see CLAUDE.md):
 * it must match index.html's meta tags and the production hostname. Never
 * fabricate or guess it — this module is the in-code source of truth so callers
 * don't hardcode a URL each time and risk drift.
 */

/** Canonical production URL. Mirrors index.html canonical/og:url and the prod hostname. */
export const APP_URL = 'https://spa-rho-sandy.vercel.app'

/** Display name. */
export const APP_NAME = 'Lift'

/**
 * One-line pitch used when sharing the app itself (word-of-mouth loop, #713).
 * Kept in sync with index.html's og:description so the message a user sends
 * matches the link preview the recipient sees.
 */
export const APP_TAGLINE =
  'Lift — a free, offline-capable workout tracker. Log sets, track estimated 1RM progress, and hit new PRs.'

/**
 * Attribution `?ref=` tokens stamped onto shared URLs so a share-driven install
 * can be attributed back to the surface it came from (#798). These are the exact
 * tokens the acquisition capture (#715) reads on first load — keep them short
 * and matched there. Without a ref, every share-originated install logs as
 * "direct" and the share→install funnel can't be measured.
 */
export const SHARE_REF = {
  /** The "Share Lift" entry point that shares the app itself (#713). */
  app: 'share_app',
  /** A rasterized workout / PR card shared from the share sheet (#305 / #794). */
  card: 'share_card',
} as const

export type ShareRef = (typeof SHARE_REF)[keyof typeof SHARE_REF]

/**
 * Build the canonical app URL with a `?ref=` attribution token appended, so the
 * acquisition capture (#715) can close the share → install funnel. Returns
 * `APP_URL` unchanged when no ref is supplied. Uses the URL API so an existing
 * query (none today) would be preserved rather than clobbered.
 */
export function appUrlWithRef(ref?: ShareRef): string {
  if (!ref) return APP_URL
  const url = new URL(APP_URL)
  url.searchParams.set('ref', ref)
  return url.toString()
}
