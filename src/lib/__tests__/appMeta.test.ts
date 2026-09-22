import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { APP_URL, APP_NAME, APP_TAGLINE, APP_BUNDLE_ID, SHARE_REF, appUrlWithRef } from '../appMeta'

/**
 * Pins the app-share identity constants. These feed the "Share Logbook" entry
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
    expect(APP_NAME).toBe('Logbook')
  })

  it('APP_TAGLINE is non-empty and mentions the app', () => {
    expect(APP_TAGLINE.length).toBeGreaterThan(0)
    expect(APP_TAGLINE).toContain('Logbook')
  })

  it('APP_BUNDLE_ID is the appId capacitor.config.ts builds the native shell with', () => {
    // Derived from the config, not restated: HealthKit reports this id as the
    // sourceId of every sample Logbook writes, and the Health sync matches on it
    // (#1420) — a drift would make Logbook blind to its own samples.
    const config = readFileSync(resolve(__dirname, '..', '..', '..', 'capacitor.config.ts'), 'utf8')
    const appId = config.match(/appId:\s*'([^']+)'/)?.[1]
    expect(appId).toBeDefined()
    expect(APP_BUNDLE_ID).toBe(appId)
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
