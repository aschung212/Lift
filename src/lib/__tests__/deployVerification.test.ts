import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'

// LIFT-1167: the "✅ Deployed to production" Slack message must not fire off
// green CI alone — CI passing does not prove Vercel promoted the commit (a
// failed Vercel build leaves the PREVIOUS deploy live, answering 200). A
// dedicated `smoke-test-production` job polls the prod URL until it serves
// THIS commit's version.json, and notify-deploy depends on it. This test pins
// that wiring so the guarantee can't silently regress in a workflow edit.

const ROOT = resolve(__dirname, '../../..')
const CI_PATH = resolve(ROOT, '.github/workflows/ci.yml')

interface Step {
  name?: string
  uses?: string
  run?: string
  env?: Record<string, string>
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

describe('production deploy verification (LIFT-1167)', () => {
  const jobs = loadJobs()

  it('defines a smoke-test-production job', () => {
    expect(jobs['smoke-test-production']).toBeDefined()
  })

  it('smoke test only runs on green master pushes', () => {
    const cond = jobs['smoke-test-production']?.if ?? ''
    expect(cond).toContain('success()')
    expect(cond).toContain("github.ref == 'refs/heads/master'")
    expect(cond).toContain("github.event_name == 'push'")
  })

  it('smoke test verifies the deployed commit against github.sha', () => {
    const step = (jobs['smoke-test-production']?.steps ?? []).find((s) =>
      /version|verify/i.test(s.name ?? ''),
    )
    expect(step, 'expected a verification step').toBeDefined()
    // The pushed commit SHA is passed via env (not inline ${{ }}), mirroring
    // the notify jobs' script-injection guard.
    expect(step?.env?.EXPECTED_SHA).toBe('${{ github.sha }}')
    const run = step?.run ?? ''
    // It reads the domain from CLAUDE.md (never hardcodes a URL — SEV1 rule)…
    expect(run).toContain('CLAUDE.md')
    // …polls version.json and compares the deployed SHA to the expected one…
    expect(run).toContain('version.json')
    expect(run).toContain('EXPECTED_SHA')
    // …and fails when the deploy never reports this commit.
    expect(run).toContain('::error::')
  })

  it('notify-deploy depends on the smoke test (no false "Deployed" message)', () => {
    expect(needsOf(jobs['notify-deploy'])).toContain('smoke-test-production')
  })

  it('notify-failure depends on the smoke test (a failed deploy is reported)', () => {
    expect(needsOf(jobs['notify-failure'])).toContain('smoke-test-production')
  })

  it('the success message reflects that the deploy was verified live', () => {
    const step = (jobs['notify-deploy']?.steps ?? []).find((s) =>
      /notify slack/i.test(s.name ?? ''),
    )
    expect(step?.run ?? '').toContain('verified live')
  })
})
