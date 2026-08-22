import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'

// LIFT-1167: Vercel deploys via its own git integration, entirely OUTSIDE
// GitHub Actions. A green CI graph therefore does NOT prove the site is live —
// a failed/rolled-back Vercel build, a broken bundle, or an SSO/edge misconfig
// would still let `notify-deploy` post "✅ Deployed to production". A dedicated
// `verify-deploy` job smoke-tests the real prod domain before Slack claims
// success, and both Slack jobs list it in `needs` so a failed smoke test
// skips the success post and fires the failure post instead.
//
// Parses the real workflow (not a fixture) so the guarantee tracks ci.yml.

const ROOT = resolve(__dirname, '../../..')
const CI_PATH = resolve(ROOT, '.github/workflows/ci.yml')
const SCRIPT_PATH = resolve(ROOT, 'scripts/verify-deploy.sh')

interface Step {
  name?: string
  uses?: string
  run?: string
}

interface Job {
  needs?: string | string[]
  if?: string
  steps?: Step[]
}

function loadJobs(): Record<string, Job> {
  const wf = parse(readFileSync(CI_PATH, 'utf8')) as { jobs?: Record<string, Job> }
  return wf.jobs ?? {}
}

function needsOf(job: Job | undefined): string[] {
  if (!job?.needs) return []
  return Array.isArray(job.needs) ? job.needs : [job.needs]
}

describe('CI production-deploy verification (LIFT-1167)', () => {
  const jobs = loadJobs()

  it('defines a verify-deploy job', () => {
    expect(jobs['verify-deploy']).toBeDefined()
  })

  it('verify-deploy runs the smoke-test script', () => {
    const steps = jobs['verify-deploy']?.steps ?? []
    const runsScript = steps.some(
      (s) => typeof s.run === 'string' && s.run.includes('scripts/verify-deploy.sh')
    )
    expect(
      runsScript,
      'verify-deploy must run scripts/verify-deploy.sh to smoke-test the live prod domain'
    ).toBe(true)
  })

  it('verify-deploy is gated to master pushes (like migrate-db)', () => {
    const cond = jobs['verify-deploy']?.if ?? ''
    expect(cond).toContain("github.event_name == 'push'")
    expect(cond).toContain("github.ref == 'refs/heads/master'")
  })

  it('verify-deploy runs after migrate-db (so the deploy has had time to go live)', () => {
    expect(needsOf(jobs['verify-deploy'])).toContain('migrate-db')
  })

  it('notify-deploy depends on verify-deploy so success is only posted after the smoke test passes', () => {
    expect(needsOf(jobs['notify-deploy'])).toContain('verify-deploy')
  })

  it('notify-failure depends on verify-deploy so a failed smoke test alerts instead of silently posting success', () => {
    expect(needsOf(jobs['notify-failure'])).toContain('verify-deploy')
  })

  describe('verify-deploy.sh', () => {
    it('exists', () => {
      expect(existsSync(SCRIPT_PATH)).toBe(true)
    })

    const script = existsSync(SCRIPT_PATH) ? readFileSync(SCRIPT_PATH, 'utf8') : ''

    it('reads the deployment domain from CLAUDE.md rather than hardcoding it', () => {
      expect(script).toContain('CLAUDE.md')
      // SEV1 rule: never fabricate/duplicate an external identifier. The prod
      // domain must be derived from the single source of truth, never a literal.
      expect(
        /vercel\.app/.test(script),
        'verify-deploy.sh must not hardcode a *.vercel.app domain literal — read it from CLAUDE.md'
      ).toBe(false)
    })

    it('asserts an HTTP 200 status before declaring the deploy live', () => {
      expect(script).toContain('200')
    })

    it('retries to absorb the git-push → Vercel-build race', () => {
      expect(script).toMatch(/MAX_ATTEMPTS/)
    })
  })
})
