import { describe, it, expect } from 'vitest'
import { APP_URL, APP_NAME, APP_TAGLINE, SHARE_REF, appUrlWithRef } from '../appMeta'

/**
 * Pins the app-share identity constants. These feed the "Share Lift" entry
 * point (#713) and any future attribution, so a fabricated/competitor domain
 * here would silently send users elsewhere — the exact SEV1 class of bug from
 * 2026-04-02 (see CLAUDE.md). Mirrors metaRegression.test.ts's domain pinning.
 */
describe('appMeta', () => {
  it('APP_URL is the canonical production deployment', () => {
    expect(APP_URL).toBe('https://spa-rho-sandy.vercel.app')
  })

  it('APP_URL never references the hallucinated competitor domain', () => {
    expect(APP_URL).not.toContain('liftracker.app')
  })

  it('APP_NAME is the display name', () => {
    expect(APP_NAME).toBe('Lift')
  })

  it('APP_TAGLINE is non-empty and mentions the app', () => {
    expect(APP_TAGLINE.length).toBeGreaterThan(0)
    expect(APP_TAGLINE).toContain('Lift')
  })
})

/**
 * Pins the share-attribution helper (#798). The `?ref=` token it stamps must be
 * read back verbatim by the acquisition capture (#715) — a drift here silently
 * breaks the share → install funnel, logging every share-driven install as
 * "direct".
 */
describe('appUrlWithRef', () => {
  it('returns APP_URL unchanged when no ref is given', () => {
    expect(appUrlWithRef()).toBe(APP_URL)
  })

  it('appends the share_app ref as a ?ref= query param', () => {
    expect(appUrlWithRef(SHARE_REF.app)).toBe(`${APP_URL}/?ref=share_app`)
  })

  it('appends the share_card ref as a ?ref= query param', () => {
    expect(appUrlWithRef(SHARE_REF.card)).toBe(`${APP_URL}/?ref=share_card`)
  })

  it('still targets the canonical deployment domain', () => {
    expect(appUrlWithRef(SHARE_REF.app)).toContain('spa-rho-sandy.vercel.app')
    expect(appUrlWithRef(SHARE_REF.app)).not.toContain('liftracker.app')
  })

  it('produces a ref the acquisition capture reads back to the same token', () => {
    // Mirror useAcquisitionSource's parse: read `ref` from the URL's query.
    const ref = new URL(appUrlWithRef(SHARE_REF.app)).searchParams.get('ref')
    expect(ref).toBe(SHARE_REF.app)
  })
})
