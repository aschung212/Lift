import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Guards LIFT-1167: `notify-deploy` used to post "✅ Deployed to production"
// whenever the CI graph was green — but Vercel deploys via its own git
// integration, entirely outside GitHub Actions, so a green graph does NOT
// mean the live site is serving the new build. A failed/rolled-back Vercel
// build, a broken bundle, or an SSO/edge misconfig would still trip the
// success message. The `smoke-test-production` job curls the real prod domain
// and asserts HTTP 200 + the app-shell marker before Slack claims success,
// and BOTH notify jobs gate on it. This test fails the build if that safety
// net is removed or unwired.

const ROOT = resolve(__dirname, '../../..')
const CI = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8')

/**
 * Extract the raw text of a single named job block from the workflow.
 * Job keys sit at 2-space indentation under `jobs:`; the block runs until
 * the next 2-space-indented mapping key (the next job) or EOF.
 */
function jobBlock(yaml: string, job: string): string {
  const lines = yaml.split('\n')
  const start = lines.findIndex((l) => new RegExp(`^ {2}${job}:\\s*$`).test(l))
  if (start === -1) return ''
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i])) {
      end = i
      break
    }
  }
  return lines.slice(start, end).join('\n')
}

/** Parse the `needs:` array (inline `[a, b, c]` form) for a job block. */
function jobNeeds(block: string): string[] {
  const m = block.match(/needs:\s*\[([^\]]*)\]/)
  if (!m) return []
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

describe('CI production smoke test before Slack success (LIFT-1167)', () => {
  const smoke = jobBlock(CI, 'smoke-test-production')

  it('defines a smoke-test-production job', () => {
    expect(smoke).not.toBe('')
  })

  it('only runs on push to master', () => {
    expect(smoke).toMatch(/if:\s*github\.event_name == 'push' && github\.ref == 'refs\/heads\/master'/)
  })

  it('reads the prod domain from CLAUDE.md instead of hardcoding it', () => {
    // The SEV1 anti-hallucination rule: the domain must be sourced from the
    // authoritative file, never baked into the workflow.
    expect(smoke).toMatch(/grep[^\n]*CLAUDE\.md/)
    expect(smoke).not.toMatch(/spa-rho-sandy\.vercel\.app/)
  })

  it('asserts an HTTP 200 response', () => {
    expect(smoke).toMatch(/"200"/)
  })

  it('asserts the app-shell marker is present in the served HTML', () => {
    expect(smoke).toContain('<div id="app">')
  })

  it('retries to absorb the async Vercel build that lags the CI graph', () => {
    expect(smoke).toMatch(/for i in \$\(seq 1/)
    expect(smoke).toMatch(/sleep/)
  })

  it('gates notify-deploy on the smoke test', () => {
    const needs = jobNeeds(jobBlock(CI, 'notify-deploy'))
    expect(needs).toContain('smoke-test-production')
  })

  it('gates notify-failure on the smoke test so a failed deploy is reported', () => {
    const needs = jobNeeds(jobBlock(CI, 'notify-failure'))
    expect(needs).toContain('smoke-test-production')
  })
})
