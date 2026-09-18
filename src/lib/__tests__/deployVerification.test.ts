import { describe, it, expect, afterAll } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parse } from 'yaml'
// The domain reader `smoke-test-production` runs. Imported, not
// re-implemented: these tests must exercise the code CI executes. The wiring
// tests below pin READER_PATH against the script the workflow invokes, and
// that script against this module.
import { main as readLiveDomainCli, parseLiveDomain } from '../../../scripts/live-domain.mjs'
// Same arrangement for the "is production serving this commit?" decision
// (LIFT-1414): the logic lives in a module the workflow reaches through a thin
// CLI, and CHECKER_PATH is pinned against the script the workflow invokes.
import {
  main as checkDeployedCommitCli,
  EXIT,
  VERDICTS,
  VERDICT_EXIT,
} from '../../../scripts/deployed-commit.mjs'

const READER_PATH = 'scripts/read-live-domain.mjs'
const READER_LIB = 'live-domain.mjs'
const CHECKER_PATH = 'scripts/check-deployed-commit.mjs'
const CHECKER_LIB = 'deployed-commit.mjs'

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

/** The step in `smoke-test-production` that polls production for this commit. */
function verifyStepOf(jobs: Record<string, Job>): Step | undefined {
  return (jobs['smoke-test-production']?.steps ?? []).find((s) =>
    /verify production/i.test(s.name ?? ''),
  )
}

/**
 * The body of one `if`/`elif` branch of a shell conditional, starting at the
 * variable it tests. Sliced to the next `elif`/`else`/`fi` rather than to the
 * first `else` in the string — notify-deploy's conditional has three arms, and
 * `indexOf('else')` skips straight past `elif` to the last one.
 */
function branchTesting(run: string, variable: string): string {
  const start = run.indexOf(`$${variable}`)
  if (start === -1) return ''
  const rest = run.slice(start)
  const end = rest.search(/\n\s*(elif|else|fi)\b/)
  return end === -1 ? rest : rest.slice(0, end)
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
      const skippedBranch = branchTesting(run, envName as string)
      expect(skippedBranch).toMatch(/MSG=".+"/)
      expect(skippedBranch).not.toMatch(/deployed to production/i)
      expect(skippedBranch).not.toMatch(/verified live/i)
    })
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
    expect(parseLiveDomain(`# Lift\n\n${line}\n\nmore docs\n`)).toEqual({
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
    ['there is no **Live:** line at all', '# Lift\n\nNo deployment recorded.\n'],
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

// ---------------------------------------------------------------------------
// LIFT-1414: production may legitimately be serving a NEWER commit than this one.
//
// The production alias serves the LATEST ready deployment and nothing else, so
// whenever two master pushes land closer together than this job's own
// dependencies take to run (`build-and-test` + `e2e` + `migrate-db`, ~5-6
// minutes), the alias has already moved past the commit under verification
// before the first poll. An exact-match test then waits out its full 300s
// budget for a SHA that can never come back, fails, and fires
// `🔴 Post-merge CI failed on master` for a deploy that succeeded — which is
// what #1400 and #1404 did on 2026-09-13, 26 seconds apart, both READY.
//
// master is linear, so a later commit CONTAINS this one and production serving
// a descendant means this commit's code is live. The decision therefore lives
// in scripts/deployed-commit.mjs and is EXECUTED here against a real git
// repository: the direction of an ancestry question is exactly the kind of
// thing that is easy to write backwards and invisible to any assertion over
// the text of the expression that asks it.
// ---------------------------------------------------------------------------

/**
 * A throwaway repository with a real history:
 *
 *     A ── B ── C        (the master line)
 *      \
 *       X               (a commit on neither side of B)
 *
 * Isolated from the developer's own git config — a global `commit.gpgsign` or
 * hooks path would otherwise reach in and make this fail on one machine only.
 */
function buildAncestryFixture() {
  const repo = mkdtempSync(join(tmpdir(), 'lift-deploy-ancestry-'))
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }

  const run = (args: string[]) => {
    const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', env })
    return { status: typeof result.status === 'number' ? result.status : 128, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
  }
  const git = (args: string[]) => {
    const result = run(args)
    if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`)
    return result.stdout.trim()
  }

  git(['init', '--quiet'])
  git(['config', 'user.email', 'ci@example.test'])
  git(['config', 'user.name', 'CI'])
  git(['config', 'commit.gpgsign', 'false'])

  const commit = (body: string) => {
    writeFileSync(join(repo, 'file.txt'), body)
    git(['add', 'file.txt'])
    git(['commit', '--quiet', '--no-verify', '-m', body])
    return git(['rev-parse', 'HEAD'])
  }

  const A = commit('a')
  const B = commit('b')
  const C = commit('c')
  // Deliberately by SHA, so this never depends on the default branch name.
  git(['checkout', '--quiet', '-b', 'side', A])
  const X = commit('x')

  return { repo, A, B, C, X, runGit: (args: string[]) => run(args) }
}

describe('production may serve a commit NEWER than this one (LIFT-1414)', () => {
  const jobs = loadJobs()
  const { repo, A, B, C, X, runGit } = buildAncestryFixture()
  afterAll(() => rmSync(repo, { recursive: true, force: true }))

  /** The checker CI runs, pointed at the fixture repo but otherwise untouched. */
  function check(expected: string, deployed: string) {
    const out: string[] = []
    const err: string[] = []
    const status = checkDeployedCommitCli(
      [expected, deployed],
      (l) => out.push(l),
      (l) => err.push(l),
      runGit,
    )
    return { status, stdout: out.join('\n'), stderr: err.join('\n') }
  }

  it('the verification step runs the checker these tests import', () => {
    // Derived from the workflow, not restated: renaming the script fails this
    // until the import at the top of this file follows, which is what keeps
    // these tests exercising the code CI actually executes.
    const run = verifyStepOf(jobs)?.run ?? ''
    const invoked = run.match(/node (scripts\/[\w.-]+\.mjs) "\$EXPECTED_SHA"/)?.[1]
    expect(invoked, 'the poll loop must decide via `node scripts/<checker>.mjs`').toBe(CHECKER_PATH)

    // …and that script must be a wrapper over the module tested below rather
    // than a second copy of the rule, for the same reason read-live-domain.mjs
    // is: it ends in a process exit code and carries no entry guard that could
    // silently decline to run.
    expect(readFileSync(resolve(ROOT, CHECKER_PATH), 'utf8')).toContain(`from './${CHECKER_LIB}'`)
  })

  it('the checkout fetches the history the ancestry question needs', () => {
    // `merge-base --is-ancestor` can only answer about commits this checkout
    // holds. `fetch-depth: 2` is all the deploy gate's `HEAD^ HEAD` diff needs,
    // and under it every superseding commit resolves as `unknown` — not a
    // pass — so the job silently reverts to the exact-match behaviour this
    // issue is about while every assertion below still passes.
    const checkout = (jobs['smoke-test-production']?.steps ?? []).find((s) =>
      (s.uses ?? '').startsWith('actions/checkout'),
    )
    expect(checkout, 'expected smoke-test-production to check out the repo').toBeDefined()
    expect(checkout?.with?.['fetch-depth']).toBe(0)
  })

  it.each([
    ['production serves exactly this commit', () => [B, B], 'serving', EXIT.verified],
    ['a later master commit has superseded it', () => [B, C], 'superseded', EXIT.verified],
    ['production is still on an earlier commit', () => [B, A], 'stale', EXIT.waiting],
    ['production serves a commit on neither side', () => [B, X], 'unrelated', EXIT.waiting],
    ['the deployed commit is not in this checkout', () => [B, '0'.repeat(40)], 'unknown', EXIT.unknownHistory],
    ['version.json carried no commit', () => [B, ''], 'absent', EXIT.waiting],
    ['version.json carried something that is not a SHA', () => [B, 'not-a-sha'], 'malformed', EXIT.waiting],
    ['production reports the same commit in short form', () => [B, B.slice(0, 10)], 'serving', EXIT.verified],
  ])('reports %s', (_case, shas, verdict, status) => {
    const [expected, deployed] = shas()
    const result = check(expected, deployed)
    expect(result.stdout.split(':')[0], result.stdout).toBe(verdict)
    expect(result.status, result.stdout).toBe(status)
    // The workflow reads the verdict name off the front of this line with
    // `${VERDICT%%:*}`, so the separator is load-bearing, not cosmetic.
    expect(result.stdout).toMatch(new RegExp(`^${verdict}: \\S`))
  })

  it('every verdict the module can report is exercised above', () => {
    // Otherwise a verdict could be added with no test and no exit code anyone
    // has ever seen the workflow take.
    const covered = new Set(
      [
        [B, B],
        [B, C],
        [B, A],
        [B, X],
        [B, '0'.repeat(40)],
        [B, ''],
        [B, 'not-a-sha'],
      ].map(([expected, deployed]) => check(expected, deployed).stdout.split(':')[0]),
    )
    expect([...covered].sort()).toEqual([...VERDICTS].sort())
  })

  it('an unverifiable EXPECTED_SHA stops the job instead of polling for 300s', () => {
    // The LIFT-1412 posture: a broken input is an error reported in one second,
    // never five minutes of polling blamed on the Vercel deploy.
    const result = check('', B)
    expect(result.status).toBe(EXIT.badInput)
    expect(result.stdout).toBe('')
    expect(result.stderr).toMatch(/check-deployed-commit/)

    const run = verifyStepOf(jobs)?.run ?? ''
    expect(run).toContain(`${EXIT.badInput})`)
    expect(run).toMatch(/::error::EXPECTED_SHA/)
  })

  it('an exact match is decided without consulting git at all', () => {
    // The common case must stay answerable in a checkout with no history —
    // otherwise a future shallow-clone change would break the ordinary path,
    // not just the superseded one.
    const exploding = () => {
      throw new Error('git must not be consulted for an exact match')
    }
    expect(checkDeployedCommitCli([B, B], () => {}, () => {}, exploding)).toBe(EXIT.verified)
    expect(checkDeployedCommitCli([B, ''], () => {}, () => {}, exploding)).toBe(EXIT.waiting)
  })

  it('the poll loop acts on every outcome the checker can report', () => {
    // Derived from the module: a new exit code meant to change what the loop
    // does would otherwise land with no arm and silently behave as "keep
    // polling". `waiting` is deliberately the fall-through and has no arm.
    const run = verifyStepOf(jobs)?.run ?? ''
    const caseBody = run.slice(run.indexOf('case "$STATUS" in'))
    expect(caseBody, 'expected the poll loop to branch on the checker exit code').not.toBe('')
    const handled = new Set([...caseBody.matchAll(/^\s*(\d+)\)/gm)].map((m) => Number(m[1])))

    for (const code of new Set(Object.values(VERDICT_EXIT))) {
      if (code === EXIT.waiting) continue
      expect(handled, `exit code ${code} has no arm in the poll loop`).toContain(code)
    }
  })

  it('an unknown deployed commit deepens history rather than passing', () => {
    // A master push that landed AFTER this job's checkout is not in the object
    // store, so ancestry is unanswerable. Fetching is what closes that window;
    // treating it as a pass would be the rubber stamp this whole job exists to
    // avoid.
    expect(check(B, '0'.repeat(40)).status).toBe(EXIT.unknownHistory)
    const run = verifyStepOf(jobs)?.run ?? ''
    const arm = run.slice(run.indexOf(`${EXIT.unknownHistory})`))
    expect(arm.slice(0, arm.indexOf(';;'))).toMatch(/git fetch/)
  })

  it('the checker would have caught the original false failure (self-test)', () => {
    // Proves the cases above are not vacuous: the rule as it shipped was a
    // string comparison in bash, and it answers the opposite way on the one
    // case this issue is about.
    const oldExactMatch = (expected: string, deployed: string) => deployed === expected

    expect(oldExactMatch(B, C)).toBe(false) // 300s of polling, then a red Slack ping
    expect(check(B, C).status).toBe(EXIT.verified)

    // …and it has not become a rubber stamp. A deploy that genuinely stalled
    // leaves production on an EARLIER commit, and that still fails.
    expect(check(B, A).status).not.toBe(EXIT.verified)
    expect(check(B, X).status).not.toBe(EXIT.verified)
  })

  describe('Slack says which of the two happened', () => {
    const smoke = jobs['smoke-test-production']
    const verifyId = verifyStepOf(jobs)?.id
    const notify = (jobs['notify-deploy']?.steps ?? []).find((s) => /notify slack/i.test(s.name ?? ''))

    it('the verification step publishes a supersession as a job output', () => {
      expect(verifyId, 'the verify step needs an id to be referenced as an output').toBeTruthy()

      const run = verifyStepOf(jobs)?.run ?? ''
      // Keyed on the module's own verdict name, so renaming the verdict breaks
      // here rather than silently never setting the flag.
      expect(VERDICTS).toContain('superseded')
      expect(run).toContain('"superseded"')
      expect(run).toMatch(/superseded=true" >> "\$GITHUB_OUTPUT"/)

      const exposed = Object.values(smoke?.outputs ?? {}).find((v) =>
        v.includes(`steps.${verifyId}.outputs.superseded`),
      )
      expect(exposed, `smoke-test-production must expose steps.${verifyId}.outputs.superseded`).toBeDefined()
    })

    it('notify-deploy reads it and does not claim a plain verified deploy', () => {
      const outputName = Object.entries(smoke?.outputs ?? {}).find(([, v]) =>
        v.includes(`steps.${verifyId}.outputs.superseded`),
      )?.[0]
      expect(outputName).toBeDefined()

      // Via env, not inline `${{ }}` in the bash body — the same
      // script-injection guard as the commit message beside it.
      const envName = Object.entries(notify?.env ?? {}).find(
        ([, v]) =>
          v.includes('needs.smoke-test-production.outputs') && v.includes(outputName as string),
      )?.[0]
      expect(envName, 'notify-deploy must read the supersession via env').toBeDefined()

      const run = notify?.run ?? ''
      expect(run).toMatch(new RegExp(`\\[ "\\$${envName}" = "true" \\]`))

      // It is still a successful deploy — this commit's code IS live — so the
      // branch keeps claiming one, and says how it got there. What it must not
      // do is read identically to a deploy that was promoted on its own.
      const branch = branchTesting(run, envName as string)
      expect(branch).toMatch(/MSG=".+"/)
      const messages = [...run.matchAll(/MSG="([^"]*)"/g)].map((m) => m[1])
      expect(
        new Set(messages).size,
        'two branches of the notification say exactly the same thing',
      ).toBe(messages.length)
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
