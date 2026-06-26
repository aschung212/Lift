/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf-8')

/**
 * Regression tests for index.html meta tags.
 *
 * Backstory: The overnight builder hallucinated "liftracker.app" (a competitor's
 * domain) as the canonical/OG URL instead of using the actual Vercel deployment
 * URL. This reached production because no test, CI check, or code review layer
 * verified URLs against the known deployment domain. Every URL in index.html
 * that references our domain must point to the real deployment.
 */

const DEPLOYMENT_DOMAIN = 'spa-rho-sandy.vercel.app'

describe('index.html meta tag regression tests', () => {
  describe('canonical and OG URLs point to actual deployment', () => {
    it('canonical URL uses the real deployment domain', () => {
      const match = html.match(/<link rel="canonical" href="([^"]+)"/)
      expect(match).not.toBeNull()
      expect(match![1]).toContain(DEPLOYMENT_DOMAIN)
    })

    it('og:url uses the real deployment domain', () => {
      const match = html.match(/<meta property="og:url" content="([^"]+)"/)
      expect(match).not.toBeNull()
      expect(match![1]).toContain(DEPLOYMENT_DOMAIN)
    })

    it('og:image uses the real deployment domain', () => {
      const match = html.match(/<meta property="og:image" content="([^"]+)"/)
      expect(match).not.toBeNull()
      expect(match![1]).toContain(DEPLOYMENT_DOMAIN)
    })

    it('twitter:image uses the real deployment domain', () => {
      const match = html.match(/<meta name="twitter:image" content="([^"]+)"/)
      expect(match).not.toBeNull()
      expect(match![1]).toContain(DEPLOYMENT_DOMAIN)
    })
  })

  describe('social preview accessibility and locale metadata', () => {
    it('og:image has descriptive alt text for screen readers on social unfurls', () => {
      const match = html.match(/<meta property="og:image:alt" content="([^"]+)"/)
      expect(match).not.toBeNull()
      expect(match![1].trim().length).toBeGreaterThan(0)
    })

    it('twitter:image has descriptive alt text for screen readers on social unfurls', () => {
      const match = html.match(/<meta name="twitter:image:alt" content="([^"]+)"/)
      expect(match).not.toBeNull()
      expect(match![1].trim().length).toBeGreaterThan(0)
    })

    it('og:locale gives crawlers an explicit language signal', () => {
      const match = html.match(/<meta property="og:locale" content="([^"]+)"/)
      expect(match).not.toBeNull()
      expect(match![1]).toBe('en_US')
    })
  })

  describe('viewport meta keeps iOS-critical keys (LIFT-832)', () => {
    const viewport =
      html.match(/<meta name="viewport" content="([^"]+)"/)?.[1] ?? ''

    it('declares a viewport meta tag', () => {
      expect(viewport.length).toBeGreaterThan(0)
    })

    it('keeps viewport-fit=cover so safe-area insets resolve under the notch', () => {
      expect(viewport).toContain('viewport-fit=cover')
    })

    it('sets interactive-widget=resizes-content so the soft keyboard resizes the layout viewport in step with the visual viewport (iOS Safari tab keyboard / #830 desync)', () => {
      expect(viewport).toContain('interactive-widget=resizes-content')
    })
  })

  describe('no references to domains we do not own', () => {
    it('does not reference liftracker.app (competitor domain)', () => {
      expect(html).not.toContain('liftracker.app')
    })

    it('all absolute URLs in meta tags use HTTPS', () => {
      const urls = html.match(/(?:href|content|src)="(http:\/\/[^"]+)"/g)
      expect(urls).toBeNull()
    })
  })
})
