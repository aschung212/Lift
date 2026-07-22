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

  describe('crawlable content fallback for non-JS indexers (LIFT-998)', () => {
    const noscript = html.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1] ?? ''

    it('ships a <noscript> block so non-JS crawlers see indexable content', () => {
      expect(noscript.trim().length).toBeGreaterThan(0)
    })

    it('exposes a single crawlable <h1> naming the app', () => {
      const h1 = noscript.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)
      expect(h1).not.toBeNull()
      expect(h1![1]).toContain('Lift')
      // Only the no-JS fallback carries a static heading; the live app renders
      // its own headings client-side, so the raw shell must not double up.
      const allH1s = html.match(/<h1[^>]*>/g) ?? []
      expect(allH1s.length).toBe(1)
    })

    it('describes core features so there is real first-pass body copy', () => {
      expect(noscript).toMatch(/1RM/)
      expect(noscript.toLowerCase()).toContain('workout')
    })

    it('hides the splash when JavaScript is disabled so no-JS users are not stuck', () => {
      expect(noscript).toMatch(/#splash\s*\{[^}]*display:\s*none/)
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
