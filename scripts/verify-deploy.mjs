// @ts-nocheck
/**
 * Production deploy smoke-test (LIFT-1167).
 *
 * CI's `notify-deploy` job posts "✅ Deployed to production" to Slack whenever
 * the GitHub Actions graph goes green. But Vercel deploys via its OWN
 * git-integration, entirely outside Actions — so a green CI run does NOT mean
 * the site is actually live. A failed/rolled-back Vercel build, a broken
 * bundle, or an SSO/edge misconfig would leave CI green while production is
 * down, and Slack would still claim success.
 *
 * This script closes that gap: it polls the real production domain and asserts
 * the response is the live Lift app shell (HTTP 200 + our app-root markers)
 * before Slack is allowed to announce the deploy. A failure fails the
 * `verify-deploy` job, which routes to `notify-failure` instead.
 *
 * SEV1 rule: the production domain is NEVER hardcoded here — it is the single
 * authoritative value in CLAUDE.md and is extracted from there at runtime.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Pull the canonical production domain out of CLAUDE.md's "**Live:**" line.
 * Throws rather than guessing — a missing/renamed marker must fail loudly, not
 * fall back to a fabricated domain (the 2026-04-02 SEV1 hallucination).
 */
export function extractProdDomain(claudeMd) {
  const match = claudeMd.match(/\*\*Live:\*\*\s*([a-z0-9.-]+\.vercel\.app)/i)
  if (!match) {
    throw new Error('Could not find the production domain (**Live:** …vercel.app) in CLAUDE.md')
  }
  return match[1]
}

/**
 * The prod response must be the Lift app shell. These stable markers from
 * index.html distinguish a live deploy from a Vercel build-error page, an
 * SSO/edge redirect, or an unrelated 200 (e.g. a parked/rolled-back page).
 */
export const HEALTH_MARKERS = ['<div id="app">', '<title>Lift']

export function isHealthyResponse(status, body) {
  if (status !== 200) return false
  if (typeof body !== 'string') return false
  return HEALTH_MARKERS.every((marker) => body.includes(marker))
}

function defaultSleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function defaultFetch(url) {
  // redirect: 'manual' so an SSO/auth redirect surfaces as a non-200 status
  // instead of being silently followed to some other 200 page.
  const res = await fetch(url, {
    redirect: 'manual',
    headers: { 'user-agent': 'lift-ci-deploy-smoke' },
  })
  const body = await res.text()
  return { status: res.status, body }
}

/**
 * Poll `url` until it serves a healthy Lift app shell, or throw after
 * `attempts` tries. Vercel's git-integrated deploy runs in parallel with CI,
 * so the first probe can race the deploy finishing — hence the retry loop.
 */
export async function verifyDeploy({
  url,
  attempts = 10,
  delayMs = 15000,
  fetchImpl = defaultFetch,
  sleep = defaultSleep,
  log = console.log,
} = {}) {
  let last = null
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const { status, body } = await fetchImpl(url)
      last = { status, bytes: typeof body === 'string' ? body.length : 0 }
      if (isHealthyResponse(status, body)) {
        log(`✅ Production deploy is live (HTTP ${status}) after ${attempt} attempt(s): ${url}`)
        return true
      }
      log(`Attempt ${attempt}/${attempts}: unhealthy (HTTP ${status}, ${last.bytes} bytes) — retrying`)
    } catch (err) {
      last = { error: err instanceof Error ? err.message : String(err) }
      log(`Attempt ${attempt}/${attempts}: request failed (${last.error}) — retrying`)
    }
    if (attempt < attempts) await sleep(delayMs)
  }
  throw new Error(
    `Production deploy verification failed after ${attempts} attempts: ${JSON.stringify(last)}`,
  )
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  const claudeMd = readFileSync(resolve(__dirname, '..', 'CLAUDE.md'), 'utf8')
  const domain = extractProdDomain(claudeMd)
  const url = `https://${domain}/`
  console.log(`Verifying production deploy at ${url} …`)
  verifyDeploy({ url }).catch((err) => {
    // `::error::` annotates the failure in the GitHub Actions run summary.
    console.error(`::error::${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  })
}
