/**
 * The deployment domain has ONE source, and every site resolves to it (LIFT-1453).
 *
 * The domain used to be a single fact with seven independent hardcoded copies —
 * `appMeta.ts`, `coachClient.ts`, `shareImage.ts`, `supabase.ts`, `api/coach.ts`,
 * `vercel.json`, `netlify.toml`, plus index.html's meta tags, robots/sitemap and
 * the App Store docs — and every test that pinned one pinned *its own* literal.
 * So a domain change (a custom domain at GA is the obvious trigger) could update
 * six sites, miss the seventh, and leave the whole suite green.
 *
 * Three of those copies are not cosmetic. `COACH_PROD_ORIGIN` is the origin the
 * NATIVE build sends; `ALLOWED_ORIGINS` in the function decides whether the
 * response carries `Access-Control-Allow-Origin`; the CSP `connect-src` decides
 * whether the WebView is allowed to make the request at all. Disagree on any one
 * and the AI Coach is refused on iOS and nowhere else — invisible to every web
 * test, and invisible to `coachClient.test.ts`, which asserts `coachEndpoint(true)`
 * against the very constant it is checking. `supabase.ts`'s copy fails in a worse
 * direction still: a stale hostname makes production look like a PREVIEW deploy,
 * which blocks every write for every user. `SHARE_CARD_HANDLE` is milder but
 * permanent — it is burnt into the pixels of every card already shared.
 *
 * Two layers here, and they fail in different directions:
 *
 *   1. COVERAGE — every site named above resolves to CLAUDE.md's `**Live:**`
 *      line, read through the same module CI's `smoke-test-production` runs. A
 *      copy left behind by a domain change is red.
 *   2. SPRAWL — a DERIVED sweep of every tracked file: none may name a
 *      deployment host other than the live one, and no file under `src/` or
 *      `api/` may carry a domain literal at all outside `appMeta.ts`. An
 *      enumerated list would only ever pin the copies that existed when it was
 *      written, which is exactly how seven of them accumulated.
 *
 * Note what collapsing the code copies onto `APP_HOSTNAME` already bought: the
 * `src/` and `api/` constants agree by CONSTRUCTION now, so there is nothing
 * left to assert about them beyond "they still read it". What remains is the set
 * of sites no import can reach — a JSON header value, HTML meta tags, two static
 * text files, a TOML comment and markdown — which is why this guard reads files
 * rather than values.
 */
/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { APP_HOSTNAME, APP_URL } from '../appMeta'
import { COACH_PROD_ORIGIN } from '../coachClient'
import { SHARE_CARD_HANDLE } from '../shareImage'
import { LIVE_DOMAIN, LIVE_ORIGIN, REPO_ROOT } from '../../__tests__/liveDomain'

const read = (path: string) => readFileSync(resolve(REPO_ROOT, path), 'utf-8')

/**
 * Any hostname on the deployment host family, plus the live domain itself.
 *
 * `*.vercel.app` is unambiguous in first-party source — no third party the app
 * talks to is on it (Supabase is `.supabase.co`, Sentry `.sentry.io`, Vercel
 * Analytics `vercel-insights.com`), so every match is a claim about OUR
 * deployment. Including the live domain in the pattern is what keeps the sweep
 * working after a move to a custom domain: the new copies match as the live one,
 * and any stale `*.vercel.app` left behind still matches and still fails.
 */
function deploymentHosts(content: string): string[] {
  const escaped = LIVE_DOMAIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(?:[A-Za-z0-9-]+\\.)+vercel\\.app|${escaped}`, 'g')
  return [...content.matchAll(pattern)].map((m) => m[0])
}

/** Host of an absolute URL, or the input unchanged when it is already bare. */
function hostOf(value: string): string {
  return /^[a-z]+:\/\//i.test(value) ? new URL(value).host : value
}

// ── Layer 1: coverage ────────────────────────────────────────────────────────

describe('deployment domain — every site resolves to CLAUDE.md (LIFT-1453)', () => {
  it('reads a plausible domain out of the **Live:** line', () => {
    // Floor. Everything below compares against this value, so a derivation that
    // silently produced junk would turn the whole file into `expect(x).toBe(x)`.
    expect(LIVE_DOMAIN).toMatch(/^[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$/)
    expect(LIVE_ORIGIN).toBe(`https://${LIVE_DOMAIN}`)
  })

  it('never names a fabricated or placeholder domain (SEV1, 2026-04-02)', () => {
    // The one thing deriving from CLAUDE.md cannot check on its own: if the
    // **Live:** line itself were edited to a hallucinated host, every assertion
    // below would follow it. This is the tripwire that does not — and it is why
    // the sibling suites that pin the domain as their own literal stay as they
    // are rather than being converted to read this one.
    //
    // CLAUDE.md's prose NAMES the hallucinated domain (that is the SEV1 rule's
    // whole point), so this reads the parsed value, never the file.
    for (const banned of ['liftracker', 'example.com', 'example.org', 'localhost', 'test.']) {
      expect(LIVE_DOMAIN, `**Live:** names ${banned}`).not.toContain(banned)
    }
  })

  it('APP_HOSTNAME and APP_URL are the live deployment', () => {
    expect(APP_HOSTNAME).toBe(LIVE_DOMAIN)
    expect(APP_URL).toBe(LIVE_ORIGIN)
  })

  /**
   * The native AI Coach call survives CORS only if all three agree. The first
   * two share one literal after LIFT-1453; the CSP lives in a JSON file that no
   * import can reach, so it is pinned here.
   */
  describe('native AI Coach CORS chain', () => {
    /**
     * `ALLOWED_ORIGINS` as the function will evaluate it: string literals
     * verbatim, and the `APP_URL` identifier resolved against the constant the
     * file imports. Throws rather than skipping an entry it cannot classify, so
     * a rewrite of that set fails here instead of quietly narrowing the check.
     */
    function allowedOrigins(): string[] {
      const source = read('api/coach.ts')
      expect(source, 'api/coach.ts no longer reads the origin from appMeta').toMatch(
        /import\s*\{\s*APP_URL\s*\}\s*from\s*'\.\.\/src\/lib\/appMeta'/,
      )

      const set = /const ALLOWED_ORIGINS = new Set\(\[([\s\S]*?)\]\)/.exec(source)
      if (!set) throw new Error('api/coach.ts: no ALLOWED_ORIGINS set — the extraction is stale')

      return set[1]
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
          const literal = /^'([^']*)'$/.exec(entry)
          if (literal) return literal[1]
          if (entry === 'APP_URL') return APP_URL
          throw new Error(
            `api/coach.ts: ALLOWED_ORIGINS entry ${entry} is neither a string literal nor APP_URL`,
          )
        })
    }

    it('the client calls the live origin', () => {
      expect(COACH_PROD_ORIGIN).toBe(LIVE_ORIGIN)
    })

    it("the function's CORS allowlist admits exactly that origin", () => {
      const origins = allowedOrigins()
      // Floor: the native origin is the reason this allowlist exists (#1442).
      expect(origins).toContain('capacitor://localhost')
      expect(origins).toContain(COACH_PROD_ORIGIN)
    })

    it('the CSP connect-src admits it too (LIFT-850)', () => {
      const config = JSON.parse(read('vercel.json')) as {
        headers: { headers: { key: string; value: string }[] }[]
      }
      const csp = config.headers
        .flatMap((rule) => rule.headers)
        .find((header) => header.key === 'Content-Security-Policy')?.value
      expect(csp, 'vercel.json declares no Content-Security-Policy').toBeDefined()

      const connectSrc = /connect-src\s+([^;]*)/.exec(csp as string)?.[1] ?? ''
      expect(connectSrc, 'the CSP declares no connect-src').not.toBe('')
      expect(connectSrc.split(/\s+/)).toContain(COACH_PROD_ORIGIN)
    })
  })

  it('the share-card watermark handle is the live host', () => {
    expect(SHARE_CARD_HANDLE).toBe(LIVE_DOMAIN)
  })

  it('index.html canonical, og:url, og:image and twitter:image are the live host', () => {
    const html = read('index.html')
    const tags: [string, RegExp][] = [
      ['canonical', /<link rel="canonical" href="([^"]+)"/],
      ['og:url', /<meta property="og:url" content="([^"]+)"/],
      ['og:image', /<meta property="og:image" content="([^"]+)"/],
      ['twitter:image', /<meta name="twitter:image" content="([^"]+)"/],
    ]
    for (const [name, pattern] of tags) {
      const value = pattern.exec(html)?.[1]
      expect(value, `index.html has no ${name}`).toBeDefined()
      expect(hostOf(value as string), `index.html ${name}`).toBe(LIVE_DOMAIN)
    }
  })

  it('robots.txt and sitemap.xml point at the live host', () => {
    const sitemapRef = /Sitemap:\s*(\S+)/.exec(read('public/robots.txt'))?.[1]
    expect(sitemapRef, 'robots.txt declares no Sitemap').toBeDefined()
    expect(hostOf(sitemapRef as string)).toBe(LIVE_DOMAIN)

    const loc = /<loc>([^<]+)<\/loc>/.exec(read('public/sitemap.xml'))?.[1]
    expect(loc, 'sitemap.xml declares no <loc>').toBeDefined()
    expect(hostOf(loc as string)).toBe(LIVE_DOMAIN)
  })

  it('the App Store submission URLs are the live host', () => {
    // These are what App Review and the App Privacy questionnaire are pointed
    // at; a stale privacy-policy URL is a rejected submission, not a typo.
    for (const doc of ['docs/app-store/README.md', 'docs/app-store/listing.md']) {
      const hosts = deploymentHosts(read(doc))
      expect(hosts.length, `${doc} names no deployment URL`).toBeGreaterThan(0)
      expect(new Set(hosts), doc).toEqual(new Set([LIVE_DOMAIN]))
    }
  })
})

// ── Layer 2: sprawl ──────────────────────────────────────────────────────────

/** Text formats a copy of the domain could hide in. Binary and vendored trees have none. */
const SWEEP_EXTENSIONS = /\.(ts|tsx|js|mjs|cjs|vue|json|html|md|txt|xml|yml|yaml|sh|toml)$/

/**
 * Every TRACKED file, because that is what CI checks out and what ships.
 *
 * Deliberately `git ls-files` rather than a filesystem walk of a root list:
 * a root list goes stale the day a new top-level subsystem appears (the LIFT-1438
 * lesson — `ios/` was gitignored when the deploy denylist was written), and a
 * plain walk would additionally read whatever untracked scratch a working copy
 * happens to hold, which can fail locally and can never fail in CI.
 */
function sweepFiles(): { path: string; content: string }[] {
  const listed = spawnSync('git', ['ls-files', '-z'], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
  })
  if (listed.status !== 0) {
    throw new Error(`git ls-files failed (${listed.status}): ${listed.stderr || listed.error}`)
  }

  return listed.stdout
    .split('\0')
    .filter((path) => path && SWEEP_EXTENSIONS.test(path))
    .map((path) => ({ path, content: readFileSync(resolve(REPO_ROOT, path), 'utf-8') }))
}

describe('deployment domain — no unpinned copies (LIFT-1453)', () => {
  const files = sweepFiles()

  it('walks the files a copy could hide in', () => {
    // Floor. A sweep that found nothing would make both checks below pass
    // vacuously, which is the failure mode this whole issue is about.
    const paths = new Set(files.map((file) => file.path))
    for (const expected of [
      'CLAUDE.md',
      'README.md',
      'index.html',
      'vercel.json',
      'netlify.toml',
      'api/coach.ts',
      'docs/app-store/listing.md',
      'public/robots.txt',
      'src/lib/appMeta.ts',
      '.github/workflows/ci.yml',
    ]) {
      expect(paths, `sweep missed ${expected}`).toContain(expected)
    }
  })

  it('names no deployment host other than the live one', () => {
    const stale = files
      .map((file) => ({ path: file.path, hosts: deploymentHosts(file.content) }))
      .filter((file) => file.hosts.some((host) => host !== LIVE_DOMAIN))
      .map((file) => `${file.path}: ${[...new Set(file.hosts)].join(', ')}`)

    expect(stale, `stale deployment host(s) — the live domain is ${LIVE_DOMAIN}`).toEqual([])
  })

  /**
   * `appMeta.ts` declares itself the in-code source of truth. Before LIFT-1453
   * that was aspirational — four other `src/` + `api/` modules restated the
   * literal beside it. This is what makes the claim true going forward: a new
   * caller has to import `APP_HOSTNAME`/`APP_URL`, because writing the domain
   * out is a red build even when the value happens to be correct.
   *
   * `__tests__` is excluded on purpose. A suite that pins the domain as its own
   * literal is a tripwire against CLAUDE.md itself being edited to a fabricated
   * host, which is the one thing a derived guard cannot check.
   */
  it('keeps src/ and api/ free of domain literals outside appMeta.ts', () => {
    const offenders = files
      .filter((file) => /^(src|api)\//.test(file.path))
      .filter((file) => !file.path.includes('__tests__'))
      .filter((file) => file.path !== 'src/lib/appMeta.ts')
      .filter((file) => deploymentHosts(file.content).length > 0)
      .map((file) => file.path)

    expect(offenders, 'import APP_HOSTNAME / APP_URL from src/lib/appMeta instead').toEqual([])

    // Floor: the one file that IS allowed to carry it still does.
    expect(deploymentHosts(read('src/lib/appMeta.ts'))).toContain(LIVE_DOMAIN)
  })
})
