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

  describe('SoftwareApplication JSON-LD structured data', () => {
    const match = html.match(
      /<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/
    )

    it('includes a JSON-LD structured-data block', () => {
      expect(match).not.toBeNull()
    })

    it('is valid, parseable JSON', () => {
      expect(() => JSON.parse(match![1])).not.toThrow()
    })

    it('declares the schema.org SoftwareApplication type', () => {
      const data = JSON.parse(match![1])
      expect(data['@context']).toBe('https://schema.org')
      expect(data['@type']).toBe('SoftwareApplication')
    })

    it('pins name and url to the real deployment domain', () => {
      const data = JSON.parse(match![1])
      expect(data.name).toBe('Lift')
      expect(data.url).toContain(DEPLOYMENT_DOMAIN)
    })

    it('marks the app as free via a price:0 offer', () => {
      const data = JSON.parse(match![1])
      expect(data.offers.price).toBe('0')
      expect(data.offers.priceCurrency).toBe('USD')
    })

    it('does not fabricate an aggregateRating', () => {
      const data = JSON.parse(match![1])
      expect(data.aggregateRating).toBeUndefined()
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
