/**
 * Regression tests for the SPA fallback rewrite in vercel.json (#1155).
 *
 * 2026-08-17: the installed iOS PWA hit the "A problem repeatedly occurred"
 * kill screen. Contributing defect: the catch-all rewrite
 * `/(.*) → /index.html` also matched `/assets/*`, so a request for a hashed
 * chunk that no longer exists on the CDN returned HTTP 200 with the HTML
 * shell instead of 404 (verified live: `/assets/index-DOESNOTEXIST.js` →
 * 200 text/html). A stale precached index.html in an installed PWA then
 * loads HTML as a JS module and hard-fails before Vue mounts — and nothing
 * can recover, because the app never boots.
 *
 * The rewrite must MISS real static/function prefixes so a missing file 404s
 * honestly, while keeping the SPA fallback for genuine navigations. (Vercel
 * checks the filesystem before rewrites, so files that DO exist are served
 * either way — the rewrite only ever sees the misses.)
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

interface RewriteRule {
  source: string
  destination: string
}

function loadRewrites(): RewriteRule[] {
  const path = resolve(__dirname, '../../../vercel.json')
  const raw = readFileSync(path, 'utf8')
  return (JSON.parse(raw) as { rewrites?: RewriteRule[] }).rewrites ?? []
}

/**
 * Vercel compiles `source` with path-to-regexp (case-insensitively). For the
 * single custom-regex-segment form `/(<pattern>)` used here, that is
 * equivalent to anchoring the inner pattern between `^/` and `$`. This
 * helper only understands that shape — if the rewrite is restructured, it
 * throws so the test fails loudly instead of asserting against garbage.
 */
function sourceToRegex(source: string): RegExp {
  if (!source.startsWith('/(') || !source.endsWith(')')) {
    throw new Error(
      `rewrite source is not the /(<regex>) shape this test understands: ${source}`,
    )
  }
  return new RegExp(`^/(${source.slice(2, -1)})$`, 'i')
}

describe('vercel.json SPA fallback rewrite scoping (#1155)', () => {
  const rewrites = loadRewrites()
  const spaFallbacks = rewrites.filter(r => r.destination === '/index.html')

  it('has exactly one SPA fallback rewrite to /index.html', () => {
    expect(spaFallbacks).toHaveLength(1)
  })

  const matcher = sourceToRegex(spaFallbacks[0].source)

  it('sourceToRegex would catch the original defect (self-test)', () => {
    // Non-vacuity: prove the harness flags the bare catch-all this test
    // exists to keep out. If the equivalence helper ever went soft, every
    // "does not match" assertion below could pass for the wrong reason.
    const bareCatchAll = sourceToRegex('/(.*)')
    expect(bareCatchAll.test('/assets/index-DOESNOTEXIST.js')).toBe(true)
  })

  it('keeps the SPA fallback for genuine navigations', () => {
    expect(matcher.test('/')).toBe(true)
    expect(matcher.test('/some-route')).toBe(true)
    expect(matcher.test('/some/nested/route')).toBe(true)
  })

  it('misses /assets/* so a stale hashed chunk 404s instead of returning the HTML shell', () => {
    // The live-verified repro from the 2026-08-17 incident:
    expect(matcher.test('/assets/index-DOESNOTEXIST.js')).toBe(false)
    expect(matcher.test('/assets/index-Ck2f9Q1x.css')).toBe(false)
    expect(matcher.test('/assets/nested/chunk-abc123.js')).toBe(false)
  })

  it('misses /api/* so a missing function 404s instead of returning HTML with 200', () => {
    expect(matcher.test('/api/nonexistent')).toBe(false)
    expect(matcher.test('/api/coach')).toBe(false)
  })

  it('misses the service-worker scripts so a removed SW can actually die', () => {
    // Serving the HTML shell at /sw.js pins a zombie service worker forever:
    // the update fetch fails the MIME check and the old SW is retained. A
    // real 404 is the spec'd kill switch — the browser unregisters the SW.
    expect(matcher.test('/sw.js')).toBe(false)
    expect(matcher.test('/workbox-4723e66c.js')).toBe(false)
    expect(matcher.test('/sw-offline-handler.js')).toBe(false)
  })

  it('misses the other static build prefixes', () => {
    expect(matcher.test('/manifest.webmanifest')).toBe(false)
    expect(matcher.test('/launch/apple-launch-1170x2532.png')).toBe(false)
  })

  it('still falls back for lookalike paths that are genuinely routes, not files', () => {
    // The exclusions are anchored prefixes/filenames, not loose substrings —
    // a route that merely resembles them must keep the SPA fallback.
    expect(matcher.test('/assets-overview')).toBe(true)
    expect(matcher.test('/apidocs')).toBe(true)
    expect(matcher.test('/sw.js-changelog')).toBe(true)
  })
})
