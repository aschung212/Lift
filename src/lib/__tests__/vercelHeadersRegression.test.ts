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

interface HeaderRule {
  source: string
  headers: Array<{ key: string; value: string }>
}

interface VercelConfig {
  headers?: HeaderRule[]
}

function loadVercelConfig(): VercelConfig {
  const path = resolve(__dirname, '../../../vercel.json')
  const raw = readFileSync(path, 'utf8')
  return JSON.parse(raw) as VercelConfig
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

    it('restricts script-src to self (+ unsafe-inline for the index.html theme script)', () => {
      expect(csp).toMatch(/script-src\s+[^;]*'self'/)
      // We still allow 'unsafe-inline' for the splash theme bootstrap
      // script — remove this branch once we ship a nonce/hash strategy.
      expect(csp).toMatch(/script-src\s+[^;]*'unsafe-inline'/)
      // Explicitly ensure no third-party CDN is allow-listed
      expect(csp).not.toMatch(/script-src[^;]*https?:\/\//)
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
})
