// Read the production domain out of CLAUDE.md's `**Live:**` line.
//
// This is the logic; `scripts/read-live-domain.mjs` is the CLI over it, and
// `.github/workflows/ci.yml`'s `smoke-test-production` job runs that CLI.
// CLAUDE.md is the single authoritative source for the deployment domain (the
// SEV1 rule: never hardcode or fabricate a deployment URL — a hallucinated
// domain shipped to production once already), so neither the domain nor the
// parsing of it is restated in the workflow.
//
// LIFT-1412: the parsing used to be an inline `grep | sed` in ci.yml, and the
// `[ -z "$DOMAIN" ]` guard beneath it could not fire for the failure it was
// written for. `sed` does not fail, and does not print nothing, when its
// substitution misses — it PASSES THE INPUT LINE THROUGH VERBATIM. So the
// guard only ever caught a *missing* `**Live:**` line. A line that existed but
// was written in a different-but-reasonable markdown style (the domain in
// backticks, or written with a scheme) yielded the whole markdown line —
// non-empty — which was then interpolated into `https://$DOMAIN`. Every curl
// against that garbage URL failed, `|| true` swallowed it, and the job burned
// its full 300s poll budget before exiting with the *deploy* error message:
// blaming Vercel's alias for a one-line edit to a markdown file.
//
// So this fails CLOSED. A `**Live:**` line it cannot parse is an error
// reported in one second, never a best guess polled against for five minutes.

import { readFileSync } from 'node:fs'

const LIVE_LABEL = '**Live:**'

/**
 * Everything after the `**Live:**` label: markdown decoration, an optional
 * scheme, then a hostname (dot-separated labels ending in an alphabetic TLD).
 *
 * Deliberately tolerant of how a URL gets written in markdown — bare,
 * backticked, bolded, italicised, autolinked, carrying a scheme and/or a path,
 * or as a `[text](target)` link — and deliberately intolerant of everything
 * else, so a line carrying prose instead of a domain is an error rather than a
 * guess.
 *
 * ANCHORED at the start of the value: the domain must be the FIRST thing on
 * the line, not merely somewhere on it. An unanchored search would pull a
 * dotted token out of prose — `**Live:** TBD, see infra.md for status` would
 * yield `infra.md` — and the job would then poll `https://infra.md` for 300s
 * and blame the deploy, which is a narrower rerun of the very misattribution
 * this reader exists to remove.
 */
const LIVE_VALUE =
  /^[\s`*_[<]*(?:https?:\/\/)?([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,})/

/**
 * @param {string} markdown
 * @returns {{ ok: true, domain: string } | { ok: false, reason: string }}
 */
export function parseLiveDomain(markdown) {
  const line = markdown.split(/\r?\n/).find((l) => l.startsWith(LIVE_LABEL))
  if (line === undefined) {
    return { ok: false, reason: `no '${LIVE_LABEL}' line` }
  }
  const match = line.slice(LIVE_LABEL.length).match(LIVE_VALUE)
  if (!match) {
    return { ok: false, reason: `the '${LIVE_LABEL}' line carries no hostname: ${line}` }
  }
  return { ok: true, domain: match[1] }
}

/**
 * The whole CLI but for `process.exit`, so it is callable from a test without
 * starting a subprocess — which keeps the code CI runs and the code the tests
 * exercise the same code.
 *
 * @param {string[]} argv positional arguments (the markdown file to read)
 * @param {(line: string) => void} stdout
 * @param {(line: string) => void} stderr
 * @returns {number} process exit code
 */
export function main(argv, stdout, stderr) {
  const file = argv[0] ?? 'CLAUDE.md'
  let markdown
  try {
    markdown = readFileSync(file, 'utf8')
  } catch {
    stderr(`read-live-domain: could not read ${file}`)
    return 1
  }

  const result = parseLiveDomain(markdown)
  if (!result.ok) {
    stderr(`read-live-domain: ${file}: ${result.reason}`)
    return 1
  }

  stdout(result.domain)
  return 0
}
