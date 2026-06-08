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
