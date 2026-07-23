/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { DEPLOYMENT_DOMAIN, readIndexHtml, expectNoUnownedDomains } from './staticArtifacts'

const html = readIndexHtml()

/**
 * Regression tests for index.html meta tags.
 *
 * Backstory: The overnight builder hallucinated "liftracker.app" (a competitor's
 * domain) as the canonical/OG URL instead of using the actual Vercel deployment
 * URL. This reached production because no test, CI check, or code review layer
 * verified URLs against the known deployment domain. Every URL in index.html
 * that references our domain must point to the real deployment.
 *
 * The deployment domain and the unowned-domain deny list come from the shared
 * ./staticArtifacts fixture (LIFT-1012) so this suite can no longer drift from
 * the SEO/manifest guards that pin the same values.
 */

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

  describe('no references to domains we do not own', () => {
    it('does not reference any domain we do not own', () => {
      expectNoUnownedDomains(html)
    })

    it('all absolute URLs in meta tags use HTTPS', () => {
      const urls = html.match(/(?:href|content|src)="(http:\/\/[^"]+)"/g)
      expect(urls).toBeNull()
    })
  })
})
