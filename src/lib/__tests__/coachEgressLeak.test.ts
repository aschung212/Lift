/**
 * AI Coach egress leak tripwire (LIFT-850).
 *
 * The Anthropic API key and provider origin are the entire trust boundary for
 * the AI Coach feature. They live ONLY in the server-side function under `api/`
 * (which is never bundled into the client), and the browser/native client only
 * ever talks to our own same-origin proxy (`/api/coach`).
 *
 * This test fails loudly if any of the following leak into the CLIENT surface:
 *   - the Anthropic origin (`api.anthropic.com`) or any LLM-provider origin,
 *   - the provider key name (`ANTHROPIC_API_KEY`) or the `x-api-key` header,
 * anywhere under `src/` (which compiles to `dist/`), or into the CSP
 * `connect-src` in vercel.json.
 *
 * Why scan source, not `dist/`? `src/` is the sole input to the client bundle
 * and doesn't require a build step, so this stays fast and CI-friendly while
 * proving the same invariant: a provider secret/origin can only reach the
 * shipped bundle by first appearing in `src/`. `api/coach.ts` is intentionally
 * NOT scanned — that's the server function where these values belong.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const SRC_DIR = resolve(__dirname, '../..')

/** Recursively collect every source file under `src/` (client bundle input). */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...collectSourceFiles(full))
    } else if (/\.(ts|tsx|vue|js|mjs|cjs)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/**
 * Patterns that must never appear in client source. This test file itself and
 * its sibling regression tests reference these strings to assert their absence,
 * so the scan excludes `__tests__` directories.
 */
const FORBIDDEN: Array<{ label: string; pattern: RegExp }> = [
  { label: 'the Anthropic API origin', pattern: /api\.anthropic\.com/i },
  { label: 'any anthropic.com origin', pattern: /https?:\/\/[^\s'"]*anthropic\.com/i },
  { label: 'any openai.com origin', pattern: /https?:\/\/[^\s'"]*openai\.com/i },
  { label: 'the Anthropic key env name', pattern: /ANTHROPIC_API_KEY/ },
  { label: 'the provider key header', pattern: /['"]x-api-key['"]/i },
]

describe('AI Coach egress leak tripwire (LIFT-850)', () => {
  const sourceFiles = collectSourceFiles(SRC_DIR).filter(
    (f) => !f.includes('__tests__'),
  )

  it('scans a non-trivial number of client source files', () => {
    // Guards against a broken glob silently passing the leak assertions.
    expect(sourceFiles.length).toBeGreaterThan(50)
  })

  it.each(FORBIDDEN)('never exposes $label in client source', ({ pattern }) => {
    const offenders: string[] = []
    for (const file of sourceFiles) {
      if (pattern.test(readFileSync(file, 'utf-8'))) {
        offenders.push(file.slice(SRC_DIR.length + 1))
      }
    }
    expect(offenders).toEqual([])
  })
})
