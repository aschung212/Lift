// Decide whether "production is serving commit X" means the commit CI just
// pushed is live.
//
// This is the logic; `scripts/check-deployed-commit.mjs` is the CLI over it,
// and `.github/workflows/ci.yml`'s `smoke-test-production` job runs that CLI.
//
// LIFT-1414: that job used to answer the question with `=` — production had to
// report the pushed SHA *exactly*. The production alias only ever points at the
// LATEST ready deployment, so the comparison is only sound while at most one
// master push lands inside the job's own runtime. It does not: this job waits
// on `build-and-test`, `e2e` and `migrate-db` (~6 minutes, `e2e` alone is 3-4),
// and merging a backlog puts pushes 90 seconds apart. On 2026-09-13 three PRs
// merged in a row, all three deployed, and the middle one's job polled for
// 300s for a SHA the alias had already moved past — then reported a stalled
// Vercel deploy and fired `🔴 Post-merge CI failed on master` for a deploy that
// had in fact succeeded. That is the misattribution class LIFT-1167,
// LIFT-1354, LIFT-1367 and LIFT-1412 each exist to close, reached through the
// one comparison none of them touched.
//
// So the question is ancestry, not equality: production serving a DESCENDANT
// of the pushed commit means the pushed commit is in what production serves.
// Note what that does and does not prove — it proves production is at or past
// this commit, not that no later commit reverted its changes. That is the same
// guarantee git gives for anything already merged, and it is what "this push
// reached production" can mean once a newer push exists.
//
// An exact-match failure is only real when production is serving something
// OLDER or unrelated, so the verdicts below are deliberately finer-grained
// than a boolean: the timeout diagnostic names which of those it saw, rather
// than blaming the Vercel deploy for every way the check can end.

import { execFileSync } from 'node:child_process'

/**
 * Production serves exactly the pushed commit. The pre-LIFT-1414 answer, and
 * still the common one.
 */
export const MATCH = 'match'
/**
 * Production serves a DESCENDANT of the pushed commit — a later master push
 * won the alias race. The pushed commit is live inside it.
 */
export const SUPERSEDED = 'superseded'
/** Production serves an ANCESTOR — this commit's deploy has not landed yet. */
export const BEHIND = 'behind'
/** Production serves a commit from some other history entirely. */
export const UNRELATED = 'unrelated'
/** The deployed commit could not be resolved here, even after a fetch. */
export const UNKNOWN = 'unknown'
/**
 * The question could not be asked at all — a malformed expected SHA, no git,
 * or a checkout that does not contain its own HEAD. Distinct from UNKNOWN
 * because it is OUR side that is broken: the caller must stop immediately and
 * say so, never keep polling and blame the deploy five minutes later.
 */
export const ERROR = 'error'

export const DEPLOY_VERDICTS = [MATCH, SUPERSEDED, BEHIND, UNRELATED, UNKNOWN, ERROR]

/** Verdicts that mean the pushed commit is live in production. */
export function isLive(verdict) {
  return verdict === MATCH || verdict === SUPERSEDED
}

/**
 * A SHA as `version.json` carries it (the build env's `VERCEL_GIT_COMMIT_SHA`
 * or `GITHUB_SHA`, both full 40-char), plus room for an abbreviation.
 *
 * This is a guard, not a formality. The deployed value arrives over the public
 * network and is handed to `git`, and while `execFileSync` runs no shell, a
 * value beginning with `-` would still be read by git as an OPTION —
 * `--upload-pack=…` on the fetch below is the obvious one. Anything that is
 * not plain lowercase hex never reaches an argv.
 */
const SHA = /^[0-9a-f]{7,40}$/
/** Ref names git will accept as a fetch target, minus anything option-like. */
const REF = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

/**
 * Run git and report its exit status rather than throwing, so every call site
 * below reads as the question it is asking.
 *
 * @param {string[]} args
 * @param {{ cwd?: string }} [options]
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
export function runGit(args, options = {}) {
  try {
    const stdout = execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    })
    return { status: 0, stdout: (stdout ?? '').trim(), stderr: '' }
  } catch (error) {
    // A non-zero exit gives `status`; a missing git binary gives none.
    const status = typeof error?.status === 'number' ? error.status : 1
    return {
      status,
      stdout: String(error?.stdout ?? '').trim(),
      stderr: String(error?.stderr ?? '').trim(),
    }
  }
}

/** A `runGit` bound to a working directory — the shape tests inject. */
export function gitIn(cwd) {
  return (args) => runGit(args, { cwd })
}

function resolveCommit(git, sha) {
  const result = git(['rev-parse', '--verify', '--quiet', `${sha}^{commit}`])
  return result.status === 0 && result.stdout !== '' ? result.stdout : null
}

/**
 * @param {object} input
 * @param {string} input.expected the commit this CI run pushed (`github.sha`)
 * @param {string} input.deployed the commit production reports in version.json
 * @param {string} [input.branch] the branch production deploys from; the
 *   deployed commit is fetched from it when this clone has not seen it yet,
 *   which is the normal case — it was pushed after this job checked out.
 * @param {(args: string[]) => { status: number, stdout: string, stderr: string }} [input.git]
 * @returns {{ verdict: string, reason: string }}
 */
export function classifyDeployedCommit({ expected, deployed, branch = 'master', git = runGit }) {
  if (!SHA.test(expected)) {
    return { verdict: ERROR, reason: `the expected commit is not a SHA: ${JSON.stringify(expected)}` }
  }
  if (!SHA.test(deployed)) {
    // Production's problem, not ours: keep waiting rather than fail the job on
    // one malformed response.
    return {
      verdict: UNKNOWN,
      reason: `production reported something that is not a SHA: ${JSON.stringify(deployed)}`,
    }
  }
  // The overwhelmingly common path stays git-free: identical strings need no
  // repository, so a broken checkout can never turn a good deploy red.
  if (expected === deployed) {
    return { verdict: MATCH, reason: `production is serving ${deployed}` }
  }
  if (!REF.test(branch)) {
    return { verdict: ERROR, reason: `not a usable branch name: ${JSON.stringify(branch)}` }
  }

  const expectedOid = resolveCommit(git, expected)
  if (!expectedOid) {
    // HEAD of the very push being verified. If it is missing, git is absent or
    // this is not the repository we think it is — either way the answer below
    // would be meaningless.
    return {
      verdict: ERROR,
      reason: `this clone does not contain the pushed commit ${expected} — is git available, and is this its repository?`,
    }
  }

  let deployedOid = resolveCommit(git, deployed)
  if (!deployedOid) {
    // Expected on the first miss: production has moved to a commit pushed
    // after this job checked out, so it is simply not here yet. Best-effort —
    // a fetch that fails (a private repo with no credentials, a transient
    // network error) leaves UNKNOWN, which keeps polling and reports itself
    // rather than being reported as a stalled deploy.
    const fetched = git(['fetch', '--no-tags', '--quiet', 'origin', branch])
    deployedOid = resolveCommit(git, deployed)
    if (!deployedOid) {
      const detail = fetched.status === 0 ? '' : `; fetching ${branch} failed: ${fetched.stderr || `git exited ${fetched.status}`}`
      return {
        verdict: UNKNOWN,
        reason: `${deployed} is not reachable from ${branch} in this clone${detail}`,
      }
    }
  }

  if (expectedOid === deployedOid) {
    return { verdict: MATCH, reason: `production is serving ${expected}` }
  }
  if (git(['merge-base', '--is-ancestor', expectedOid, deployedOid]).status === 0) {
    return {
      verdict: SUPERSEDED,
      reason: `production has advanced to ${deployed}, which contains ${expected}`,
    }
  }
  if (git(['merge-base', '--is-ancestor', deployedOid, expectedOid]).status === 0) {
    return {
      verdict: BEHIND,
      reason: `production is still serving ${deployed}, an ancestor of ${expected}`,
    }
  }
  return {
    verdict: UNRELATED,
    reason: `production is serving ${deployed}, which is neither ${expected} nor a descendant of it`,
  }
}

/**
 * The whole CLI but for `process.exit`, so it is callable from a test without
 * starting a subprocess — which keeps the code CI runs and the code the tests
 * exercise the same code.
 *
 * stdout carries the verdict token alone (the workflow branches on it); stderr
 * carries the sentence explaining it, so every polling attempt leaves its
 * reasoning in the CI log.
 *
 * @param {string[]} argv `[expectedSha, deployedSha, branch?]`
 * @param {(line: string) => void} stdout
 * @param {(line: string) => void} stderr
 * @param {(args: string[]) => { status: number, stdout: string, stderr: string }} [git]
 * @returns {number} process exit code
 */
export function main(argv, stdout, stderr, git = runGit) {
  const [expected, deployed, branch] = argv
  if (!expected || !deployed) {
    stderr('check-deployed-commit: usage: check-deployed-commit.mjs <expected-sha> <deployed-sha> [branch]')
    return 1
  }

  const { verdict, reason } = classifyDeployedCommit({
    expected,
    deployed,
    ...(branch ? { branch } : {}),
    git,
  })
  stderr(`check-deployed-commit: ${verdict}: ${reason}`)
  // ERROR is the only verdict this side owns, so it is the only one that fails
  // the process. Every other verdict is a fact about production that the
  // caller's poll loop is there to wait out.
  if (verdict === ERROR) return 1
  stdout(verdict)
  return 0
}
