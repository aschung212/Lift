/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { DEPLOYMENT_ORIGIN, readPublicFile } from './staticArtifacts'

/**
 * Exact-value pins for the shipped SEO artifacts (robots.txt, sitemap.xml).
 *
 * Scope split (LIFT-1012): this suite owns ONLY the literal canonical strings
 * that must appear verbatim. Structural validity (namespace, HTTPS-only,
 * exists, no-unowned-domain) lives in seoRegression.test.ts so no assertion is
 * duplicated across the two suites. Both read through the shared cached reader
 * and derive the domain from ./staticArtifacts — the single source of truth.
 */
describe('SEO static-file canonical values', () => {
  it('robots.txt declares the canonical sitemap URL verbatim', () => {
    expect(readPublicFile('robots.txt')).toContain(
      `Sitemap: ${DEPLOYMENT_ORIGIN}/sitemap.xml`
    )
  })

  it('sitemap.xml pins the root URL verbatim', () => {
    expect(readPublicFile('sitemap.xml')).toContain(`<loc>${DEPLOYMENT_ORIGIN}/</loc>`)
  })
})
