/// <reference types="node" />
/**
 * AI Coach egress leak tripwire (LIFT-850).
 *
 * The Anthropic key and the raw `api.anthropic.com` endpoint live ONLY in the
 * server-side proxy (`api/coach.ts`), which is never bundled into the client. The
 * entire trust boundary of the feature depends on that host + key staying out of:
 *   1. the client bundle (source + built `dist/`), and
 *   2. the CSP `connect-src` allowlist (a provider host there would both signal a
 *      leak and, worse, permit a direct browser->provider call).
 *
 * This test fails loudly if a refactor ever pulls the provider into the client or
 * loosens the CSP to reach an LLM provider directly. It is the "leak tripwire"
 * called for in LIFT-850 and the guardrail recommended in docs/ai-coach.md.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

const ROOT = resolve(__dirname, '../../../')

/**
 * Direct LLM-provider API hosts. Any of these appearing in client-shipped code or
 * on connect-src means the request path is bypassing our server proxy.
 */
const PROVIDER_HOSTS = [
  'api.anthropic.com',
  'api.openai.com',
  'generativelanguage.googleapis.com',
  'api.mistral.ai',
  'api.cohere.ai',
  'api.groq.com',
  'openrouter.ai',
  'api.x.ai',
]

/** Secret-bearing tokens that must never reach anything the client can read. */
const SECRET_TOKENS = ['ANTHROPIC_API_KEY', 'x-api-key']

const CODE_EXTS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.vue', '.html']

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, out)
    } else if (CODE_EXTS.some((ext) => entry.name.endsWith(ext))) {
      out.push(full)
    }
  }
  return out
}

function scan(dir: string): { file: string; needle: string }[] {
  const hits: { file: string; needle: string }[] = []
  for (const file of walk(dir)) {
    const text = readFileSync(file, 'utf8')
    for (const needle of [...PROVIDER_HOSTS, ...SECRET_TOKENS]) {
      if (text.includes(needle)) hits.push({ file, needle })
    }
  }
  return hits
}

describe('AI Coach egress leak tripwire (LIFT-850)', () => {
  describe('client source never references an LLM provider or its key', () => {
    it('src/ (the bundled client) is clean', () => {
      // api/ is deliberately excluded: it is the server-only proxy where the key
      // and provider host legitimately live and is never shipped to the client.
      const hits = scan(resolve(ROOT, 'src'))
      expect(hits).toEqual([])
    })

    it('index.html is clean', () => {
      const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8')
      for (const needle of [...PROVIDER_HOSTS, ...SECRET_TOKENS]) {
        expect(html).not.toContain(needle)
      }
    })
  })

  describe('built bundle never references an LLM provider or its key', () => {
    // dist/ only exists after a build; the build-and-test CI job produces it. When
    // absent (fast unit-only runs) the source scan above is the standing guard.
    const distDir = resolve(ROOT, 'dist')
    it.skipIf(!existsSync(distDir))('dist/ is clean', () => {
      const hits = scan(distDir)
      expect(hits).toEqual([])
    })
  })

  describe('CSP connect-src never permits a direct provider call', () => {
    const vercelJson = readFileSync(resolve(ROOT, 'vercel.json'), 'utf8')
    const config = JSON.parse(vercelJson) as {
      headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }>
    }
    const globalRule = (config.headers || []).find((r) => r.source === '/(.*)')
    const csp = globalRule?.headers.find((h) => h.key === 'Content-Security-Policy')?.value ?? ''
    const connectSrc = /connect-src\s+([^;]+)/.exec(csp)?.[1] ?? ''

    it('has a connect-src directive to check', () => {
      expect(connectSrc).not.toBe('')
    })

    it.each(PROVIDER_HOSTS)('does not allow %s', (host) => {
      expect(connectSrc).not.toContain(host)
    })

    it('does not mention any provider brand anywhere in the CSP', () => {
      expect(csp.toLowerCase()).not.toContain('anthropic')
      expect(csp.toLowerCase()).not.toContain('openai')
    })
  })
})
