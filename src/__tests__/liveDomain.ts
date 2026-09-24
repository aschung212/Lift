/**
 * The deployment domain, derived from CLAUDE.md's `**Live:**` line (LIFT-1453).
 *
 * CLAUDE.md is the one authoritative source for this value (the SEV1 rule: on
 * 2026-04-02 the overnight builder hallucinated a competitor's domain as the
 * canonical URL and it shipped to production), and CI's `smoke-test-production`
 * really does read it from there. So a guard that restates the domain as its own
 * literal is pinning a copy, not the fact — which is how a domain change could
 * update five sites of six and leave the suite green.
 *
 * The derivation is `scripts/live-domain.mjs`, the same module the CLI in
 * `scripts/read-live-domain.mjs` hands CI, so the domain the suite asserts
 * against and the domain the deploy gate polls cannot disagree.
 *
 * `deploymentDomain.test.ts` is what makes importing this non-vacuous: it is the
 * one place that pins every site to this value, and it carries the tripwire that
 * the value itself is not a fabricated domain.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseLiveDomain } from '../../scripts/live-domain.mjs'

/** Repo root, for guards that need to read a file outside `src/`. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function readLiveDomain(): string {
  const markdown = readFileSync(resolve(REPO_ROOT, 'CLAUDE.md'), 'utf-8')
  const result = parseLiveDomain(markdown) as
    | { ok: true; domain: string }
    | { ok: false; reason: string }
  if (!result.ok) {
    // Fail loudly at import. A suite that quietly fell back to a guess would
    // assert every site against a domain nothing deploys to — the same
    // fail-open shape LIFT-1412 removed from the workflow's own reader.
    throw new Error(`CLAUDE.md: could not read the deployment domain — ${result.reason}`)
  }
  return result.domain
}

/** Bare production hostname, as written on CLAUDE.md's `**Live:**` line. */
export const LIVE_DOMAIN: string = readLiveDomain()

/** Production origin — `https://` + {@link LIVE_DOMAIN}, no trailing slash. */
export const LIVE_ORIGIN = `https://${LIVE_DOMAIN}`
