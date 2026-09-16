import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'

// LIFT-1434 — the DELIVERY half of dependency security.
//
// npmAuditWorkflow.test.ts pins the *detection* gate (a published advisory
// turns a check red). Nothing pinned what is allowed to reach production
// unattended, and the answer was: every non-major Dependabot bump, immediately.
// master auto-deploys to Vercel, `build-and-test` was the only required check,
// and PR #1415 went from opened to merged in 2m18s. A freshly-published
// malicious version has no advisory yet — that window is the whole point of the
// attack — so `npm audit` could not have covered it and neither could
// `dependency-review`, which only scores what the advisory database already
// knows.
//
// Two invariants, both derived from the real files rather than a fixture:
//   1. EVERY ecosystem entry holds a `cooldown`, and no cooldown window is
//      shorter than MIN_COOLDOWN_DAYS. Every entry, not just npm: a compromised
//      github-actions release is the same delivery path and runs with the
//      repo's GITHUB_TOKEN, and `default-days` is supported there too. The
//      floor is enforced over EVERY `*-days` key present, not just
//      `default-days`, because the obvious way to reopen the hole is a
//      well-meaning `semver-patch-days: 0` — and every documented npm
//      compromise shipped as a patch or minor release.
//   2. No Dependabot-scoped job merges or approves a PR without a human.
//      Scanning every workflow (rather than naming the one that had the merge
//      step) is what keeps a second auto-merge workflow from reintroducing it.

const ROOT = resolve(__dirname, '../../..')
const DEPENDABOT_PATH = resolve(ROOT, '.github/dependabot.yml')
const WORKFLOWS_DIR = resolve(ROOT, '.github/workflows')

/**
 * Five days is the configured window. The floor is lower so routine tuning
 * doesn't need a test edit, but a window short enough to be decorative does.
 */
const MIN_COOLDOWN_DAYS = 3

interface Cooldown {
  'default-days'?: number
  'semver-major-days'?: number
  'semver-minor-days'?: number
  'semver-patch-days'?: number
  [key: string]: unknown
}

interface UpdateEntry {
  'package-ecosystem'?: string
  cooldown?: Cooldown
}

interface Step {
  name?: string
  uses?: string
  run?: string
  if?: string
}

interface Job {
  if?: string
  permissions?: Record<string, string> | string
  steps?: Step[]
}

interface Workflow {
  name?: string
  permissions?: Record<string, string> | string
  jobs?: Record<string, Job>
}

function loadDependabotUpdates(): UpdateEntry[] {
  const config = parse(readFileSync(DEPENDABOT_PATH, 'utf8')) as { updates?: UpdateEntry[] }
  return config.updates ?? []
}

function loadWorkflows(): { file: string; workflow: Workflow }[] {
  return readdirSync(WORKFLOWS_DIR)
    .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
    .map((file) => ({
      file,
      workflow: parse(readFileSync(resolve(WORKFLOWS_DIR, file), 'utf8')) as Workflow,
    }))
}

/** A job Dependabot's own PRs can reach: gated on the bot, or in a file named for it. */
function isDependabotScoped(file: string, job: Job): boolean {
  return file.includes('dependabot') || (job.if ?? '').includes('dependabot')
}

function writePermissions(permissions: Job['permissions']): string[] {
  if (typeof permissions === 'string') {
    return permissions === 'write-all' ? ['<write-all>'] : []
  }
  return Object.entries(permissions ?? {})
    .filter(([, level]) => level === 'write')
    .map(([scope]) => scope)
}

describe('Dependabot supply-chain gates (LIFT-1434)', () => {
  describe('cooldown holds a freshly-published release back', () => {
    const updates = loadDependabotUpdates()

    // Guards the two assertions below against passing over an empty list.
    it('parses the real dependabot config, npm included', () => {
      expect(updates.length).toBeGreaterThan(0)
      expect(updates.map((entry) => entry['package-ecosystem'])).toContain('npm')
    })

    it('every ecosystem entry declares a cooldown', () => {
      for (const entry of updates) {
        const ecosystem = entry['package-ecosystem']
        expect(
          entry.cooldown,
          `"${ecosystem}" has no cooldown — a merge here reaches production, so a brand-new release must age before Dependabot proposes it`
        ).toBeDefined()
        expect(
          typeof entry.cooldown?.['default-days'],
          `"${ecosystem}" cooldown must set default-days (the only key every ecosystem supports)`
        ).toBe('number')
      }
    })

    it('no cooldown window is shorter than the floor, including per-semver overrides', () => {
      for (const entry of updates) {
        for (const [key, value] of Object.entries(entry.cooldown ?? {})) {
          if (!key.endsWith('-days')) continue
          expect(
            value,
            `${entry['package-ecosystem']} cooldown "${key}" must be a number of days`
          ).toBeTypeOf('number')
          expect(
            value as number,
            `${entry['package-ecosystem']} cooldown "${key}" is ${String(value)} — every documented npm registry compromise shipped as a patch or minor release, so a short window here is the hole, not the exception`
          ).toBeGreaterThanOrEqual(MIN_COOLDOWN_DAYS)
        }
      }
    })
  })

  describe('nothing Dependabot opens merges without a human', () => {
    const workflows = loadWorkflows()

    it('finds the Dependabot-scoped workflow to scan', () => {
      const scoped = workflows.flatMap(({ file, workflow }) =>
        Object.values(workflow.jobs ?? {}).filter((job) => isDependabotScoped(file, job))
      )
      expect(scoped.length).toBeGreaterThan(0)
    })

    it('no Dependabot-scoped step enables auto-merge or approves the PR', () => {
      for (const { file, workflow } of workflows) {
        for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
          if (!isDependabotScoped(file, job)) continue

          for (const step of job.steps ?? []) {
            const run = step.run ?? ''
            expect(
              /gh\s+pr\s+merge/.test(run),
              `${file} job "${jobName}" runs \`gh pr merge\` — master auto-deploys, so that is an unreviewed path from a compromised release to production (LIFT-1434)`
            ).toBe(false)
            expect(
              /gh\s+pr\s+review\s+--approve/.test(run),
              `${file} job "${jobName}" auto-approves a Dependabot PR — the same bypass by another route`
            ).toBe(false)
            expect(
              /auto[-_]?merge/i.test(step.uses ?? ''),
              `${file} job "${jobName}" uses the auto-merge action "${step.uses}" — merging stays manual (LIFT-1434)`
            ).toBe(false)
          }
        }
      }
    })

    it('Dependabot-scoped jobs request no write permissions', () => {
      for (const { file, workflow } of workflows) {
        for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
          if (!isDependabotScoped(file, job)) continue

          const granted = [
            ...writePermissions(workflow.permissions),
            ...writePermissions(job.permissions),
          ]
          expect(
            granted,
            `${file} job "${jobName}" grants write access (${granted.join(', ')}) to a workflow Dependabot PRs trigger — it only ever needed that to merge itself`
          ).toEqual([])
        }
      }
    })
  })
})
