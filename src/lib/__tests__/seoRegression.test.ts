/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

/**
 * Regression tests for SEO files: robots.txt and sitemap.xml.
 *
 * These files live in public/ and are served at the root. The sitemap URL
 * in robots.txt and the <loc> in sitemap.xml must reference the real
 * deployment domain — not a hallucinated or competitor domain.
 */

const publicDir = resolve(__dirname, '../../../public')
const rootDir = resolve(__dirname, '../../..')
const DEPLOYMENT_DOMAIN = 'spa-rho-sandy.vercel.app'

describe('SEO file regression tests', () => {
  describe('robots.txt', () => {
    const robotsPath = resolve(publicDir, 'robots.txt')

    it('exists in public/', () => {
      expect(existsSync(robotsPath)).toBe(true)
    })

    it('allows all user agents', () => {
      const content = readFileSync(robotsPath, 'utf-8')
      expect(content).toContain('User-agent: *')
      expect(content).toContain('Allow: /')
    })

    it('references sitemap with the real deployment domain', () => {
      const content = readFileSync(robotsPath, 'utf-8')
      const sitemapLine = content.match(/Sitemap:\s*(\S+)/)
      expect(sitemapLine).not.toBeNull()
      expect(sitemapLine![1]).toContain(DEPLOYMENT_DOMAIN)
      expect(sitemapLine![1]).toMatch(/^https:\/\//)
      expect(sitemapLine![1]).toContain('sitemap.xml')
    })

    it('does not reference liftracker.app (competitor domain)', () => {
      const content = readFileSync(robotsPath, 'utf-8')
      expect(content).not.toContain('liftracker.app')
    })
  })

  describe('sitemap.xml', () => {
    const sitemapPath = resolve(publicDir, 'sitemap.xml')

    it('exists in public/', () => {
      expect(existsSync(sitemapPath)).toBe(true)
    })

    it('is valid XML with urlset namespace', () => {
      const content = readFileSync(sitemapPath, 'utf-8')
      expect(content).toContain('<?xml version="1.0"')
      expect(content).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"')
    })

    it('contains at least one <loc> entry', () => {
      const content = readFileSync(sitemapPath, 'utf-8')
      const locs = content.match(/<loc>[^<]+<\/loc>/g)
      expect(locs).not.toBeNull()
      expect(locs!.length).toBeGreaterThanOrEqual(1)
    })

    it('all <loc> entries use the real deployment domain with HTTPS', () => {
      const content = readFileSync(sitemapPath, 'utf-8')
      const locs = content.match(/<loc>([^<]+)<\/loc>/g) || []
      for (const loc of locs) {
        const url = loc.replace(/<\/?loc>/g, '')
        expect(url).toContain(DEPLOYMENT_DOMAIN)
        expect(url).toMatch(/^https:\/\//)
      }
    })

    it('does not reference liftracker.app (competitor domain)', () => {
      const content = readFileSync(sitemapPath, 'utf-8')
      expect(content).not.toContain('liftracker.app')
    })
  })

  /**
   * The homepage advertises its own URL in three self-referential places:
   * the <link rel="canonical">, the og:url meta, and the sitemap <loc>.
   * Search engines treat a trailing-slash and non-trailing-slash form as the
   * same page, but inconsistent self-referential signals dilute canonicalization
   * and can split link equity (LIFT-1000). These three must be byte-identical.
   */
  describe('self-referential canonical URL consistency (LIFT-1000)', () => {
    const html = readFileSync(resolve(rootDir, 'index.html'), 'utf-8')
    const sitemap = readFileSync(resolve(publicDir, 'sitemap.xml'), 'utf-8')

    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1]
    const ogUrl = html.match(/<meta property="og:url" content="([^"]+)"/)?.[1]
    const sitemapLoc = sitemap.match(/<loc>([^<]+)<\/loc>/)?.[1]

    it('canonical, og:url, and sitemap <loc> are all present', () => {
      expect(canonical).toBeDefined()
      expect(ogUrl).toBeDefined()
      expect(sitemapLoc).toBeDefined()
    })

    it('canonical and og:url are byte-identical', () => {
      expect(ogUrl).toBe(canonical)
    })

    it('sitemap <loc> is byte-identical to the canonical URL', () => {
      expect(sitemapLoc).toBe(canonical)
    })
  })
})
