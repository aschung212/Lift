/**
 * Regression tests for the security headers shipped via vercel.json.
 *
 * These pin the presence + key directives of each header so nobody can
 * accidentally loosen or drop them. Tightening (e.g. removing
 * `'unsafe-inline'` once we ship nonces) is explicitly fine — update the
 * test in the same PR as the policy change.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

interface HeaderRule {
  source: string
  headers: Array<{ key: string; value: string }>
}

interface RedirectRule {
  source: string
  destination: string
  statusCode?: number
}

interface VercelConfig {
  headers?: HeaderRule[]
  redirects?: RedirectRule[]
}

function loadVercelConfig(): VercelConfig {
  const path = resolve(__dirname, '../../../vercel.json')
  const raw = readFileSync(path, 'utf8')
  return JSON.parse(raw) as VercelConfig
}

/**
 * Compute the CSP `'sha256-…'` source-expression for every attribute-less
 * inline `<script>` block in index.html, exactly the way a browser does:
 * SHA-256 over the raw UTF-8 bytes between the tags, base64-encoded. Vite
 * emits these inline blocks verbatim (it only rewrites the external
 * `type="module"` entry), so the source hash matches what ships.
 */
function inlineScriptHashes(): string[] {
  const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf8')
  const matches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  return matches.map(
    m => `sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}`
  )
}

function findGlobalHeaderRule(config: VercelConfig): HeaderRule {
  const rule = (config.headers || []).find(r => r.source === '/(.*)')
  if (!rule) throw new Error('expected a global /(.*) header rule in vercel.json')
  return rule
}

function getHeader(rule: HeaderRule, key: string): string | undefined {
  return rule.headers.find(h => h.key === key)?.value
}

describe('vercel.json security headers', () => {
  const config = loadVercelConfig()
  const globalRule = findGlobalHeaderRule(config)

  describe('baseline headers still present', () => {
    it.each([
      ['Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload'],
      ['X-Content-Type-Options', 'nosniff'],
      ['X-Frame-Options', 'DENY'],
      ['Referrer-Policy', 'strict-origin-when-cross-origin'],
    ])('has %s: %s', (key, expected) => {
      expect(getHeader(globalRule, key)).toBe(expected)
    })

    it('has Permissions-Policy locking down camera/mic/geolocation', () => {
      const v = getHeader(globalRule, 'Permissions-Policy')
      expect(v).toContain('camera=()')
      expect(v).toContain('microphone=()')
      expect(v).toContain('geolocation=()')
    })
  })

  describe('Content-Security-Policy', () => {
    const csp = getHeader(globalRule, 'Content-Security-Policy') ?? ''

    it('is present', () => {
      expect(csp).not.toBe('')
    })

    /**
     * `default-src 'self'` is the fallback for unspecified directives
     * and is the single most important CSP setting. Without it, any
     * directive we forget to enumerate silently falls back to `*`.
     */
    it("falls back to 'self' via default-src", () => {
      expect(csp).toMatch(/default-src\s+'self'/)
    })

    it('restricts script-src to self + a hash of the inline theme bootstrap (no unsafe-inline)', () => {
      const scriptSrc = csp.match(/script-src\s+([^;]*)/)?.[1] ?? ''
      expect(scriptSrc).toMatch(/'self'/)
      // 'unsafe-inline' negates almost all script-XSS protection (LIFT-809).
      // The single static inline script (index.html theme bootstrap) is
      // allow-listed by its SHA-256 hash instead.
      expect(scriptSrc).not.toContain("'unsafe-inline'")
      // Explicitly ensure no third-party CDN is allow-listed
      expect(scriptSrc).not.toMatch(/https?:\/\//)
    })

    /**
     * Pins the inline-script hash to the actual bytes of index.html. If the
     * theme bootstrap script changes without vercel.json being updated, its
     * hash no longer appears in the CSP and the script is blocked at runtime —
     * this test fails loudly in CI instead of shipping a broken page.
     */
    it('allow-lists every inline index.html script by its current SHA-256 hash', () => {
      const hashes = inlineScriptHashes()
      // Guard against a future refactor that adds/removes inline scripts
      // silently — there must be exactly the one theme bootstrap block.
      expect(hashes).toHaveLength(1)
      const scriptSrc = csp.match(/script-src\s+([^;]*)/)?.[1] ?? ''
      for (const hash of hashes) {
        expect(scriptSrc).toContain(`'${hash}'`)
      }
    })

    it('allows Supabase REST + realtime on connect-src', () => {
      expect(csp).toMatch(/connect-src\s+[^;]*'self'/)
      expect(csp).toContain('https://*.supabase.co')
      expect(csp).toContain('wss://*.supabase.co')
    })

    it('allows Sentry ingest on connect-src', () => {
      expect(csp).toContain('https://*.sentry.io')
      expect(csp).toContain('https://*.ingest.sentry.io')
    })

    it('allows Vercel Analytics on connect-src', () => {
      expect(csp).toContain('https://vitals.vercel-insights.com')
    })

    it('blocks framing (clickjacking defense)', () => {
      expect(csp).toMatch(/frame-ancestors\s+'none'/)
    })

    it('blocks plugin objects', () => {
      expect(csp).toMatch(/object-src\s+'none'/)
    })

    it('pins base-uri + form-action to self', () => {
      expect(csp).toMatch(/base-uri\s+'self'/)
      expect(csp).toMatch(/form-action\s+'self'/)
    })

    it('allows data:/blob: for img-src (inline SVG + canvas blobs)', () => {
      expect(csp).toMatch(/img-src\s+[^;]*'self'/)
      expect(csp).toMatch(/img-src\s+[^;]*data:/)
      expect(csp).toMatch(/img-src\s+[^;]*blob:/)
    })
  })

  describe('source map exposure prevention (LIFT-341)', () => {
    it('does not redirect .map requests with a 404 (leaks bundler info)', () => {
      const mapRedirect = (config.redirects || []).find(
        r => r.source.includes('.map') && r.statusCode === 404
      )
      expect(mapRedirect).toBeUndefined()
    })

    it('does not serve .map files via any redirect rule', () => {
      const mapRedirects = (config.redirects || []).filter(r =>
        r.source.includes('.map')
      )
      expect(mapRedirects).toHaveLength(0)
    })
  })
})
