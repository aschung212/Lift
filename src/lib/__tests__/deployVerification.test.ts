import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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
  with?: Record<string, unknown>
}
interface Job {
  needs?: string | string[]
  if?: string
  outputs?: Record<string, string>
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

/** The step in `smoke-test-production` that polls production. */
function verifyStepOf(jobs: Record<string, Job>): Step | undefined {
  return (jobs['smoke-test-production']?.steps ?? []).find((s) =>
    /verify production/i.test(s.name ?? ''),
  )
}

/** The step in `smoke-test-production` that writes the deploy decision. */
function gateStepOf(jobs: Record<string, Job>): Step | undefined {
  // Derived from the workflow rather than hardcoding the step id: the step
  // that writes the gate decision is whichever one writes `skip=` to
  // GITHUB_OUTPUT.
  return (jobs['smoke-test-production']?.steps ?? []).find((s) =>
    /skip=.*GITHUB_OUTPUT/s.test(s.run ?? ''),
  )
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
    const smoke = jobs['smoke-test-production']
    const gateStep = gateStepOf(jobs)

    it('the gate step has an id and publishes its decision as a job output', () => {
      expect(gateStep, 'expected a step writing skip= to GITHUB_OUTPUT').toBeDefined()
      expect(gateStep?.id, 'the gate step needs an id to be referenced as an output').toBeTruthy()

      const outputs = smoke?.outputs ?? {}
      const exposed = Object.values(outputs).find((v) =>
        v.includes(`steps.${gateStep?.id}.outputs.skip`),
      )
      expect(
        exposed,
        `smoke-test-production must expose steps.${gateStep?.id}.outputs.skip`,
      ).toBeDefined()
    })

    it('the verification step is the one gated on that decision', () => {
      expect(verifyStepOf(jobs)?.if ?? '').toContain(`steps.${gateStep?.id}.outputs.skip`)
    })

    it('notify-deploy reads the gate decision and branches its message', () => {
      const outputName = Object.entries(smoke?.outputs ?? {}).find(([, v]) =>
        v.includes(`steps.${gateStep?.id}.outputs.skip`),
      )?.[0]
      expect(outputName).toBeDefined()

      const step = (jobs['notify-deploy']?.steps ?? []).find((s) =>
        /notify slack/i.test(s.name ?? ''),
      )
      // Consumed via env, not inline `${{ }}` in the bash body — same
      // script-injection guard as the commit message beside it.
      const envValues = Object.values(step?.env ?? {})
      const wired = envValues.find(
        (v) => v.includes('needs.smoke-test-production.outputs') && v.includes(outputName as string),
      )
      expect(wired, 'notify-deploy must read the deploy-skipped output via env').toBeDefined()

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

// ---------------------------------------------------------------------------
// LIFT-1414: a deploy a LATER push superseded is a pass, not a false failure.
//
// `smoke-test-production` does not start until build-and-test + e2e +
// migrate-db have finished (~6 minutes), and the production alias only ever
// serves the LATEST ready deployment. So two master pushes landing closer
// together than that leave the first one's job polling for a SHA production
// has already moved past and can never report again: it burns its full 300s
// budget and posts "🔴 Post-merge CI failed" for a deploy that succeeded.
// That is not hypothetical — #1400, #1404 and #1409 merged ~90s apart on
// 2026-09-14, all three reached READY on Vercel, and the #1400 run still
// cried failure.
//
// Success is therefore "production serves this commit OR a descendant of it".
// A descendant is a strictly stronger result than an exact match: the build
// being served CONTAINS this commit's code, whether or not this commit's own
// Vercel build was the one that landed. A commit that does NOT contain this
// one still fails, which is the guarantee LIFT-1167 built the job for.
//
// These tests EXECUTE the real classifier against throwaway git repositories
// rather than asserting on the text of the comparison — the defect was a
// comparison that could never be true, and a string assertion over it reads
// exactly the same either way. Same argument as the ignoreCommand evaluator
// below, on the same job.
// ---------------------------------------------------------------------------

describe('accepting a deploy that a later push superseded (LIFT-1414)', () => {
  const jobs = loadJobs()

  /**
   * The classifier is located through the workflow, not hardcoded: whatever
   * script the verification step actually runs is the one under test, so a
   * rename fails here instead of leaving these assertions pointed at a file
   * CI no longer calls.
   */
  function classifierScript(): string {
    const run = verifyStepOf(jobs)?.run ?? ''
    const match = run.match(/bash (scripts\/[\w.-]+\.sh)/)
    if (!match) {
      throw new Error('the verification step does not invoke a scripts/*.sh classifier')
    }
    return resolve(ROOT, match[1])
  }

  let repo = ''
  // A → B → C on the main line; D forks off A. B is "the next push", the one
  // whose deploy replaces A's before A's job gets to look.
  const sha: Record<'A' | 'B' | 'C' | 'D', string> = { A: '', B: '', C: '', D: '' }

  function git(...args: string[]): string {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: gitEnv() }).trim()
  }

  /**
   * Identity via env vars and config files pointed at a path that does not
   * exist, so the run is hermetic: no `user.email`, `commit.gpgsign` or
   * template from the machine's own git config can reach it.
   */
  function gitEnv(): NodeJS.ProcessEnv {
    const nowhere = join(repo, 'no-such-gitconfig')
    return {
      ...process.env,
      GIT_CONFIG_GLOBAL: nowhere,
      GIT_CONFIG_SYSTEM: nowhere,
      GIT_AUTHOR_NAME: 'Lift CI',
      GIT_AUTHOR_EMAIL: 'ci@example.invalid',
      GIT_COMMITTER_NAME: 'Lift CI',
      GIT_COMMITTER_EMAIL: 'ci@example.invalid',
    }
  }

  function classify(expected: string, deployed: string): string {
    return execFileSync('bash', [classifierScript(), expected, deployed], {
      cwd: repo,
      encoding: 'utf8',
      env: gitEnv(),
    }).trim()
  }

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'lift-deploy-'))
    git('-c', 'init.defaultBranch=master', 'init', '-q')
    for (const name of ['A', 'B', 'C'] as const) {
      git('commit', '-q', '--allow-empty', '-m', name)
      sha[name] = git('rev-parse', 'HEAD')
    }
    git('checkout', '-q', '-b', 'side', sha.A)
    git('commit', '-q', '--allow-empty', '-m', 'D')
    sha.D = git('rev-parse', 'HEAD')
  })

  afterAll(() => {
    if (repo) rmSync(repo, { recursive: true, force: true })
  })

  it('the old string-equality rule would have failed here (self-test)', () => {
    // The exact shape of the 2026-09-14 false alarm: A's job looks at
    // production six minutes later and finds B, the next push, already live.
    // Proves these assertions are not vacuous — the two rules disagree on the
    // same pair of commits.
    expect(sha.B).not.toBe(sha.A) // the old rule: never matches, polls to timeout
    expect(classify(sha.A, sha.B)).toBe('descendant') // the new one: A's code is live
  })

  it('accepts the commit itself', () => {
    expect(classify(sha.A, sha.A)).toBe('exact')
  })

  it('accepts a commit several pushes later', () => {
    // Three PRs merged in a row is what actually happened; the first one's job
    // can find the third one's commit in production, not just the second's.
    expect(classify(sha.A, sha.C)).toBe('descendant')
  })

  it('still fails when production is serving an ancestor', () => {
    // The failure LIFT-1167 exists to catch: the Vercel build failed, so the
    // PREVIOUS deployment is still live and answers 200 quite happily.
    expect(classify(sha.C, sha.A)).toBe('stale')
  })

  it('still fails when production is serving a commit off another line', () => {
    // Neither ancestor nor descendant. "Not older" is not the rule — "contains
    // this commit" is, so a diverged history must not slip through as a pass.
    expect(classify(sha.D, sha.B)).toBe('stale')
    expect(classify(sha.B, sha.D)).toBe('stale')
  })

  it.each([
    ['nothing at all (version.json missing or unparseable)', ''],
    ['a value that is not a git object name', 'not-a-sha'],
    ['a well-formed SHA this clone does not have', 'deadbeef'.repeat(5)],
  ])('cannot classify %s, so it keeps polling rather than passing', (_label, deployed) => {
    expect(classify(sha.A, deployed)).toBe('unknown')
  })

  it.each([['--help'], ['-n'], ['--upload-pack=touch /tmp/pwned']])(
    'refuses to hand git the option-shaped value %s',
    (deployed) => {
      // version.json comes off the public internet, so its `commit` is treated
      // as untrusted input: anything that is not plain hex never reaches git
      // as an object name.
      expect(classify(sha.A, deployed)).toBe('unknown')
    },
  )

  it('the verification step delegates the ancestry decision to that script', () => {
    const run = verifyStepOf(jobs)?.run ?? ''
    expect(run).toContain('EXPECTED_SHA')
    // …and accepts BOTH outcomes. Wiring the classifier in but only honouring
    // `exact` would reproduce the bug with more steps.
    expect(run).toContain('descendant')
  })

  it('re-fetches master when the deployed commit is not in the clone', () => {
    // A push that lands DURING the poll window is not in a clone made before
    // it, so it classifies as `unknown`. Writing that off would re-create the
    // false failure for the narrower race this fix exists to tolerate.
    const run = verifyStepOf(jobs)?.run ?? ''
    expect(run, 'the step must branch on the `unknown` classification').toMatch(
      /\[\s*"\$STATUS"\s*=\s*unknown\s*\]/,
    )
    expect(run, 'and re-fetch before writing that commit off').toContain('git fetch')
  })

  it('the smoke test checks out full history, so both commits are present', () => {
    // A depth-limited fetch of `github.sha` contains only that commit's
    // ANCESTORS — the superseding commit would not be in the clone at all, and
    // every poll would answer `unknown`.
    const checkout = (jobs['smoke-test-production']?.steps ?? []).find((s) =>
      (s.uses ?? '').startsWith('actions/checkout'),
    )
    expect(checkout, 'expected smoke-test-production to check out the repo').toBeDefined()
    expect(checkout?.with?.['fetch-depth']).toBe(0)
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
