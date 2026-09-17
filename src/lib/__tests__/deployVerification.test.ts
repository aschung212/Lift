import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
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
      const verify = (smoke?.steps ?? []).find((s) => /verify production/i.test(s.name ?? ''))
      expect(verify?.if ?? '').toContain(`steps.${gateStep?.id}.outputs.skip`)
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
    // Anything else and the gate answers for the wrong pair of commits — so
    // whatever `fetch-depth` smoke-test-production checks out with has to
    // reach HEAD^. It is now 0 (full history) for the ancestry check below,
    // which subsumes the fetch-depth: 2 this originally rode on.
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

// ---------------------------------------------------------------------------
// LIFT-1414: a deploy a LATER master push superseded is still a successful
// deploy of this commit.
//
// The verify step compared the two SHAs with string equality, which silently
// assumed at most one master push lands inside the job's own runtime window.
// It does not: the job waits on build-and-test + e2e + migrate-db (~6 minutes,
// e2e alone 3-4), the production alias only ever serves the LATEST ready
// deployment, and master runs serialize behind `concurrency`. Merging two PRs
// 90 seconds apart therefore left the first run polling for a SHA production
// had already moved past and could never report again — it burned the full
// 300s and posted a red "Post-merge CI failed" for a deploy that reached READY
// (2026-09-14: #1400, #1404 and #1409 in a row, all three deployed).
//
// The decision now lives in scripts/classify-deployed-commit.sh so these tests
// can EXECUTE it against throwaway git repos rather than assert on the text of
// a comparison. That is the point: the defect was a comparison that could
// never be true, and a string assertion over one reads identically whether it
// is right or wrong — the same argument that made the LIFT-1354 evaluator run
// the real ignoreCommand.
//
// Why nothing caught it before: every existing assertion here is about the
// wiring (does notify-deploy need this job, does the step read CLAUDE.md) and
// about the one-push-at-a-time case, which string equality handles correctly.
// The arrangement that exposes it is a second push landing before the first
// job polls, which no test modelled because the comparison was never executed.
// ---------------------------------------------------------------------------

/**
 * Path to the classification script, derived from the workflow step that
 * invokes it rather than hardcoded — a rename has to reach both.
 */
function classifyScriptPath(): string {
  const run = verifyStepOf(loadJobs())?.run ?? ''
  const match = run.match(/bash (\S*classify[\w-]*\.sh)\b/)
  if (!match) {
    throw new Error('the verify step does not delegate to a classify-*.sh script')
  }
  return resolve(ROOT, match[1])
}

/** Every word the classification script can print. */
function classifyVocabulary(): Set<string> {
  const source = readFileSync(classifyScriptPath(), 'utf8')
  return new Set([...source.matchAll(/^\s*echo ([a-z]+)\s*$/gm)].map((m) => m[1]))
}

describe('the deployed commit is classified by ancestry, not equality (LIFT-1414)', () => {
  const script = classifyScriptPath()
  let repo = ''
  // A → B → C on the main line; D diverges from A.
  let A = ''
  let B = ''
  let C = ''
  let D = ''

  // A throwaway repo, isolated from the machine's git config: a global
  // commit.gpgsign or core.hooksPath would otherwise decide whether this
  // fixture can be built at all.
  const GIT_ENV = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_AUTHOR_NAME: 'Lift CI Test',
    GIT_AUTHOR_EMAIL: 'ci@example.invalid',
    GIT_COMMITTER_NAME: 'Lift CI Test',
    GIT_COMMITTER_EMAIL: 'ci@example.invalid',
  }

  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: GIT_ENV }).trim()

  const commit = (message: string) => {
    writeFileSync(join(repo, 'file.txt'), message)
    git('add', 'file.txt')
    git('commit', '--quiet', '--no-gpg-sign', '-m', message)
    return git('rev-parse', 'HEAD')
  }

  /** Run the real script, in the throwaway repo, exactly as ci.yml does. */
  const classify = (expected: string, deployed: string) =>
    execFileSync('bash', [script, expected, deployed], {
      cwd: repo,
      encoding: 'utf8',
      env: GIT_ENV,
    }).trim()

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'lift-deploy-classify-'))
    git('init', '--quiet', '-b', 'master')
    A = commit('A')
    B = commit('B')
    C = commit('C')
    git('checkout', '--quiet', '-b', 'side', A)
    D = commit('D')
    git('checkout', '--quiet', 'master')
  }, 30000)

  afterAll(() => {
    if (repo) rmSync(repo, { recursive: true, force: true })
  })

  it('reports `exact` for the commit itself', () => {
    expect(classify(A, A)).toBe('exact')
  })

  it('reports `descendant` when a later master commit superseded this deploy', () => {
    // The 2026-09-14 case: #1400 pushed A, #1404 pushed a descendant, and the
    // alias had moved on by the time #1400's job got to poll.
    expect(classify(A, C)).toBe('descendant')
    expect(classify(B, C)).toBe('descendant')
  })

  it('reports `ancestor` when production is serving an OLDER commit', () => {
    // This is the stale-deploy case LIFT-1167 exists to catch — a failed
    // Vercel build leaves the PREVIOUS deployment live, answering 200 — and
    // widening the rule to ancestry must not start passing it.
    expect(classify(C, A)).toBe('ancestor')
  })

  it('reports `unrelated` for a commit on a diverged line', () => {
    expect(classify(B, D)).toBe('unrelated')
    expect(classify(D, B)).toBe('unrelated')
  })

  it('reports `absent` for a well-formed commit this clone does not have', () => {
    // A commit pushed to master after the job checked out looks like this;
    // ci.yml answers it by fetching origin master once and re-asking. It is
    // deliberately distinct from `unknown` so the workflow re-fetches only
    // when a fetch could possibly help.
    expect(classify(A, '0'.repeat(39) + '1')).toBe('absent')
  })

  it.each([
    ['empty', ''],
    ['not hex', 'deadbeefzz'],
    ['too short to be an abbreviation', 'abc'],
    ['an option, not a SHA', '--upload-pack=touch /tmp/pwned'],
    ['a ref expression', 'master~1'],
    ['a shell substitution', '$(id)'],
  ])('fails closed on a deployed value that is %s', (_label, value) => {
    // version.json arrives from the public internet, so the value is
    // shape-checked before it is ever handed to git as an object name — junk
    // and option-shaped values never reach `git rev-parse`.
    expect(classify(A, value)).toBe('unknown')
  })

  it('the harness would have caught the original defect (self-test)', () => {
    // The rule as it shipped, verbatim: [ "$DEPLOYED_SHA" = "$EXPECTED_SHA" ].
    // Proves these assertions are not vacuous — the two rules disagree on the
    // superseded pair, and agree everywhere the old one was right.
    const oldRulePasses = (expected: string, deployed: string) => deployed === expected

    expect(oldRulePasses(A, C)).toBe(false) // false-failed the #1400 run
    expect(classify(A, C)).toBe('descendant') // …now a pass

    expect(oldRulePasses(C, A)).toBe(false)
    expect(classify(C, A)).toBe('ancestor') // …still a failure
    expect(oldRulePasses(A, A)).toBe(true)
    expect(classify(A, A)).toBe('exact')
  })
})

describe('smoke-test-production consumes the ancestry classification (LIFT-1414)', () => {
  const jobs = loadJobs()
  const verify = verifyStepOf(jobs)
  const run = verify?.run ?? ''

  it('checks out full history', () => {
    // A depth-limited fetch of github.sha contains only that commit's
    // ANCESTORS, so the superseding commit would not be in the clone at all
    // and every poll would classify as `absent`.
    const checkout = (jobs['smoke-test-production']?.steps ?? []).find((s) =>
      (s.uses ?? '').startsWith('actions/checkout'),
    )
    expect(checkout, 'expected smoke-test-production to check out the repo').toBeDefined()
    expect(checkout?.with?.['fetch-depth']).toBe(0)
  })

  it('delegates the comparison to the classification script', () => {
    expect(run).toMatch(/bash \S*classify[\w-]*\.sh/)
    // Both operands are passed positionally; neither is interpolated into the
    // bash body via ${{ }} (the notify jobs' script-injection guard).
    expect(run).toContain('"$EXPECTED_SHA"')
    expect(verify?.env?.EXPECTED_SHA).toBe('${{ github.sha }}')
  })

  it('treats exactly `exact` and `descendant` as a successful deploy', () => {
    // Located structurally: the success guard is the nearest `$STATUS` test
    // above the line that passes the job. Matching the first `$STATUS` test in
    // the step would find the `unknown` re-fetch branch instead.
    const lines = run.split('\n')
    const exitOk = lines.findIndex((l) => /^\s*exit 0\s*$/.test(l))
    expect(exitOk, 'expected the poll loop to exit 0 on success').toBeGreaterThan(0)
    const guard = lines.slice(0, exitOk).reverse().find((l) => /if \[ "\$STATUS" =/.test(l)) ?? ''
    const accepted = new Set([...guard.matchAll(/"\$STATUS" = "(\w+)"/g)].map((m) => m[1]))
    expect(accepted).toEqual(new Set(['exact', 'descendant']))

    // …and each of those is a word the script can actually print. A typo here
    // ("descendent") would never match and would silently re-create the exact
    // defect this issue is about: a comparison that can never be true.
    const vocabulary = classifyVocabulary()
    expect(vocabulary.size, 'expected the script to print literal status words').toBeGreaterThan(0)
    for (const status of accepted) {
      expect(vocabulary, `the script never prints "${status}"`).toContain(status)
    }
    // Every other word the script can print falls through to the poll's
    // timeout by NOT being listed — derived from the script, so a new status
    // is a failure by default rather than an unhandled one.
    for (const status of vocabulary) {
      if (status === 'exact' || status === 'descendant') continue
      expect(accepted, `"${status}" must not count as a successful deploy`).not.toContain(status)
    }
    expect(vocabulary).toContain('ancestor') // the LIFT-1167 stale-deploy case
  })

  it('re-fetches origin master for a deployed SHA the clone cannot resolve', () => {
    // A commit pushed DURING the poll window is absent from the checkout —
    // the same supersession race, one notch narrower — so `absent` re-asks
    // rather than being written off. `unknown` (junk, not an object name) is
    // deliberately NOT re-fetched: no fetch can make it resolvable.
    const marker = '"$STATUS" = "absent"'
    // Checked before the slice: indexOf returning -1 would silently slice the
    // last character and every assertion below would pass on it.
    expect(run, 'expected an `absent` branch in the poll loop').toContain(marker)
    const absentBranch = run.slice(run.indexOf(marker))
    expect(absentBranch).toMatch(/git fetch[^\n]*origin master/)
    expect(classifyVocabulary()).toContain('absent')
  })

  it('names the last observed commit and its classification when it gives up', () => {
    const error = run.split('\n').find((l) => l.includes('::error::Production never')) ?? ''
    expect(error, 'expected the timeout to emit an ::error:: annotation').not.toBe('')
    // "never reported X" alone sent the reader looking for a failed deploy
    // that had in fact succeeded; what production WAS serving is the fact that
    // distinguishes a stale deploy from a superseded one.
    expect(error).toMatch(/descendant/)
    expect(error).toContain('$LAST_STATUS')
    expect(error).toMatch(/LAST_SEEN/)
  })

  it('blames the HTML, not Vercel, when the deploy matched but the shell never rendered', () => {
    // The same wrong-system report this issue is about, one branch over: a
    // poll that reached the success guard every attempt and failed only the
    // app-shell check would otherwise time out saying production "never
    // reported" a commit it had reported 30 times — now doubly contradictory,
    // since the message carries the classification ("classified exact") beside
    // the claim. The two failures blame different systems and must read
    // differently.
    const errors = run.split('\n').filter((l) => l.includes('::error::'))
    const shellError = errors.find((l) => /app-shell/i.test(l)) ?? ''
    expect(shellError, 'expected a distinct ::error:: for the app-shell failure').not.toBe('')
    expect(shellError).not.toMatch(/never reported/)
    expect(shellError).toContain('$LAST_SEEN')

    // Reached via a flag set inside the success branch rather than by
    // re-testing $STATUS: restating the accepted-status list here is the drift
    // the single guard above exists to prevent.
    const flag = run.match(/(\w+)=1\s*\n\s*echo "::warning::[^"]*app-shell/)?.[1]
    expect(flag, 'expected the app-shell miss to be recorded by a flag').toBeTruthy()
    expect(run).toMatch(new RegExp(`if \\[ "\\$${flag}" = "1" \\]`))
    expect(run).toMatch(new RegExp(`^\\s*${flag}=0\\s*$`, 'm'))
  })
})

// ---------------------------------------------------------------------------
// The poll loop itself, EXECUTED (LIFT-1414).
//
// Everything above this point asserts on the workflow's text or runs the
// classifier in isolation. Neither can see a bug in the loop that consumes it —
// a classification computed and then never read, a re-fetch that fires on
// every attempt, an error message that names the wrong system. So these run
// the real `run:` body out of ci.yml, in a throwaway git repo, against a fake
// `curl` on PATH, and assert on its exit status and output. Same argument as
// the LIFT-1354 ignoreCommand evaluator, one layer out: the defect was a
// comparison that could never be true, and no amount of reading the script
// tells you whether it is.
//
// The attempt budget is dialled down from 30×10s to 3×0s. That substitution is
// asserted, not assumed — silently failing to shrink it would park the suite
// on a 300-second poll rather than fail.
// ---------------------------------------------------------------------------
describe('the verify step, executed against a fake production (LIFT-1414)', () => {
  const GIT_ENV = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_AUTHOR_NAME: 'Lift CI Test',
    GIT_AUTHOR_EMAIL: 'ci@example.invalid',
    GIT_COMMITTER_NAME: 'Lift CI Test',
    GIT_COMMITTER_EMAIL: 'ci@example.invalid',
  }
  const gitIn = (cwd: string, ...args: string[]) =>
    // The detached-HEAD advice is a paragraph on stderr per checkout, and these
    // fixtures check out commits constantly.
    execFileSync('git', ['-c', 'advice.detachedHead=false', ...args], {
      cwd,
      encoding: 'utf8',
      env: GIT_ENV,
    }).trim()

  const temps: string[] = []
  const mkTemp = (prefix: string) => {
    const dir = mkdtempSync(join(tmpdir(), prefix))
    temps.push(dir)
    return dir
  }

  let origin = ''
  /** A bare snapshot of master taken BEFORE C existed, to clone stale work
   *  repos from — the "pushed during the poll window" case needs a clone that
   *  genuinely lacks the object, which no ref surgery on a full clone gives. */
  let seedAtB = ''
  let A = ''
  let B = ''
  let C = ''

  beforeAll(() => {
    origin = mkTemp('lift-deploy-origin-')
    gitIn(origin, 'init', '--quiet', '-b', 'master')
    const commit = (message: string) => {
      writeFileSync(join(origin, 'file.txt'), message)
      gitIn(origin, 'add', 'file.txt')
      gitIn(origin, 'commit', '--quiet', '--no-gpg-sign', '-m', message)
      return gitIn(origin, 'rev-parse', 'HEAD')
    }
    A = commit('A')
    B = commit('B')
    seedAtB = mkTemp('lift-deploy-seed-')
    gitIn(origin, 'clone', '--quiet', '--bare', '--no-hardlinks', origin, seedAtB)
    C = commit('C')
    // Detach so refs/heads/master stays at C for the fetch below.
    gitIn(origin, 'checkout', '--quiet', A)
  }, 60000)

  afterAll(() => {
    for (const dir of temps) rmSync(dir, { recursive: true, force: true })
  })

  /**
   * A workspace laid out the way the job's checkout leaves one, holding the
   * real script and a CLAUDE.md to read the domain out of. `stale: true`
   * clones the pre-C snapshot but points origin at the repo that has C, i.e.
   * a checkout taken before the superseding commit was pushed.
   */
  function makeWorkspace(stale: boolean): string {
    const work = mkTemp('lift-deploy-work-')
    gitIn(origin, 'clone', '--quiet', '--no-hardlinks', stale ? seedAtB : origin, work)
    if (stale) gitIn(work, 'remote', 'set-url', 'origin', origin)
    gitIn(work, 'checkout', '--quiet', stale ? B : A)

    mkdirSync(join(work, 'scripts'), { recursive: true })
    copyFileSync(classifyScriptPath(), join(work, 'scripts/classify-deployed-commit.sh'))
    // The domain is read out of CLAUDE.md, never hardcoded (the SEV1 rule), so
    // the fixture has to supply one — a .invalid TLD, which cannot resolve, so
    // a fake curl that failed to shadow the real one could not reach anything.
    writeFileSync(join(work, 'CLAUDE.md'), '**Live:** prod.example.invalid (test fixture)\n')

    // Fake curl: the URL is the last argument at both call sites. A canned
    // body missing from disk means "this request fails", which is what
    // `curl -f` does on a 5xx (exit 22).
    const bin = join(work, 'bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(
      join(bin, 'curl'),
      [
        '#!/usr/bin/env bash',
        'url="${*: -1}"',
        'case "$url" in',
        '  *version.json*) body="$PWD/fake-version.json" ;;',
        '  *) body="$PWD/fake-index.html" ;;',
        'esac',
        '[ -f "$body" ] || exit 22',
        'cat "$body"',
        '',
      ].join('\n'),
    )
    chmodSync(join(bin, 'curl'), 0o755)

    const body = (verifyStepOf(loadJobs())?.run ?? '')
      .replace('ATTEMPTS=30', 'ATTEMPTS=3')
      .replace('SLEEP=10', 'SLEEP=0')
    expect(body, 'the attempt budget must be dialled down, or this suite polls for 300s').toContain(
      'ATTEMPTS=3',
    )
    expect(body).toContain('SLEEP=0')
    writeFileSync(join(work, 'step.sh'), body)
    return work
  }

  /** Serve `version.json` / `index.html` (or neither) and run the step. */
  function poll(opts: {
    expected: string
    deployed?: string
    html?: string | null
    stale?: boolean
  }) {
    const work = makeWorkspace(opts.stale ?? false)
    if (opts.deployed !== undefined) {
      writeFileSync(join(work, 'fake-version.json'), JSON.stringify({ commit: opts.deployed }))
    }
    if (opts.html !== null) {
      writeFileSync(join(work, 'fake-index.html'), opts.html ?? '<html><div id="app"></div></html>')
    }
    const res = spawnSync('bash', ['step.sh'], {
      cwd: work,
      encoding: 'utf8',
      env: { ...GIT_ENV, PATH: `${join(work, 'bin')}:${process.env.PATH}`, EXPECTED_SHA: opts.expected, RUN_ID: 'test' },
    })
    return { status: res.status, out: `${res.stdout ?? ''}${res.stderr ?? ''}` }
  }

  it('passes when production reports this very commit', () => {
    const r = poll({ expected: A, deployed: A })
    expect(r.out).toMatch(/exact match against/)
    expect(r.status).toBe(0)
  })

  it('passes when a later master push already moved the alias past it', () => {
    // The 2026-09-14 failure, end to end: #1400's job polling after #1404's
    // deploy took the alias. Under string equality this burned 300s and went
    // red; the deploy it was reporting on had reached READY.
    const r = poll({ expected: A, deployed: C })
    expect(r.out).toMatch(/descendant match against/)
    expect(r.status).toBe(0)
  })

  it('still fails when production is serving an OLDER commit', () => {
    // LIFT-1167's whole reason for existing: a failed Vercel build leaves the
    // previous deployment live, answering 200. Widening to ancestry must not
    // pass that, and the error must say what was actually being served.
    const r = poll({ expected: C, deployed: A })
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/never reported/)
    expect(r.out).toMatch(/classified ancestor/)
  })

  it('fetches a commit pushed during the poll window, and then passes on it', () => {
    // Narrower than the supersession above: C is not in this clone at all, so
    // the classifier says `absent` and the loop has to go and get it before it
    // can answer. `absent` is a distinct word from `unknown` for exactly this
    // — it is the one status a re-fetch can change.
    const r = poll({ expected: B, deployed: C, stale: true })
    expect(r.out).toMatch(/fetching origin master/)
    expect(r.out).toMatch(/descendant match against/)
    expect(r.status).toBe(0)
  })

  it('fetches once per observed commit, not once per attempt', () => {
    // The once-per-SHA guard only earns its keep when the fetch SUCCEEDS and
    // the commit is STILL not there — a well-formed SHA on no branch of this
    // repo, e.g. a deployment promoted by hand, or a commit GitHub has not
    // propagated yet. Without the guard every attempt re-fetches; the case
    // above cannot see that, because one successful fetch stops the status
    // being `absent` at all.
    const r = poll({ expected: B, deployed: 'a'.repeat(40), stale: true })
    expect(r.out.match(/fetching origin master/g)).toHaveLength(1)
    expect(r.status).toBe(1)
  })

  it('never hands a junk version.json value to git', () => {
    // `unknown` is not re-fetched — no fetch makes junk resolvable — and an
    // option-shaped value must not reach `git rev-parse` as an argument.
    const r = poll({ expected: A, deployed: '--upload-pack=touch /tmp/pwned' })
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/\(unknown\)/)
    expect(r.out).not.toMatch(/fetching origin master/)
  })

  it('reports <none> when version.json is unreachable for the whole window', () => {
    const r = poll({ expected: A })
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/deployed=<none>/)
  })

  it('blames the HTML, not Vercel, when the commit matched but the shell never rendered', () => {
    const r = poll({ expected: A, deployed: A, html: '<html>no shell</html>' })
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/the deploy landed; the HTML it serves did not/)
    expect(r.out).not.toMatch(/never reported/)
  })
})
