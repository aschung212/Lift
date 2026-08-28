import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'

// LIFT-1170: every downstream job restores node_modules from the cache the
// `install` job saved. GitHub's Actions cache can be evicted between jobs
// (10GB/7-day policy), so a `cache/restore` with no recovery path would
// hard-fail the job with no dependencies. Each such job MUST carry a guarded
// `npm ci` fallback so a transient miss self-heals instead of red-Xing the PR.
//
// Parses the real workflow (not a fixture) so the guarantee tracks ci.yml.

const ROOT = resolve(__dirname, '../../..')
const CI_PATH = resolve(ROOT, '.github/workflows/ci.yml')

interface Step {
  id?: string
  name?: string
  uses?: string
  run?: string
  if?: string
  with?: { path?: string }
}

interface Job {
  steps?: Step[]
}

function loadJobs(): Record<string, Job> {
  const wf = parse(readFileSync(CI_PATH, 'utf8')) as { jobs?: Record<string, Job> }
  return wf.jobs ?? {}
}

function restoresNodeModules(step: Step): boolean {
  return (
    typeof step.uses === 'string' &&
    step.uses.includes('actions/cache/restore') &&
    step.with?.path === 'node_modules'
  )
}

describe('CI node_modules cache-restore fallback (LIFT-1170)', () => {
  const jobs = loadJobs()

  it('parses the CI workflow with at least one node_modules restore', () => {
    const restoreCount = Object.values(jobs)
      .flatMap((job) => job.steps ?? [])
      .filter(restoresNodeModules).length
    // The consumers that restore rather than save the cache: lint, typecheck,
    // test, lighthouse, build-and-test, e2e.
    expect(restoreCount).toBeGreaterThanOrEqual(6)
  })

  it('every job that restores node_modules has a guarded npm ci fallback', () => {
    for (const [jobName, job] of Object.entries(jobs)) {
      const steps = job.steps ?? []
      const restoreIdx = steps.findIndex(restoresNodeModules)
      if (restoreIdx === -1) continue

      const restore = steps[restoreIdx]
      expect(
        restore.id,
        `Job "${jobName}" restores node_modules but the restore step has no id — the fallback can't reference its cache-hit output`
      ).toBeTruthy()

      const fallback = steps
        .slice(restoreIdx + 1)
        .find((s) => typeof s.run === 'string' && /\bnpm ci\b/.test(s.run))

      expect(
        fallback,
        `Job "${jobName}" restores node_modules but has no "npm ci" fallback step — a cache miss/eviction would hard-fail it`
      ).toBeDefined()

      expect(
        fallback?.if,
        `Job "${jobName}"'s npm ci fallback must be guarded by an if: condition so it only runs on a cache miss`
      ).toBeTruthy()

      // The guard must key off THIS restore step's cache-hit output.
      expect(
        fallback?.if?.includes(`steps.${restore.id}.outputs.cache-hit`),
        `Job "${jobName}"'s npm ci fallback must be gated on steps.${restore.id}.outputs.cache-hit, got: ${fallback?.if}`
      ).toBe(true)
      expect(fallback?.if).toContain(`!= 'true'`)
    }
  })
})
