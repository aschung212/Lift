/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

/**
 * Leak tripwire for the AI Coach (LIFT-850).
 *
 * The whole trust boundary of the coach feature is that the Anthropic key and the
 * provider endpoint live ONLY in the server function (`api/coach.ts`) — never in the
 * client bundle and never on the CSP. If either ever leaks into shipped client code
 * the key is one view-source away from theft and the spend ceiling is meaningless.
 *
 * These assertions are deliberately blunt and string-based (metaRegression-style):
 *   1. No file under `src/` (the bundle's only source) references the Anthropic host.
 *   2. No client code reads an Anthropic/LLM key via a `VITE_`-prefixed env var
 *      (anything VITE_-prefixed is inlined into the public bundle by Vite).
 *   3. The CSP `connect-src` never gains a known LLM-provider origin.
 *   4. When a build exists, the same host check holds for `dist/` directly.
 *
 * The forbidden host is assembled from fragments so this test file does not itself
 * contain the literal string it scans for.
 */

const PROVIDER_HOST = ['api', 'anthropic', 'com'].join('.')

// Known first-party LLM provider hostnames that must never appear on connect-src.
// (We proxy every model call server-side; the client only ever talks to our origin.)
const LLM_PROVIDER_ORIGINS = [
  'anthropic.com',
  'api.openai.com',
  'openai.azure.com',
  'generativelanguage.googleapis.com',
  'api.cohere.ai',
  'api.mistral.ai',
]

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      out.push(...walk(full))
    } else if (entry.isFile()) {
      out.push(full)
    }
  }
  return out
}

function fileMentions(path: string, needle: string): boolean {
  try {
    return readFileSync(path, 'utf8').includes(needle)
  } catch {
    return false
  }
}

describe('AI Coach key/endpoint leak tripwire (LIFT-850)', () => {
  const srcDir = resolve(__dirname, '../..')
  const thisFile = resolve(__filename)

  it('no client source under src/ references the Anthropic API host', () => {
    const offenders = walk(srcDir)
      .filter(p => p !== thisFile)
      .filter(p => fileMentions(p, PROVIDER_HOST))
    expect(offenders).toEqual([])
  })

  it('no client source exposes an LLM key via a VITE_-prefixed env var', () => {
    // Vite inlines every import.meta.env.VITE_* value into the public bundle.
    const pattern = /VITE_[A-Z0-9_]*(ANTHROPIC|OPENAI|LLM|COACH_KEY|API_KEY)/
    const offenders = walk(srcDir)
      .filter(p => p !== thisFile)
      .filter(p => pattern.test(readFileSync(p, 'utf8')))
    expect(offenders).toEqual([])
  })

  it('vercel.json CSP connect-src lists no LLM-provider origin', () => {
    const raw = readFileSync(resolve(__dirname, '../../../vercel.json'), 'utf8')
    const config = JSON.parse(raw) as {
      headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }>
    }
    const globalRule = (config.headers || []).find(r => r.source === '/(.*)')
    const csp = globalRule?.headers.find(h => h.key === 'Content-Security-Policy')?.value ?? ''
    const connectSrc = /connect-src\s+([^;]+)/.exec(csp)?.[1] ?? ''
    for (const origin of LLM_PROVIDER_ORIGINS) {
      expect(connectSrc).not.toContain(origin)
    }
  })

  it('a built bundle (dist/) never references the Anthropic API host', () => {
    const distDir = resolve(__dirname, '../../../dist')
    if (!existsSync(distDir)) return // no build in this run — src/ check above covers it
    const offenders = walk(distDir).filter(p => fileMentions(p, PROVIDER_HOST))
    expect(offenders).toEqual([])
  })
})
