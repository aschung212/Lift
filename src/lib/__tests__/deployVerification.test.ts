import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// LIFT-1167: the "✅ Deployed to production" Slack notification used to fire on
// a green CI graph alone — but Vercel deploys via its own git integration
// OUTSIDE GitHub Actions, so CI passing never proved the site was actually
// live. A dedicated `verify-deploy` job now smoke-tests the real prod domain
// (HTTP 200 + app-shell marker) and BOTH notify jobs gate on it, so a
// failed/rolled-back Vercel deploy routes to notify-failure instead of a false
// success. These structural tests keep that gate wired.
const ROOT = resolve(__dirname, '../../..')
const CI_PATH = resolve(ROOT, '.github/workflows/ci.yml')
const ci = readFileSync(CI_PATH, 'utf8')

describe('deploy verification gate (LIFT-1167)', () => {
  it('defines a verify-deploy job', () => {
    expect(ci).toMatch(/^ {2}verify-deploy:$/m)
  })

  it('verify-deploy only runs on master pushes', () => {
    // Scope the assertion to the verify-deploy job body.
    const job = ci.slice(ci.indexOf('  verify-deploy:'), ci.indexOf('  notify-deploy:'))
    expect(job).toContain("if: github.event_name == 'push' && github.ref == 'refs/heads/master'")
  })

  it('verify-deploy asserts HTTP 200 and an app-shell marker', () => {
    const job = ci.slice(ci.indexOf('  verify-deploy:'), ci.indexOf('  notify-deploy:'))
    expect(job).toContain('%{http_code}')
    expect(job).toContain('"200"')
    // The marker is the index.html <title>, proving the real app was served.
    expect(job).toContain('EXPECTED_MARKER')
    expect(job).toContain('Lift — Workout Tracker')
    expect(job).toContain('grep -qF "$EXPECTED_MARKER"')
  })

  it('reads the prod domain from CLAUDE.md instead of hardcoding it', () => {
    const job = ci.slice(ci.indexOf('  verify-deploy:'), ci.indexOf('  notify-deploy:'))
    expect(job).toContain('CLAUDE.md')
    // SEV1 rule: the deployment domain must never be fabricated/hardcoded in the
    // workflow — it comes from the single source of truth (CLAUDE.md **Live:**).
    expect(ci).not.toContain('spa-rho-sandy')
  })

  it('the verify-deploy marker matches the real index.html <title>', () => {
    const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8')
    const match = html.match(/<title>([^<]+)<\/title>/)
    expect(match).not.toBeNull()
    const title = match![1].trim()
    // If someone renames the app title, this forces the smoke-test marker to
    // be updated in the same change — otherwise verify-deploy would false-fail.
    expect(ci).toContain(title)
  })

  it('notify-deploy gates its success message on verify-deploy', () => {
    const job = ci.slice(ci.indexOf('  notify-deploy:'), ci.indexOf('  notify-failure:'))
    expect(job).toMatch(/needs: \[[^\]]*verify-deploy[^\]]*\]/)
    expect(job).toContain('if: success()')
  })

  it('notify-failure fires when verify-deploy fails', () => {
    const job = ci.slice(ci.indexOf('  notify-failure:'))
    expect(job).toMatch(/needs: \[[^\]]*verify-deploy[^\]]*\]/)
    expect(job).toContain('if: failure()')
  })
})
