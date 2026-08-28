import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Guards LIFT-1168: every CI job must declare `timeout-minutes` so a hung
// runner (a wedged Playwright browser, a stuck `supabase start`, a Vitest
// deadlock) is killed at a tight cap instead of billing GitHub's 360-minute
// default. LIFT-866 added these originally, but `workflow-lint`, `lighthouse`,
// and `build-and-test` were later added without one and slipped the net —
// this test fails the build if any job forgets it again.

const ROOT = resolve(__dirname, '../../..')
const WORKFLOWS = ['.github/workflows/ci.yml', '.github/workflows/integration.yml']

/**
 * Parse a GitHub Actions workflow file and return, per job, whether it
 * declares `timeout-minutes` at the job level. Line-based (no YAML dep):
 * job keys are the 2-space-indented mapping keys under `jobs:`, and a
 * job-level `timeout-minutes:` sits at 4-space indentation before the
 * deeper-nested `steps:` content.
 */
function jobsWithTimeoutStatus(yaml: string): Record<string, boolean> {
  const lines = yaml.split('\n')
  const jobsIdx = lines.findIndex((l) => /^jobs:\s*$/.test(l))
  expect(jobsIdx).toBeGreaterThanOrEqual(0)

  const status: Record<string, boolean> = {}
  let currentJob: string | null = null

  for (let i = jobsIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '' || line.trim().startsWith('#')) continue

    // A new top-level section (column 0) ends the jobs block.
    if (/^\S/.test(line)) break

    const jobMatch = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/)
    if (jobMatch) {
      currentJob = jobMatch[1]
      status[currentJob] = false
      continue
    }

    if (currentJob && /^ {4}timeout-minutes:\s*\d+\s*$/.test(line)) {
      status[currentJob] = true
    }
  }

  return status
}

describe('CI workflow job timeouts (LIFT-1168)', () => {
  for (const workflow of WORKFLOWS) {
    describe(workflow, () => {
      const yaml = readFileSync(resolve(ROOT, workflow), 'utf8')
      const status = jobsWithTimeoutStatus(yaml)

      it('defines at least one job', () => {
        expect(Object.keys(status).length).toBeGreaterThan(0)
      })

      for (const [job, hasTimeout] of Object.entries(status)) {
        it(`job "${job}" declares timeout-minutes`, () => {
          expect(hasTimeout).toBe(true)
        })
      }
    })
  }
})
