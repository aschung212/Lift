// Decide how the commit production is serving relates to the commit this CI
// run pushed — i.e. whether what is live is at least as new as us.
//
// This is the logic; `scripts/read-deploy-freshness.mjs` is the CLI over it,
// and `.github/workflows/ci.yml`'s `smoke-test-production` job runs that CLI
// once per poll attempt.
//
// LIFT-1414: that job used to require STRING EQUALITY between `github.sha` and
// the commit in `/version.json`, and `spa-rho-sandy.vercel.app` only ever
// serves the LATEST ready deployment. So the equality holds only while this
// push is still the newest one Vercel finished — and the job does not start
// until `build-and-test`, `e2e` and `migrate-db` have all run (~6 minutes,
// `e2e` alone taking 3-4). Merge two PRs closer together than that and the
// alias has already moved on by the time the earlier commit's job polls: it
// then waits 300s for a SHA that can never come back and exits with "the
// Vercel deploy likely failed or stalled", firing a red `Post-merge CI failed`
// Slack message for a deploy that in fact succeeded. That happened on
// 2026-09-17 to #1400, one of three PRs merged ~90s apart, all three of which
// reached READY.
//
// The fix is to ask the question the job actually cares about — "is this
// commit's code live?" — which is true for the pushed commit AND for any
// DESCENDANT of it, since a descendant's build contains it. An exact-match
// failure is only real when production is serving something OLDER or
// unrelated, and those get their own diagnostics: the whole point of this
// chain is that the failure message names the system that actually broke
// (LIFT-1167, LIFT-1367, LIFT-1412).

import { execFileSync } from 'node:child_process'

/**
 * A git object id and nothing else.
 *
 * The deployed value arrives over the network (it is read out of
 * `/version.json`), and it is passed to `git` as an argument — so it is
 * validated to hex BEFORE any git call, never after. A value beginning with
 * `-` would otherwise be read by git as an option.
 */
const OBJECT_ID = /^[0-9a-f]{7,40}$/

/**
 * Every answer this module can give. `current` and `superseded` mean this
 * commit's code is live; the rest mean keep waiting, and name why on timeout.
 */
export const DEPLOY_FRESHNESS_STATES = Object.freeze([
  /** Production is serving exactly the commit that was pushed. */
  'current',
  /** Production is serving a DESCENDANT — a newer deploy that contains us. */
  'superseded',
  /** Production is serving an ANCESTOR — our deploy has not landed yet. */
  'behind',
  /** Neither commit descends from the other (a force-push or a rewrite). */
  'unrelated',
  /** The deployed commit is not an object this checkout can resolve. */
  'unknown',
  /** `/version.json` reported something that is not a git object id. */
  'malformed',
  /** `/version.json` reported no commit at all (or was unreachable). */
  'none',
])

/** The states that mean the pushed commit's code is live in production. */
export const LIVE_STATES = Object.freeze(['current', 'superseded'])

/**
 * How long any one git command may take. Only the `fetch` below can block at
 * all (it talks to a remote), and it runs inside a poll loop that already has
 * a fixed budget — a hung negotiation would eat that budget and then be
 * reported as a stalled deploy, which is the misattribution this file exists
 * to remove. A timeout throws, so it degrades to `unknown` like any other
 * unreachable commit.
 */
const GIT_TIMEOUT_MS = 15_000

/**
 * A git runner for `classifyDeployFreshness`: runs git and reports only
 * whether it exited 0. Every git command this module needs (`cat-file -e`,
 * `merge-base --is-ancestor`, `fetch`) answers through its exit status, so the
 * seam stays a boolean and a test can drive the classifier with a real git in
 * a temporary repository.
 *
 * @param {string} [cwd]
 * @returns {(args: string[]) => boolean}
 */
export function gitRunner(cwd = process.cwd()) {
  return (args) => {
    try {
      execFileSync('git', args, {
        cwd,
        stdio: ['ignore', 'ignore', 'ignore'],
        timeout: GIT_TIMEOUT_MS,
      })
      return true
    } catch {
      return false
    }
  }
}

/**
 * @param {string} sha
 * @param {(args: string[]) => boolean} git
 */
function isResolvable(sha, git) {
  return git(['cat-file', '-e', `${sha}^{commit}`])
}

/**
 * How `deployed` relates to `expected`.
 *
 * @param {string} expected the commit this run pushed (`github.sha`)
 * @param {string} deployed the commit `/version.json` reports, possibly empty
 * @param {(args: string[]) => boolean} git
 * @returns {{ state: string, detail: string }}
 */
export function classifyDeployFreshness(expected, deployed, git) {
  if (deployed.trim() === '') {
    return { state: 'none', detail: 'production reported no commit' }
  }
  if (!OBJECT_ID.test(deployed)) {
    return {
      state: 'malformed',
      detail: `production reported a commit that is not a git object id: ${deployed}`,
    }
  }

  if (!isResolvable(deployed, git)) {
    // A commit that landed on master AFTER this job's checkout fetched — the
    // residual form of the very race this module exists for, since the poll
    // window is 300s wide and a third push can land inside it. Fetching the
    // object id directly needs no branch name and no guess about which ref it
    // sits on; github.com serves an arbitrary reachable SHA (the same
    // capability `actions/checkout` relies on). If it cannot be fetched — a
    // private repo reached without credentials, say — the answer degrades to
    // `unknown`, which keeps polling and then says so, rather than claiming
    // the deploy failed.
    git(['fetch', '--no-tags', '--quiet', 'origin', deployed])
    if (!isResolvable(deployed, git)) {
      return {
        state: 'unknown',
        detail: `production is serving ${deployed}, which this checkout cannot resolve`,
      }
    }
  }

  // Mutual ancestry in a DAG means the same commit, so the two probes answer
  // all four relations between them without a separate equality test — which
  // also makes an abbreviated object id classify correctly rather than
  // reading as `unrelated`.
  const weAreAnAncestor = git(['merge-base', '--is-ancestor', expected, deployed])
  const theyAreAnAncestor = git(['merge-base', '--is-ancestor', deployed, expected])

  if (weAreAnAncestor && theyAreAnAncestor) {
    return {
      state: 'current',
      detail: `production is serving ${deployed}, the commit this run pushed`,
    }
  }
  if (weAreAnAncestor) {
    return {
      state: 'superseded',
      detail: `production is serving ${deployed}, a descendant of ${expected} — this commit's code is live inside a newer deploy`,
    }
  }
  if (theyAreAnAncestor) {
    return {
      state: 'behind',
      detail: `production is serving ${deployed}, an ancestor of ${expected} — the new deploy has not landed yet`,
    }
  }
  return {
    state: 'unrelated',
    detail: `production is serving ${deployed}, which shares no ancestry with ${expected}`,
  }
}

/**
 * The whole CLI but for `process.exit`, so it is callable from a test without
 * starting a subprocess — which keeps the code CI runs and the code the tests
 * exercise the same code.
 *
 * Prints the state as a single word on stdout (the workflow `case`s on it) and
 * the human sentence on stderr (the CI log). Exit 0 means the classification
 * ran, NOT that the deploy is live — the caller reads the state for that.
 *
 * A caller mistake exits 2 instead of guessing, for the LIFT-1412 reason: a
 * reader that answers plausibly when its input is wrong turns a one-second
 * error into 300s of polling blamed on the wrong system.
 *
 * @param {string[]} argv positional arguments: expected sha, deployed sha
 * @param {(line: string) => void} stdout
 * @param {(line: string) => void} stderr
 * @param {(args: string[]) => boolean} [git]
 * @returns {number} process exit code
 */
export function main(argv, stdout, stderr, git = gitRunner()) {
  // Exactly two, so an omitted second argument is a usage error rather than
  // being read as the empty `none` state — "the workflow forgot to pass the
  // deployed commit" and "production reported no commit" must not look alike.
  if (argv.length !== 2) {
    stderr('read-deploy-freshness: usage: read-deploy-freshness <expected-sha> <deployed-sha>')
    return 2
  }

  const [expected, deployed] = argv
  if (!OBJECT_ID.test(expected)) {
    stderr(`read-deploy-freshness: the expected commit is not a git object id: ${expected}`)
    return 2
  }
  if (!isResolvable(expected, git)) {
    stderr(
      `read-deploy-freshness: ${expected} is not in this checkout — the job needs full history (fetch-depth: 0) to compare it against the deployed commit`,
    )
    return 2
  }

  const { state, detail } = classifyDeployFreshness(expected, deployed, git)
  stdout(state)
  stderr(`read-deploy-freshness: ${detail}`)
  return 0
}
