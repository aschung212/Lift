import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
