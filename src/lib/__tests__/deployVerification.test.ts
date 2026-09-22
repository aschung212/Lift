import { describe, it, expect, afterAll } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parse } from 'yaml'
// The domain reader `smoke-test-production` runs. Imported, not
// re-implemented: these tests must exercise the code CI executes. The wiring
// tests below pin READER_PATH against the script the workflow invokes, and
// that script against this module.
import { main as readLiveDomainCli, parseLiveDomain } from '../../../scripts/live-domain.mjs'

const READER_PATH = 'scripts/read-live-domain.mjs'
const READER_LIB = 'live-domain.mjs'

// LIFT-1167: the "✅ Deployed to production" Slack message must not fire off
// green CI alone — CI passing does not prove Vercel promoted the commit (a
// failed Vercel build leaves the PREVIOUS deploy live, answering 200). A
// dedicated `smoke-test-production` job polls the prod URL until it serves
// THIS commit's version.json, and notify-deploy depends on it. This test pins
// that wiring so the guarantee can't silently regress in a workflow edit.

const ROOT = resolve(__dirname, '../../..')
const CI_PATH = resolve(ROOT, '.github/workflows/ci.yml')

interface Step {
  id?: string
  name?: string
  uses?: string
  run?: string
  if?: string
  env?: Record<string, string>
}
interface Job {
  needs?: string | string[]
  if?: string
  outputs?: Record<string, string>
  permissions?: string | Record<string, string>
  env?: Record<string, string>
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

/** The step in `smoke-test-production` that polls production for this commit. */
function verifyStepOf(jobs: Record<string, Job>): Step | undefined {
  return (jobs['smoke-test-production']?.steps ?? []).find((s) =>
    /verify production/i.test(s.name ?? ''),
  )
}

/**
 * Jobs that WRITE to the repository rather than validate it — bookkeeping,
 * not a gate on whether master is healthy (LIFT-1475).
 *
 * Derived from two independent signals so removing one doesn't disarm the
 * scan: a job that grants itself `contents: write` (the whole workflow is
 * `contents: read` by default), and a job whose steps actually commit or
 * push. `ratchet-baseline` carries both today; a future bookkeeping job is
 * caught by whichever it carries.
 *
 * `git diff` is deliberately NOT a signal — smoke-test-production runs the
 * deploy gate's `git diff --quiet` and reads the repo without writing it.
 */
function repoWritingJobs(jobs: Record<string, Job>): string[] {
  return Object.entries(jobs)
    .filter(([, job]) => {
      const perms = job.permissions
      const contents = typeof perms === 'string' ? perms : perms?.contents
      if (contents === 'write' || contents === 'write-all') return true
      return (job.steps ?? []).some((s) => /\bgit\s+(commit|push)\b/.test(s.run ?? ''))
    })
    .map(([name]) => name)
}

/** Every `run:` in a job, concatenated — for "does this job do X anywhere" checks. */
function runScriptOf(job: Job | undefined): string {
  return (job?.steps ?? []).map((s) => s.run ?? '').join('\n')
}

/**
 * The step in `deploy-production` that writes the deploy decision.
 *
 * Derived from the workflow rather than hardcoding the step id: the step that
 * writes the gate decision is whichever one writes `deploy=` to GITHUB_OUTPUT.
 * It lives in the deploy job rather than the smoke test since LIFT-1169 — CI
 * owns the deploy now, so the gate has to be applied where the deploy happens,
 * and the verification job reads the answer instead of re-deriving it.
 */
function gateStepOf(jobs: Record<string, Job>): Step | undefined {
  return (jobs['deploy-production']?.steps ?? []).find((s) =>
    /deploy=.*GITHUB_OUTPUT/s.test(s.run ?? ''),
  )
}

/** The `deploy-production` job output carrying the gate step's decision. */
function gateOutputNameOf(jobs: Record<string, Job>): string | undefined {
  const id = gateStepOf(jobs)?.id
  if (!id) return undefined
  return Object.entries(jobs['deploy-production']?.outputs ?? {}).find(([, v]) =>
    v.includes(`steps.${id}.outputs.deploy`),
  )?.[0]
}

// ---------------------------------------------------------------------------
// LIFT-1354: which commits Vercel actually deploys.
//
// `vercel.json`'s `ignoreCommand` decides that, and its contract is inverted:
// exit 0 means SKIP the build. It used to be an ALLOWLIST of deployable paths
// naming `vite.config.js` but none of the four root-level `vite-plugin-*.ts`
// files that config imports — so a commit touching only, say, the theme-split
// plugin (which changes the CSS actually served) matched nothing, Vercel
// skipped the build, and production kept serving the previous bundle
// indefinitely. `package-lock.json` had the same gap.
//
// It is now a DENYLIST: deploy unless the commit touched ONLY known
// non-deployable paths. That fails safe — an unrecognised new root-level build
// input deploys rather than silently not deploying.
//
// These tests answer "would a commit touching exactly these files deploy?" by
// EVALUATING the real command against a path list, rather than asserting on
// its text. The defect was a path that matched nothing, which no string
// assertion over an allowlist can see: the old command mentioned every path
// it knew about, and that was the bug. The command itself lives in
// scripts/vercel-ignore-build.sh, not inline in vercel.json's ignoreCommand
// field — Vercel's schema caps that field at 256 characters, which the
// pathspec list exceeds on its own; deployGateCommand() resolves the short
// `bash <script>` form vercel.json holds to the git-diff line inside it.
//
// The evaluator below models the two layers the command passes through — the
// shell's word splitting and git's pathspec matching — and is deliberately
// STRICT: any shell syntax or pathspec magic beyond the small set actually in
// use throws, so a rewrite into a form this harness cannot faithfully model
// fails the suite instead of being silently mis-evaluated.
// ---------------------------------------------------------------------------

/**
 * Split a shell command into argv. Only understands the single-quoted form the
 * ignoreCommand uses (git pathspec magic like `':(exclude)docs/'` must be
 * quoted); anything else throws so the test fails loudly rather than reasoning
 * about something it mis-parsed.
 */
function shellWords(cmd: string): string[] {
  const words: string[] = []
  let word = ''
  let quoted = false
  let started = false
  for (const ch of cmd) {
    if (ch === '"' || ch === '\\' || ch === '$' || ch === '`') {
      throw new Error(`ignoreCommand uses shell syntax this harness cannot parse: ${cmd}`)
    }
    if (ch === "'") {
      quoted = !quoted
      started = true
      continue
    }
    if (!quoted && /\s/.test(ch)) {
      if (started) words.push(word)
      word = ''
      started = false
      continue
    }
    word += ch
    started = true
  }
  if (quoted) throw new Error(`unbalanced quote in ignoreCommand: ${cmd}`)
  if (started) words.push(word)
  return words
}

interface Pathspec {
  raw: string
  exclude: boolean
  glob: boolean
  pattern: string
}

/**
 * Parse one git pathspec. Only the long-form magic actually used here
 * (`:(exclude)`, `:(exclude,glob)`) is modelled; the short forms (`:!`, `:/`)
 * and every other magic word throw.
 */
function parsePathspec(raw: string): Pathspec {
  if (!raw.startsWith(':')) return { raw, exclude: false, glob: false, pattern: raw }
  const magic = raw.match(/^:\(([a-z,]+)\)(.*)$/)
  if (!magic) throw new Error(`pathspec magic this harness does not model: ${raw}`)
  const words = magic[1].split(',')
  for (const word of words) {
    if (word !== 'exclude' && word !== 'glob') {
      throw new Error(`pathspec magic "${word}" is not modelled by this harness: ${raw}`)
    }
  }
  return { raw, exclude: words.includes('exclude'), glob: words.includes('glob'), pattern: magic[2] }
}

/**
 * `:(glob)` is fnmatch(3) with FNM_PATHNAME: wildcards never cross a `/`, and
 * the pattern must match the WHOLE path (so `*.md` covers `README.md` but not
 * `docs/x.md`).
 */
function globToRegExp(pattern: string): RegExp {
  if (/\*\*|[[\]{}!]/.test(pattern)) {
    throw new Error(`glob pathspec uses syntax this harness does not model: ${pattern}`)
  }
  const body = pattern
    .replace(/[.+^$()|\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
  return new RegExp(`^${body}$`)
}

function pathspecMatches(spec: Pathspec, path: string): boolean {
  if (spec.glob) return globToRegExp(spec.pattern).test(path)
  // A literal pathspec matches the path itself or anything beneath it.
  const prefix = spec.pattern.replace(/\/+$/, '')
  if (prefix === '' || prefix === '.') return true
  return path === prefix || path.startsWith(`${prefix}/`)
}

/** git's rule: in scope when some positive pathspec matches and no exclusion does. */
function inDiffScope(path: string, specs: Pathspec[]): boolean {
  const included =
    specs.every((s) => s.exclude) || specs.some((s) => !s.exclude && pathspecMatches(s, path))
  return included && !specs.some((s) => s.exclude && pathspecMatches(s, path))
}

interface DeployGate {
  revs: string[]
  specs: Pathspec[]
}

function parseDeployGate(command: string): DeployGate {
  const words = shellWords(command)
  const sep = words.indexOf('--')
  if (words[0] !== 'git' || words[1] !== 'diff' || sep === -1) {
    throw new Error(`ignoreCommand is not a \`git diff … -- <pathspec>\` invocation: ${command}`)
  }
  return {
    revs: words.slice(2, sep).filter((w) => !w.startsWith('-')),
    specs: words.slice(sep + 1).map(parsePathspec),
  }
}

/**
 * Vercel's contract: `ignoreCommand` exiting 0 means SKIP the build. So a
 * commit deploys exactly when `git diff --quiet` finds a difference, i.e. when
 * at least one of its changed paths is in the pathspec's scope.
 */
function deploysWhenTouching(paths: string[], command: string): boolean {
  const { specs } = parseDeployGate(command)
  return paths.some((path) => inDiffScope(path, specs))
}

function ignoreCommandOf(json = readFileSync(resolve(ROOT, 'vercel.json'), 'utf8')): string {
  const cmd = (JSON.parse(json) as { ignoreCommand?: string }).ignoreCommand
  if (!cmd) throw new Error('vercel.json has no ignoreCommand')
  return cmd
}

/**
 * The denylist pathspec lives in a script, not inline in vercel.json's
 * `ignoreCommand` (LIFT-1354 follow-up): Vercel's schema caps that field at
 * 256 characters, and the pathspec list is well past that on its own — it
 * shipped inline at 465 characters and every deployment errored with
 * "`ignoreCommand` should NOT be longer than 256 characters" instead of
 * running. `ignoreCommandOf()` above returns the short `bash <script>` form
 * Vercel actually reads; this resolves it to the `git diff …` line the script
 * runs, which is what the evaluator below needs.
 */
function deployGateCommand(): string {
  const ignoreCmd = ignoreCommandOf()
  const match = ignoreCmd.match(/^bash (\S+)$/)
  if (!match) throw new Error(`ignoreCommand is not a \`bash <script>\` invocation: ${ignoreCmd}`)
  const script = readFileSync(resolve(ROOT, match[1]), 'utf8')
  const line = script.split('\n').find((l) => l.trim().startsWith('git diff --quiet'))
  if (!line) throw new Error(`${match[1]} has no \`git diff --quiet\` line`)
  return line.trim()
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

  // LIFT-1354: smoke-test-production skips its verification for a commit
  // Vercel ignores, but still SUCCEEDS — so notify-deploy posted "Deployed to
  // production (verified live)" for a commit that was neither deployed nor
  // verified. The gate's decision has to reach the notification.
  describe('the "Deployed" claim is withheld when nothing deployed', () => {
    const gateStep = gateStepOf(jobs)
    const outputName = gateOutputNameOf(jobs)

    it('the gate step has an id and publishes its decision as a job output', () => {
      expect(gateStep, 'expected a step writing deploy= to GITHUB_OUTPUT').toBeDefined()
      expect(gateStep?.id, 'the gate step needs an id to be referenced as an output').toBeTruthy()
      expect(
        outputName,
        `deploy-production must expose steps.${gateStep?.id}.outputs.deploy`,
      ).toBeDefined()
    })

    it('the verification step is the one gated on that decision', () => {
      // Read off the deploy job's output rather than re-derived here: one
      // derivation of "did this commit deploy", so the gate and the check
      // cannot disagree and strand this job polling for a deploy that never
      // happened.
      expect(verifyStepOf(jobs)?.if ?? '').toContain(
        `needs.deploy-production.outputs.${outputName}`,
      )
    })

    it('notify-deploy reads the gate decision and branches its message', () => {
      expect(outputName).toBeDefined()

      const step = (jobs['notify-deploy']?.steps ?? []).find((s) =>
        /notify slack/i.test(s.name ?? ''),
      )
      // Consumed via env, not inline `${{ }}` in the bash body — same
      // script-injection guard as the commit message beside it.
      const envValues = Object.values(step?.env ?? {})
      const wired = envValues.find(
        (v) => v.includes('needs.deploy-production.outputs') && v.includes(outputName as string),
      )
      expect(wired, 'notify-deploy must read the deploy decision via env').toBeDefined()

      const envName = Object.entries(step?.env ?? {}).find(([, v]) => v === wired)?.[0]
      const run = step?.run ?? ''
      // The message actually branches on it…
      expect(run).toMatch(new RegExp(`if \\[ "\\$${envName}" = "true" \\]`))

      // …and the skipped branch still says SOMETHING (silence reads as a
      // broken workflow) without claiming a deploy or a verification. The
      // exact wording is deliberately not pinned; the lie is.
      const skippedBranch = run.slice(run.indexOf(`$${envName}`), run.indexOf('else'))
      expect(skippedBranch).toMatch(/MSG=".+"/)
      expect(skippedBranch).not.toMatch(/deployed to production/i)
      expect(skippedBranch).not.toMatch(/verified live/i)
    })
  })

  // LIFT-1475: the three jobs that make up the deploy-verification chain each
  // declare their own `needs`, and the lists drifted. smoke-test-production
  // deliberately excludes ratchet-baseline — and says why — but both notify
  // jobs listed it, so a coverage-bookkeeping failure (an expired
  // coverage-summary artifact, a malformed coverage-summary.json, an
  // unguarded git config/add/commit) withheld "✅ Deployed to production" and
  // posted "🔴 Post-merge CI failed on master" for a push whose deploy the
  // smoke test had just verified live on the same run. The one message whose
  // job is to name the broken system named the wrong one — LIFT-1367's
  // complaint from the opposite side.
  //
  // Both rules below are DERIVED, in the two directions that can be wrong. A
  // hardcoded `expect(needs).not.toContain('ratchet-baseline')` would only
  // ever pin the one job that existed when it was written, which is exactly
  // how these three lists came to disagree.
  describe('the notify jobs report on the deploy, not on bookkeeping', () => {
    const notifyJobs = ['notify-deploy', 'notify-failure'] as const
    const chain = ['smoke-test-production', ...notifyJobs] as const

    it('the repo-writing scan finds something (the rule below is not vacuous)', () => {
      // Floor assertion: if the derivation stops matching — `permissions:`
      // reformatted, the commit moved into a script — every assertion below
      // passes having checked nothing.
      expect(repoWritingJobs(jobs).length).toBeGreaterThan(0)
    })

    it.each(chain)('%s does not depend on a job that writes to the repo', (name) => {
      const writers = repoWritingJobs(jobs)
      const depended = needsOf(jobs[name]).filter((n) => writers.includes(n))
      expect(
        depended,
        `${name} must not gate on bookkeeping: ${depended.join(', ')} push commits rather than validate master`,
      ).toEqual([])
    })

    // The other direction, and the reason the notify lists are longer than
    // smoke-test-production's rather than equal to it: a FAILED deploy
    // prerequisite leaves smoke-test-production `skipped`, and a skipped
    // dependency does not make `success()` false. Drop migrate-db from
    // notify-deploy and a failed schema push would post "verified live" for a
    // verification that never ran — LIFT-1167's falsely-green claim, reached
    // by pruning the wrong name off these lists.
    it.each(notifyJobs)('%s depends on every deploy prerequisite of the smoke test', (name) => {
      const prerequisites = needsOf(jobs['smoke-test-production'])
      expect(prerequisites.length, 'expected smoke-test-production to declare needs').toBeGreaterThan(0)
      expect(needsOf(jobs[name])).toEqual(expect.arrayContaining(prerequisites))
    })
  })
})

// LIFT-1169: `migrate-db` claimed in a comment to run "before Vercel deploys",
// but Vercel's git integration deployed on push — independently of this
// workflow, and minutes ahead of a job that waits behind build-and-test + e2e.
// So code depending on a fresh column went live and errored for users until the
// migration caught up, and no ordering primitive existed that could stop it.
//
// The fix has two halves that are only correct together: git auto-deploy is off
// for master (vercel.json), and CI deploys after migrate-db (ci.yml). Delete
// either one and the repo is broken in a different direction — restore git
// auto-deploy and the race is back; drop the CI job and master silently stops
// reaching production. These tests pin both.
describe('production deploys are ordered after the schema migration (LIFT-1169)', () => {
  const jobs = loadJobs()
  const deploy = jobs['deploy-production']

  it('defines a deploy-production job', () => {
    expect(deploy, 'ci.yml must own the production deploy').toBeDefined()
  })

  it('vercel.json turns OFF git auto-deploy for master', () => {
    // The other half of the guarantee. With this re-enabled, Vercel would
    // deploy the push directly again and the CI ordering would be advisory.
    const config = JSON.parse(readFileSync(resolve(ROOT, 'vercel.json'), 'utf8')) as {
      git?: { deploymentEnabled?: Record<string, boolean> }
    }
    expect(config.git?.deploymentEnabled?.master).toBe(false)
  })

  it('the deploy waits for migrate-db', () => {
    expect(needsOf(deploy)).toContain('migrate-db')
  })

  it('the deploy is gated at least as narrowly as migrate-db', () => {
    // A `needs:` edge does not stop a SKIPPED job from satisfying it — GitHub
    // treats a skipped need as met. So if migrate-db's gate ever narrows
    // relative to the deploy's, the deploy sails past a migration that never
    // ran: the original bug, reintroduced through its own fix. Requiring every
    // migrate-db clause to also gate the deploy makes that unrepresentable.
    const clauses = (cond: string) =>
      cond
        .split('&&')
        .map((c) => c.trim())
        // `success()` is GitHub's implicit default when `if` is present without
        // it, so stating it or not is a style choice, not a gate.
        .filter((c) => c.length > 0 && c !== 'success()')

    const migrateClauses = clauses(jobs['migrate-db']?.if ?? '')
    expect(migrateClauses.length).toBeGreaterThan(0)
    for (const clause of migrateClauses) {
      expect(clauses(deploy?.if ?? '')).toContain(clause)
    }
  })

  it('the deploy only runs on green master pushes', () => {
    const cond = deploy?.if ?? ''
    expect(cond).toContain('success()')
    expect(cond).toContain("github.event_name == 'push'")
    expect(cond).toContain("github.ref == 'refs/heads/master'")
  })

  it('deploys the prebuilt output to production', () => {
    const script = runScriptOf(deploy)
    // `vercel build` locally + `deploy --prebuilt` is what lets the deploy be
    // ordered at all: a plain `vercel deploy` would hand the build back to
    // Vercel and reopen the timing gap this issue is about.
    expect(script).toContain('vercel build --prod')
    expect(script).toContain('vercel deploy --prebuilt --prod')
  })

  it('stamps version.json with the commit CI checked out', () => {
    const build = (deploy?.steps ?? []).find((s) => (s.run ?? '').includes('vercel build'))
    // vite-plugin-version-stamp reads this first, ahead of any
    // VERCEL_GIT_COMMIT_SHA that `vercel pull` wrote into
    // .vercel/.env.production.local describing a different deployment. The
    // smoke test polls for exactly this value.
    expect(build?.env?.LIFT_BUILD_COMMIT).toBe('${{ github.sha }}')
  })

  it('fails with an actionable message when the deploy secrets are missing', () => {
    // With git auto-deploy off, an unconfigured secret means production stops
    // updating. That must not surface as an opaque CLI auth error.
    const jobEnv = deploy?.env ?? {}
    expect(jobEnv.VERCEL_TOKEN).toBe('${{ secrets.VERCEL_TOKEN }}')
    expect(jobEnv.VERCEL_ORG_ID).toBe('${{ secrets.VERCEL_ORG_ID }}')
    expect(jobEnv.VERCEL_PROJECT_ID).toBe('${{ secrets.VERCEL_PROJECT_ID }}')

    const preflight = (deploy?.steps ?? []).find((s) => /credentials/i.test(s.name ?? ''))
    expect(preflight, 'expected a credential preflight step').toBeDefined()
    const run = preflight?.run ?? ''
    for (const secret of ['VERCEL_TOKEN', 'VERCEL_ORG_ID', 'VERCEL_PROJECT_ID']) {
      expect(run).toContain(secret)
    }
    expect(run).toContain('::error::')
  })

  it('refuses to deploy a bundle not stamped with this commit', () => {
    // Whether LIFT_BUILD_COMMIT survives into the vite build is the Vercel
    // CLI's behaviour, not this workflow's — it spawns the build with the
    // pulled production env merged in. If it doesn't survive, version.json
    // carries another deployment's SHA (or none) and the only symptom is
    // smoke-test-production timing out 300s AFTER the bundle went live. The
    // check has to precede the deploy, or it is just a slower way to learn the
    // same thing.
    const steps = deploy?.steps ?? []
    const stampIdx = steps.findIndex((s) => (s.run ?? '').includes('version.json'))
    expect(stampIdx, 'expected a version-stamp check step').toBeGreaterThan(-1)
    expect(steps[stampIdx]?.env?.EXPECTED_SHA).toBe('${{ github.sha }}')
    expect(steps[stampIdx]?.run ?? '').toContain('::error::')

    const deployIdx = steps.findIndex((s) => (s.run ?? '').includes('vercel deploy --prebuilt'))
    expect(deployIdx).toBeGreaterThan(-1)
    expect(stampIdx).toBeLessThan(deployIdx)
  })

  it('re-runs the dev-surface guard against the bundle that actually ships', () => {
    // build-and-test runs the same guard, but on a build without Vercel's
    // project env — so it could never catch the cause its own comment names
    // (a VITE_E2E left set on the Vercel project). This build has that env, and
    // the guard reads the tree `deploy --prebuilt` uploads.
    const script = runScriptOf(deploy)
    expect(script).toContain('check-no-dev-surface.js')
    expect(script).toContain('.vercel/output/static')
  })

  it('every step that touches Vercel is gated on the deploy decision', () => {
    // A docs-only commit must cost nothing: no CLI install, no production
    // build, and above all no `vercel deploy`. The gate step writes that
    // decision, so every step AFTER it has to consume it — otherwise a README
    // tweak rebuilds and re-promotes production, which is both the waste the
    // ignoreCommand exists to prevent and a fresh SHA on the alias that
    // smoke-test-production was told not to expect.
    const steps = deploy?.steps ?? []
    const gateId = gateStepOf(jobs)?.id
    const gateIdx = steps.findIndex((s) => s.id === gateId)
    expect(gateIdx).toBeGreaterThan(-1)
    // The step-output reference the job publishes — the same expression the
    // conditions have to name, derived rather than restated.
    const decision = (deploy?.outputs ?? {})[gateOutputNameOf(jobs) as string]?.match(
      /steps\.[\w-]+\.outputs\.\w+/,
    )?.[0]
    expect(decision, 'expected the job output to reference the gate step').toBeTruthy()
    for (const step of steps.slice(gateIdx + 1)) {
      expect(
        step.if ?? '',
        `step "${step.name ?? step.uses}" runs regardless of the deploy decision`,
      ).toContain(decision as string)
    }
  })

  it('the smoke test verifies the deploy this workflow made', () => {
    expect(needsOf(jobs['smoke-test-production'])).toContain('deploy-production')
  })

  it('a failed deploy reaches Slack instead of going quiet', () => {
    expect(needsOf(jobs['notify-failure'])).toContain('deploy-production')
    expect(needsOf(jobs['notify-deploy'])).toContain('deploy-production')
  })

  it('confirms the security headers survived the new build mechanism', () => {
    // vercel.json's headers reach production by being compiled into the
    // deployment's routing config, and this change moved the build that does
    // that compiling into CI. vercelHeadersRegression.test.ts only reads the
    // source file, so a mechanism that quietly dropped the CSP would ship
    // green — the smoke test checks the live response instead.
    const run = verifyStepOf(jobs)?.run ?? ''
    expect(run).toContain('content-security-policy')
    // Read off the response headers, not the body: markup that merely mentions
    // the policy must not be able to satisfy the check.
    expect(run).toContain('-D -')
  })

  it('retries an empty header probe instead of calling it a dropped CSP', () => {
    // The probe curl ends in `|| true`, so a transient fetch failure and a
    // genuinely absent header both arrive as an empty string. Conflating them
    // fails the deploy — terminally, inside a 30-attempt loop that exists to
    // absorb exactly this — and blames a vercel.json regression that never
    // happened, on the one job whose purpose is to report accurately WHICH
    // system broke. The empty case must warn and retry, like the app-shell
    // marker check beside it; only a probe that came back and lacks the header
    // is a real failure.
    const run = verifyStepOf(jobs)?.run ?? ''
    const emptyProbeGuard = run.indexOf('[ -z "$HEADERS" ]')
    expect(
      emptyProbeGuard,
      'expected an empty-probe branch before the CSP failure',
    ).toBeGreaterThan(-1)
    // …and it has to come FIRST, or the failure branch claims the empty probe.
    expect(emptyProbeGuard).toBeLessThan(run.indexOf('no Content-Security-Policy header'))
  })
})

// ---------------------------------------------------------------------------
// LIFT-1412: reading the production domain out of CLAUDE.md.
//
// smoke-test-production must never hardcode the deployment URL (the SEV1
// rule), so it reads the `**Live:**` line out of CLAUDE.md. That read used to
// be an inline `grep | sed -E 's/…/\1/'` guarded by `[ -z "$DOMAIN" ]`, and
// the guard could not fire for the failure it was written for: `sed` passes
// its input line through VERBATIM when the substitution misses, so the guard
// only ever caught a *missing* `**Live:**` line. A line that existed but was
// written in a different-but-reasonable markdown style yielded the whole
// line — non-empty — which was interpolated into `https://$DOMAIN`. Every curl
// against that failed, `|| true` swallowed it, and the job spent its full 300s
// poll budget before blaming the Vercel deploy for a markdown edit.
//
// These tests EXECUTE the real reader against several `**Live:**` line shapes
// rather than asserting on its text: the defect was an expression that matched
// nothing, which no string assertion over that expression can see.
// ---------------------------------------------------------------------------

// The `sed -E` substitution as it shipped: `^\*\*Live:\*\* *([A-Za-z0-9.-]+)`
// followed by `.` `*`, replaced by the capture. The one behaviour that matters
// is the one nothing modelled: `s///` emits the input line UNCHANGED when the
// pattern does not match, rather than failing or emitting nothing.
function oldSedExtraction(line: string): string {
  const pattern = /^\*\*Live:\*\* *([A-Za-z0-9.-]+).*/
  return pattern.test(line) ? line.replace(pattern, '$1') : line
}

describe('the production domain is read out of CLAUDE.md (LIFT-1412)', () => {
  const FIXTURES = mkdtempSync(join(tmpdir(), 'lift-live-domain-'))
  afterAll(() => rmSync(FIXTURES, { recursive: true, force: true }))

  /** Run the CLI half — argv handling, file read, exit code, stdout. */
  function runCli(argv: string[]) {
    const out: string[] = []
    const err: string[] = []
    const status = readLiveDomainCli(argv, (l) => out.push(l), (l) => err.push(l))
    return { status, stdout: out.join('\n'), stderr: err.join('\n') }
  }

  function fixtureFile(name: string, markdown: string): string {
    const file = join(FIXTURES, name)
    writeFileSync(file, markdown)
    return file
  }

  it('the verification step runs the reader these tests import', () => {
    // Derived from the workflow, not restated: if the script is renamed, this
    // fails until the import at the top of this file follows — which is what
    // keeps these tests exercising the code CI actually executes.
    const run = verifyStepOf(loadJobs())?.run ?? ''
    const invoked = run.match(/node (scripts\/[\w.-]+\.mjs)/)?.[1]
    expect(invoked, 'the step must read the domain via `node scripts/<reader>.mjs`').toBe(
      READER_PATH,
    )
    expect(run).toContain(`${READER_PATH} CLAUDE.md`)

    // …and that script must be a wrapper over the module tested below, not a
    // second copy of the parsing. It is deliberately not tested by calling it:
    // it ends in `process.exit`, and the point of splitting it out is that it
    // carries no entry guard that could silently decline to run.
    const cli = readFileSync(resolve(ROOT, READER_PATH), 'utf8')
    expect(cli).toContain(`from './${READER_LIB}'`)
  })

  it('a failed read is fatal, and names the domain rather than the deploy', () => {
    const run = verifyStepOf(loadJobs())?.run ?? ''
    // The sibling half of the original defect: the old pipeline ended in
    // `|| true`, so even a reader that failed loudly would have been ignored.
    const invocation = run.split('\n').find((l) => l.includes(READER_PATH)) ?? ''
    expect(invocation, 'expected the reader to be invoked').not.toBe('')
    expect(invocation).not.toMatch(/\|\|\s*true/)
    // And the annotation must name what actually broke — never the deploy
    // error 300s later, which is the misattribution this issue is about.
    expect(run).toMatch(/::error::[^\n]*deployment domain/i)
  })

  it("parses the repo's own **Live:** line", () => {
    // Not a fixture: the line CI will really read on the next master push. The
    // expected value is derived from index.html's canonical URL rather than
    // restated — the domain CI polls and the domain the app ships as its own
    // are one fact, and pinning a third copy here is how they drift.
    const canonical = readFileSync(resolve(ROOT, 'index.html'), 'utf8').match(
      /<link rel="canonical" href="https:\/\/([^/"]+)"/,
    )?.[1]
    expect(canonical, 'index.html must carry a canonical URL').toBeTruthy()

    const result = runCli([resolve(ROOT, 'CLAUDE.md')])
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(canonical)
  })

  it.each([
    ['bare, with a trailing note', '**Live:** newdomain.app (THE ONLY VALID DEPLOYMENT DOMAIN)'],
    ['in backticks', '**Live:** `newdomain.app`'],
    ['carrying a scheme', '**Live:** https://newdomain.app'],
    ['carrying a scheme and a path', '**Live:** https://newdomain.app/'],
    ['bolded', '**Live:** **newdomain.app**'],
    ['italicised', '**Live:** _newdomain.app_'],
    ['as a markdown link', '**Live:** [newdomain.app](https://newdomain.app)'],
    ['as an autolink', '**Live:** <https://newdomain.app>'],
    ['with extra spacing', '**Live:**   newdomain.app'],
  ])('reads the domain when the line is written %s', (_shape, line) => {
    expect(parseLiveDomain(`# Logbook\n\n${line}\n\nmore docs\n`)).toEqual({
      ok: true,
      domain: 'newdomain.app',
    })
  })

  it('reads a multi-label hostname, and stops at the port', () => {
    expect(parseLiveDomain('**Live:** https://sub.domain.co.uk:443/x\n')).toEqual({
      ok: true,
      domain: 'sub.domain.co.uk',
    })
  })

  it.each([
    ['the line carries prose instead of a domain', '**Live:** not deployed yet\n'],
    ['the line is empty', '**Live:**\n'],
    ['there is no **Live:** line at all', '# Logbook\n\nNo deployment recorded.\n'],
    // The domain must be the FIRST thing on the line, not merely somewhere on
    // it: a search over the whole line would pull a dotted token out of prose
    // and send the job off to poll `https://infra.md` for 300s — a narrower
    // rerun of this issue's own misattribution.
    ['the line names a dotted file in prose', '**Live:** TBD, see infra.md for status\n'],
    ['the domain is not the first token', '**Live:** mirrored at newdomain.app\n'],
  ])('fails closed when %s', (_case, markdown) => {
    // Fails closed: no domain at all, rather than a non-empty best guess that
    // the job would go on to poll for five minutes.
    expect(parseLiveDomain(markdown).ok).toBe(false)

    const result = runCli([fixtureFile('CLAUDE.md', markdown)])
    expect(result.status).not.toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toMatch(/read-live-domain/)
  })

  it('fails closed when CLAUDE.md is missing entirely', () => {
    const result = runCli([join(FIXTURES, 'nope.md')])
    expect(result.status).not.toBe(0)
    expect(result.stdout).toBe('')
  })

  it('the reader would have caught the original defect (self-test)', () => {
    // Proves the fixtures above are not vacuous: the same inputs, through the
    // expression that shipped.
    const backticked = '**Live:** `newdomain.app`'
    const schemed = '**Live:** https://newdomain.app'

    // A miss passes the whole markdown line through, so `[ -z "$DOMAIN" ]`
    // stayed silent and `https://**Live:** ...` went to curl.
    expect(oldSedExtraction(backticked)).toBe(backticked)
    // And where it did match, it matched the wrong thing: the character class
    // stops at the `:`, so the URL became `https://https`.
    expect(oldSedExtraction(schemed)).toBe('https')

    expect(parseLiveDomain(backticked)).toEqual({ ok: true, domain: 'newdomain.app' })
    expect(parseLiveDomain(schemed)).toEqual({ ok: true, domain: 'newdomain.app' })
  })
})

describe('vercel.json ignoreCommand — which commits deploy (LIFT-1354)', () => {
  const command = deployGateCommand()
  const deploys = (paths: string[]) => deploysWhenTouching(paths, command)

  it("ignoreCommand stays within Vercel's 256-character schema limit", () => {
    // The denylist shipped inline in vercel.json at 465 characters and Vercel
    // rejected every deployment with a schema-validation error instead of
    // running it — silently, since that error surfaces only as a failed
    // Vercel check, not a CI failure. Moving the pathspec list to a script
    // keeps this field short; this pins it so it can't silently regrow past
    // the cap the way the inline version did.
    expect(ignoreCommandOf().length).toBeLessThanOrEqual(256)
  })

  it('the harness would have caught the original defect (self-test)', () => {
    // The command as it shipped before this fix: an allowlist naming
    // vite.config.js but none of the plugins it imports. Proves these
    // assertions are not vacuous — the same evaluator reports "skipped" for
    // the old command and "deployed" for the new one, on the same commit.
    const oldAllowlist =
      'git diff --quiet HEAD^ HEAD -- src/ public/ api/ index.html vite.config.js package.json vercel.json'
    expect(deploysWhenTouching(['vite-plugin-theme-split.ts'], oldAllowlist)).toBe(false)
    expect(deploys(['vite-plugin-theme-split.ts'])).toBe(true)
  })

  it('the harness sees the ios/ omission too (self-test, LIFT-1438)', () => {
    // The denylist as it shipped between #1429 (which committed ios/) and
    // LIFT-1438. Same evaluator, same commit, opposite answers — so the
    // ios/ assertions below are pinning a real change, not restating a
    // property the command already had.
    const withoutIos =
      "git diff --quiet HEAD^ HEAD -- . ':(exclude).github/' ':(exclude)docs/' ':(exclude)scripts/'"
    expect(deploysWhenTouching(['ios/App/App/Info.plist'], withoutIos)).toBe(true)
    expect(deploys(['ios/App/App/Info.plist'])).toBe(false)
  })

  it('compares the pushed commit against its parent', () => {
    // Anything else and the gate answers for the wrong pair of commits — and
    // ci.yml checks out with fetch-depth: 2 on the strength of exactly this.
    expect(parseDeployGate(command).revs).toEqual(['HEAD^', 'HEAD'])
  })

  it('deploys every root-level module vite.config.js imports', () => {
    // Derived from the config, not enumerated: a fifth build plugin joins this
    // assertion by being imported, the way the first four did not join the
    // allowlist by being imported.
    const config = readFileSync(resolve(ROOT, 'vite.config.js'), 'utf8')
    const specifiers = [...config.matchAll(/from\s+'\.\/([^']+)'/g)].map((m) => m[1])
    expect(
      specifiers.length,
      'expected vite.config.js to import root-level modules',
    ).toBeGreaterThan(0)

    for (const specifier of specifiers) {
      // Extensionless TS specifiers resolve to the real file on disk.
      const file = ['', '.ts', '.js', '.mjs']
        .map((ext) => `${specifier}${ext}`)
        .find((candidate) => {
          try {
            readFileSync(resolve(ROOT, candidate))
            return true
          } catch {
            return false
          }
        })
      expect(file, `vite.config.js imports './${specifier}' but no such file exists`).toBeDefined()
      expect(deploys([file as string]), `${file} must be deployable`).toBe(true)
    }
  })

  it.each([
    ['package-lock.json'], // a transitive bump still changes what ships
    ['package.json'],
    ['vite.config.js'],
    ['vercel.json'],
    ['index.html'],
    ['src/App.vue'],
    ['public/manifest-icon.png'],
    ['api/coach.ts'],
  ])('deploys a commit touching %s', (path) => {
    expect(deploys([path])).toBe(true)
  })

  it.each([
    ['.github/workflows/ci.yml'],
    ['.husky/pre-commit'],
    ['docs/browser-mode-testing.md'],
    ['e2e/offline.spec.ts'],
    ['scripts/generate-icons.js'],
    ['supabase/migrations/20260101000000_add_thing.sql'],
    ['CLAUDE.md'],
    ['playwright.config.ts'],
    ['vitest.config.js'],
    ['vitest.browser.config.js'],
    // LIFT-1438: the native project is not a web build input. Capacitor's own
    // ios/.gitignore keeps the copied dist/ and generated capacitor.config.json
    // out of the repo, so everything tracked here is Xcode/Swift-side state.
    ['ios/App/App/Info.plist'],
    ['ios/App/App.xcodeproj/project.pbxproj'],
    ['ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'],
  ])('skips a commit touching only %s', (path) => {
    expect(deploys([path])).toBe(false)
  })

  it('skips the ratchet-baseline bookkeeping commit', () => {
    // ci.yml's ratchet-baseline job pushes `.coverage-baseline.json` with
    // [skip ci]. smoke-test-production deliberately does not depend on that
    // job precisely because Vercel skips its commit; if that stopped being
    // true, every coverage bump would rebuild production.
    expect(deploys(['.coverage-baseline.json'])).toBe(false)
  })

  it('deploys a mixed commit that touches one deployable path', () => {
    expect(deploys(['.github/workflows/ci.yml', 'docs/notes.md', 'src/main.ts'])).toBe(true)
  })

  it('deploys a native PR that also touches shared TypeScript', () => {
    // A Capacitor change routinely lands with the composable that drives it
    // (useHealthSync + the HealthKit entitlement, say). Excluding `ios/` must
    // not swallow the web half of such a commit.
    expect(deploys(['ios/App/App/App.entitlements', 'src/composables/useHealthSync.ts'])).toBe(true)
  })

  it('deploys an unrecognised new root-level path (fails safe)', () => {
    // The whole point of a denylist: the next root-level build input to appear
    // deploys by default instead of silently never deploying.
    expect(deploys(['postcss.config.js'])).toBe(true)
  })

  it('only excludes paths beneath a directory it actually names', () => {
    // `:(exclude)docs/` must not swallow a sibling whose name merely starts
    // the same way — the difference between a path prefix and a component
    // boundary, and the way a denylist entry would over-reach.
    expect(deploys(['docsite/index.html'])).toBe(true)
    expect(deploys(['src/scripts/worker.ts'])).toBe(true)
  })

  it('excludes the whole native project, not just its Swift sources', () => {
    // The `*.md` glob is FNM_PATHNAME, so it never covered
    // ios/App/CapApp-SPM/README.md — which is the shape of gap a per-file
    // exclusion leaves behind and a directory exclusion does not.
    expect(deploys(['ios/App/CapApp-SPM/README.md'])).toBe(false)
    expect(deploys(['ios/.gitignore'])).toBe(false)
    expect(deploys(['ios/debug.xcconfig'])).toBe(false)
  })

  it("CI's deploy gate can still execute the command it reads from vercel.json", () => {
    // ci.yml refuses to eval anything that isn't the known-safe form, so a
    // rewrite that breaks this would fail every master push with
    // "Unrecognised ignoreCommand". The accepted literal is read out of the
    // gate step's own `case` arm rather than restated here — restating it is
    // the drift this whole issue is about. It's an exact match, not a prefix:
    // ignoreCommand is now a fixed `bash <script>` invocation rather than a
    // git-diff-with-arbitrary-pathspec form, so there is nothing to prefix.
    const gateRun = gateStepOf(loadJobs())?.run ?? ''
    const accepted = gateRun.match(/"([^"]+)"\)/)?.[1]
    expect(accepted, "expected the gate step's case guard to name a literal command").toBeTruthy()
    expect(ignoreCommandOf()).toBe(accepted)
  })
})

// ---------------------------------------------------------------------------
// LIFT-1438: reconciling the denylist against what the repo actually tracks.
//
// The assertions above answer "does path X deploy?" for paths somebody thought
// to name. That is exactly what failed here: `ios/` was a gitignored
// per-machine artefact when the denylist was written, so there was no path to
// name, and when #1429 committed it as the App Store build it touched neither
// the script nor this file. Every native-only commit since — an Info.plist
// usage string, an entitlement, an icon, a deployment-target or SPM bump —
// spent a Vercel build and re-promoted production with a web bundle nobody had
// changed, moving `version.json`'s commit for it. Invisible by construction: a
// no-op deploy looks exactly like a real one, right down to notify-deploy's
// "✅ Deployed to production (verified live)".
//
// This is the third time this one file has been wrong about a path that
// existed and was never enumerated (LIFT-1354: the vite-plugin-*.ts files, and
// package-lock.json). The derived assertion there — every root-level module
// vite.config.js imports must deploy — closes that class for build inputs, but
// it cannot close this one: whether a path belongs in the web bundle is a
// judgement, not something readable out of the build graph.
//
// So the judgement is written down once, below, and RECONCILED against the
// repo: a top-level directory that is present and not gitignored, with no
// verdict, fails this suite until someone writes one. The next `ios/`
// therefore forces its decision at the moment it stops being ignored, instead
// of silently inheriting the fail-safe default.
// ---------------------------------------------------------------------------

type Deployability = 'deploy' | 'skip'

/**
 * Every top-level entry in the repo, and whether a commit touching only it
 * should reach production.
 *
 * A handful of entries marked 'deploy' are not build inputs at all
 * (`.gitattributes`, `.gitignore`, `.shellcheckrc`, `.run-browser-probe.sh`).
 * That is the denylist failing safe, and it is deliberately left as-is: those
 * files change close to never, and an occasional redundant build is the price
 * of the property that an unrecognised path deploys rather than silently not
 * deploying. `ios/` is different in kind — it is touched on every step toward
 * App Store submission.
 *
 * `test-results` is listed even though `.gitignore` names it, because one file
 * under it is tracked anyway (LIFT-1408) and the gate therefore still has an
 * opinion about it.
 */
const TOP_LEVEL_DEPLOYABILITY: Record<string, Deployability> = {
  // Ships to production.
  '.csp-hash.mjs': 'deploy',
  '.gitattributes': 'deploy',
  '.gitignore': 'deploy',
  '.run-browser-probe.sh': 'deploy',
  '.shellcheckrc': 'deploy',
  'api': 'deploy',
  'env.d.ts': 'deploy',
  'index.html': 'deploy',
  'package-lock.json': 'deploy',
  'package.json': 'deploy',
  'public': 'deploy',
  'src': 'deploy',
  'tsconfig.json': 'deploy',
  'vercel.json': 'deploy',
  'vite-plugin-legal-pages.ts': 'deploy',
  'vite-plugin-preload-default-view.ts': 'deploy',
  'vite-plugin-sitemap-lastmod.ts': 'deploy',
  'vite-plugin-theme-split.ts': 'deploy',
  'vite-plugin-version-stamp.ts': 'deploy',
  'vite.config.js': 'deploy',

  // Changes nothing a browser can see.
  'Screenshots': 'skip',
  '.coverage-baseline.json': 'skip',
  '.github': 'skip',
  '.husky': 'skip',
  '.lift703-comment.md': 'skip',
  'CLAUDE.md': 'skip',
  'CONTRIBUTING.md': 'skip',
  'README.md': 'skip',
  'capacitor.config.ts': 'skip',
  'docs': 'skip',
  'e2e': 'skip',
  'eslint.config.js': 'skip',
  'ios': 'skip',
  'lighthouserc.json': 'skip',
  'netlify.toml': 'skip',
  'playwright.config.ts': 'skip',
  'scripts': 'skip',
  'supabase': 'skip',
  'test-results': 'skip',
  'vitest.browser.config.js': 'skip',
  'vitest.config.js': 'skip',
  'vitest.integration.config.js': 'skip',
}

/**
 * Top-level names `.gitignore` keeps out of the repo, as matchers.
 *
 * Only patterns that name something at the ROOT are relevant here, so anything
 * still containing a `/` after the trailing slash is stripped (`scripts/output/`,
 * `supabase/.temp/`) is dropped along with negations. A pattern `globToRegExp`
 * cannot model is skipped rather than thrown on: the effect is that its
 * directory would be asked for a verdict it may not need, which is the safe
 * direction to be wrong in — the same posture as the denylist itself.
 */
function ignoredTopLevelMatchers(): RegExp[] {
  const matchers: RegExp[] = []
  for (const raw of readFileSync(resolve(ROOT, '.gitignore'), 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('!')) continue
    const name = line.replace(/\/+$/, '')
    if (name.includes('/')) continue
    try {
      matchers.push(globToRegExp(name))
    } catch {
      continue
    }
  }
  return matchers
}

/**
 * Top-level directories that are present and NOT gitignored — i.e. the
 * directories that are, or are about to be, part of the repo.
 *
 * Deliberately directories only. A new top-level FILE is almost always a build
 * input, and the derived "every root-level module vite.config.js imports must
 * deploy" assertion above already covers that class. A new top-level DIRECTORY
 * is a whole subsystem arriving with no derivation available at all — which is
 * exactly what `ios/` was.
 */
function unignoredTopLevelDirs(): string[] {
  const ignored = ignoredTopLevelMatchers()
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => name !== '.git' && !ignored.some((m) => m.test(name)))
    .sort()
}

describe('the denylist is reconciled against the repo (LIFT-1438)', () => {
  const dirs = unignoredTopLevelDirs()
  const command = deployGateCommand()

  it('enumerated the repo (the reconciliation is not vacuous)', () => {
    // If this ever ran on an empty listing, the completeness check below would
    // pass on nothing at all. `ios` is named because it is the entry this
    // whole guard exists for — the day it goes back to being gitignored, the
    // reconciliation stops watching it and should be re-thought, not silently
    // satisfied.
    expect(dirs).toContain('src')
    expect(dirs).toContain('public')
    expect(dirs).toContain('ios')
    // …and the gitignore filter is doing real work rather than passing
    // everything through.
    expect(dirs).not.toContain('node_modules')
    expect(dirs).not.toContain('dist')
  })

  it('every top-level directory has a verdict', () => {
    const unclassified = dirs.filter((d) => !(d in TOP_LEVEL_DEPLOYABILITY))
    expect(
      unclassified,
      `these need a verdict in TOP_LEVEL_DEPLOYABILITY — and, if they should not ` +
        `deploy, a matching exclusion in scripts/vercel-ignore-build.sh: ${unclassified.join(', ')}`,
    ).toEqual([])
  })

  it('no verdict names something the repo no longer has', () => {
    // The mirror image: LiftApp/ was deleted in #1429 and its denylist entry
    // went with it. A verdict left behind for a path that no longer exists is
    // a claim nothing checks, and it makes the list read as more complete than
    // it is.
    const missing = Object.keys(TOP_LEVEL_DEPLOYABILITY).filter(
      (entry) => !existsSync(resolve(ROOT, entry)),
    )
    expect(missing, `no longer present: ${missing.join(', ')}`).toEqual([])
  })

  it('the real gate agrees with every verdict', () => {
    // Evaluated by running the command, not by re-reading its pathspec: a
    // verdict that disagrees with what Vercel would actually do is worse than
    // no verdict, because it reads as a checked fact.
    const disagreements: string[] = []
    for (const [entry, verdict] of Object.entries(TOP_LEVEL_DEPLOYABILITY)) {
      // A directory is probed a few levels down — the `*.md` glob is
      // FNM_PATHNAME and never crosses a `/`, so a nested file is the case a
      // directory exclusion has to cover and a root-level one does not.
      const isDir = existsSync(resolve(ROOT, entry)) && statSync(resolve(ROOT, entry)).isDirectory()
      const path = isDir ? `${entry}/nested/deeper/file.txt` : entry
      const actual: Deployability = deploysWhenTouching([path], command) ? 'deploy' : 'skip'
      if (actual !== verdict) disagreements.push(`${path}: expected ${verdict}, gate says ${actual}`)
    }
    expect(disagreements).toEqual([])
  })
})
