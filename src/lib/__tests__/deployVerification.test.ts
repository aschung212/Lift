import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
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
// repo: a tracked top-level entry with no verdict fails this suite until
// someone writes one. The next `ios/` therefore forces its decision at the
// moment it is committed instead of silently inheriting the fail-safe default.
// ---------------------------------------------------------------------------

type Deployability = 'deploy' | 'skip'

/**
 * Every tracked top-level entry, and whether a commit touching only it should
 * reach production.
 *
 * A handful of entries marked 'deploy' are not build inputs at all
 * (`.gitattributes`, `.gitignore`, `.shellcheckrc`, `.run-browser-probe.sh`).
 * That is the denylist failing safe, and it is deliberately left as-is: those
 * files change close to never, and an occasional redundant build is the price
 * of the property that an unrecognised path deploys rather than silently not
 * deploying. `ios/` is different in kind — it is touched on every step toward
 * App Store submission.
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
 * Every tracked path in the repo, grouped by its top-level entry.
 *
 * `-z` because paths arrive unquoted that way — `git ls-files` otherwise
 * C-quotes anything non-ASCII, and `Screenshots/Lift — Workout Tracker.png`
 * would come back as a literal `"Screenshots\342\200\246"`.
 */
function trackedPathsByTopLevel(): Map<string, string[]> {
  let out: string
  try {
    out = execFileSync('git', ['ls-files', '-z'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch (err) {
    // Loud, never skipped. A reconciliation that cannot enumerate the repo
    // passes vacuously, which is the failure mode this guard exists to close.
    throw new Error(`could not run \`git ls-files\`: ${(err as Error).message}`, { cause: err })
  }
  const byEntry = new Map<string, string[]>()
  for (const path of out.split('\0').filter(Boolean)) {
    const entry = path.split('/')[0]
    const paths = byEntry.get(entry)
    if (paths) paths.push(path)
    else byEntry.set(entry, [path])
  }
  return byEntry
}

describe('the denylist is reconciled against the repo (LIFT-1438)', () => {
  const tracked = trackedPathsByTopLevel()
  const command = deployGateCommand()

  it('enumerated the repo (the reconciliation is not vacuous)', () => {
    // If this ever passed on an empty listing, every assertion below would
    // pass on nothing at all.
    expect(tracked.get('src')?.length ?? 0).toBeGreaterThan(100)
    expect(tracked.has('package.json')).toBe(true)
    expect(tracked.has('vercel.json')).toBe(true)
  })

  it('every tracked top-level entry has a verdict', () => {
    const unclassified = [...tracked.keys()].filter((e) => !(e in TOP_LEVEL_DEPLOYABILITY))
    expect(
      unclassified,
      `these need a verdict in TOP_LEVEL_DEPLOYABILITY — and, if they should not ` +
        `deploy, a matching exclusion in scripts/vercel-ignore-build.sh: ${unclassified.join(', ')}`,
    ).toEqual([])
  })

  it('no verdict names an entry the repo stopped tracking', () => {
    // The mirror image: LiftApp/ was deleted in #1429 and its denylist entry
    // went with it. A verdict left behind for a path that no longer exists is
    // a claim nothing checks.
    const stale = Object.keys(TOP_LEVEL_DEPLOYABILITY).filter((e) => !tracked.has(e))
    expect(stale, `no longer tracked: ${stale.join(', ')}`).toEqual([])
  })

  it('the real gate agrees with every verdict, on every tracked path', () => {
    // Evaluated against the paths git actually reports rather than a sample
    // somebody typed, so an entry that is only PARTIALLY excluded — the gap a
    // glob like `*.md` leaves inside a directory — cannot hide behind a
    // representative file that happens to land on the right side.
    const disagreements: string[] = []
    for (const [entry, paths] of tracked) {
      const verdict = TOP_LEVEL_DEPLOYABILITY[entry]
      if (!verdict) continue // already reported above
      for (const path of paths) {
        const actual: Deployability = deploysWhenTouching([path], command) ? 'deploy' : 'skip'
        if (actual !== verdict) disagreements.push(`${path}: expected ${verdict}, gate says ${actual}`)
      }
    }
    expect(disagreements).toEqual([])
  })
})
