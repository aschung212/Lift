import { describe, it, expect } from 'vitest'
import { APP_URL, APP_NAME, APP_TAGLINE } from '../appMeta'

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
