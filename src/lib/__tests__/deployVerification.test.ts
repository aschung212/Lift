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
      const verify = (jobs['smoke-test-production']?.steps ?? []).find((s) =>
        /verify production/i.test(s.name ?? ''),
      )
      // Read off the deploy job's output rather than re-derived here: one
      // derivation of "did this commit deploy", so the gate and the check
      // cannot disagree and strand this job polling for a deploy that never
      // happened.
      expect(verify?.if ?? '').toContain(`needs.deploy-production.outputs.${outputName}`)
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
    const verify = (jobs['smoke-test-production']?.steps ?? []).find((s) =>
      /version|verify/i.test(s.name ?? ''),
    )
    const run = verify?.run ?? ''
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
    const verify = (jobs['smoke-test-production']?.steps ?? []).find((s) =>
      /version|verify/i.test(s.name ?? ''),
    )
    const run = verify?.run ?? ''
    const emptyProbeGuard = run.indexOf('[ -z "$HEADERS" ]')
    expect(
      emptyProbeGuard,
      'expected an empty-probe branch before the CSP failure',
    ).toBeGreaterThan(-1)
    // …and it has to come FIRST, or the failure branch claims the empty probe.
    expect(emptyProbeGuard).toBeLessThan(run.indexOf('no Content-Security-Policy header'))
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
