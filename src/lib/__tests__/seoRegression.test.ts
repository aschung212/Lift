/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import {
  DEPLOYMENT_DOMAIN,
  readPublicFile,
  publicFileExists,
  expectNoUnownedDomains,
} from './staticArtifacts'

/**
 * Regression tests for the STRUCTURE of the SEO files: robots.txt and
 * sitemap.xml. These files live in public/ and are served at the root.
 *
 * Scope split (LIFT-1012): this suite owns structural validity + the
 * no-unowned-domain safety net; the exact canonical values (the literal
 * Sitemap: line and root <loc>) are pinned once in seoStaticFiles.test.ts.
 * Both share one cached reader and one domain source (./staticArtifacts) so
 * the two suites can no longer drift apart.
 */

describe('SEO file regression tests', () => {
  describe('robots.txt', () => {
    it('exists in public/', () => {
      expect(publicFileExists('robots.txt')).toBe(true)
    })

    it('allows all user agents', () => {
      const content = readPublicFile('robots.txt')
      expect(content).toContain('User-agent: *')
      expect(content).toContain('Allow: /')
    })

    it('references sitemap with the real deployment domain', () => {
      const content = readPublicFile('robots.txt')
      const sitemapLine = content.match(/Sitemap:\s*(\S+)/)
      expect(sitemapLine).not.toBeNull()
      expect(sitemapLine![1]).toContain(DEPLOYMENT_DOMAIN)
      expect(sitemapLine![1]).toMatch(/^https:\/\//)
      expect(sitemapLine![1]).toContain('sitemap.xml')
    })

    it('does not reference any domain we do not own', () => {
      expectNoUnownedDomains(readPublicFile('robots.txt'))
    })
  })

  describe('sitemap.xml', () => {
    it('exists in public/', () => {
      expect(publicFileExists('sitemap.xml')).toBe(true)
    })

    it('is valid XML with urlset namespace', () => {
      const content = readPublicFile('sitemap.xml')
      expect(content).toContain('<?xml version="1.0"')
      expect(content).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"')
    })

    it('contains at least one <loc> entry', () => {
      const content = readPublicFile('sitemap.xml')
      const locs = content.match(/<loc>[^<]+<\/loc>/g)
      expect(locs).not.toBeNull()
      expect(locs!.length).toBeGreaterThanOrEqual(1)
    })

    it('all <loc> entries use the real deployment domain with HTTPS', () => {
      const content = readPublicFile('sitemap.xml')
      const locs = content.match(/<loc>([^<]+)<\/loc>/g) || []
      for (const loc of locs) {
        const url = loc.replace(/<\/?loc>/g, '')
        expect(url).toContain(DEPLOYMENT_DOMAIN)
        expect(url).toMatch(/^https:\/\//)
      }
    })

    it('does not reference any domain we do not own', () => {
      expectNoUnownedDomains(readPublicFile('sitemap.xml'))
    })
  })
})
