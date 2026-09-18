// Decide whether the commit production reports satisfies the commit CI pushed.
//
// This is the logic; `scripts/check-deployed-commit.mjs` is the CLI over it,
// and `.github/workflows/ci.yml`'s `smoke-test-production` job runs that CLI
// once per poll of `/version.json`.
//
// LIFT-1414: that job used to demand an EXACT match, and the production alias
// only ever serves the LATEST ready deployment. So whenever a second master
// push landed closer together than this job's own dependencies take to run
// (`build-and-test` + `e2e` + `migrate-db`, ~5-6 minutes), the alias had
// already moved past the commit being verified by the time the poll started —
// and the job spent its full 300s budget waiting for a SHA that could never
// come back, then failed and fired `🔴 Post-merge CI failed on master` for a
// deploy that had in fact succeeded. That is what happened on 2026-09-13 with
// #1400 and #1404, ~26 seconds apart, both READY in Vercel.
//
// master is linear, so a LATER master commit CONTAINS this one: production
// serving a descendant means this commit's code is live, which is the property
// the job exists to establish. An exact-match failure is only real when
// production is serving something OLDER or unrelated — which is still a
// failure, and is still reported as one.
//
// Everything here fails CLOSED. A deployed commit this checkout cannot resolve
// is `unknown`, never a pass: the caller deepens its history and keeps polling.

import { spawnSync } from 'node:child_process'

/**
 * @typedef {'serving' | 'superseded' | 'stale' | 'unrelated' | 'unknown' | 'absent' | 'malformed'} DeployVerdict
 */

/**
 * Process exit codes. The workflow branches on these rather than on the verdict
 * name because a `case` arm that silently matches nothing is precisely the
 * class of defect LIFT-1412 removed from this job; a number the shell fails to
 * handle still falls through to "keep polling" and then to the final error,
 * never to a pass.
 */
export const EXIT = {
  /** Production is serving this commit, or a later one containing it. */
  verified: 0,
  /** Not yet — keep polling. */
  waiting: 1,
  /** The deployed commit is not in this checkout; fetch more history. */
  unknownHistory: 2,
  /** The commit we were asked to verify is not a commit SHA. Stop now. */
  badInput: 3,
}

/** @type {Record<DeployVerdict, number>} */
export const VERDICT_EXIT = {
  serving: EXIT.verified,
  superseded: EXIT.verified,
  stale: EXIT.waiting,
  unrelated: EXIT.waiting,
  absent: EXIT.waiting,
  malformed: EXIT.waiting,
  unknown: EXIT.unknownHistory,
}

/** Every verdict this module can report. */
export const VERDICTS = /** @type {DeployVerdict[]} */ (Object.keys(VERDICT_EXIT))

/** @type {Record<DeployVerdict, (expected: string, deployed: string) => string>} */
const EXPLAIN = {
  serving: (_expected, deployed) => `production is serving ${deployed} — this commit`,
  superseded: (expected, deployed) =>
    `production is serving ${deployed}, a later master commit that contains ${expected} — this commit's code is live`,
  stale: (expected, deployed) =>
    `production is still serving ${deployed}, which ${expected} is not part of yet`,
  unrelated: (expected, deployed) =>
    `production is serving ${deployed}, which neither contains nor is contained by ${expected}`,
  unknown: (_expected, deployed) =>
    `production is serving ${deployed}, which is not in this checkout's history`,
  absent: () => 'production reported no commit in /version.json',
  malformed: (_expected, deployed) =>
    `production reported ${JSON.stringify(deployed)}, which is not a commit SHA`,
}

// Vercel stamps the full 40-character SHA into version.json, but a short one is
// a legitimate spelling of the same commit and git resolves it either way. The
// shape check is also what keeps a value read off the network from reaching
// `git` as a flag (`--upload-pack=…`); argv is passed without a shell, so there
// is no injection here, only argument confusion, and this closes that too.
const SHA = /^[0-9a-f]{7,40}$/

const normalize = (/** @type {unknown} */ value) =>
  String(value ?? '')
    .trim()
    .toLowerCase()

/**
 * The comparison itself, with the ancestry already resolved. Pure, so the
 * direction of the two ancestry questions — the one thing that is easy to write
 * backwards and impossible to see in a text assertion — is testable on its own.
 *
 * `null` ancestry means "could not be determined", which is `unknown`, which is
 * never a pass.
 *
 * @param {{
 *   expected: string,
 *   deployed: string,
 *   expectedIsAncestor?: boolean | null,
 *   deployedIsAncestor?: boolean | null,
 * }} input
 * @returns {DeployVerdict}
 */
export function classifyDeployedCommit({
  expected,
  deployed,
  expectedIsAncestor = null,
  deployedIsAncestor = null,
}) {
  const want = normalize(expected)
  const got = normalize(deployed)

  if (!got) return 'absent'
  if (!SHA.test(got)) return 'malformed'
  // The common case must not depend on having any history at all.
  if (got === want) return 'serving'

  if (expectedIsAncestor === null || deployedIsAncestor === null) return 'unknown'
  // Each an ancestor of the other is one commit under two spellings (a short
  // SHA against a full one), not a supersession.
  if (expectedIsAncestor && deployedIsAncestor) return 'serving'
  if (expectedIsAncestor) return 'superseded'
  if (deployedIsAncestor) return 'stale'
  return 'unrelated'
}

/**
 * @param {(args: string[]) => { status: number, stdout: string }} runGit
 */
function commitExists(runGit, sha) {
  return runGit(['rev-parse', '--verify', '--quiet', `${sha}^{commit}`]).status === 0
}

/**
 * `git merge-base --is-ancestor` exits 0 for yes and 1 for no; anything else is
 * an error, which must not read as "no".
 *
 * @param {(args: string[]) => { status: number, stdout: string }} runGit
 * @returns {boolean | null}
 */
function isAncestor(runGit, ancestor, descendant) {
  const { status } = runGit(['merge-base', '--is-ancestor', ancestor, descendant])
  if (status === 0) return true
  if (status === 1) return false
  return null
}

/**
 * Ask git both ancestry questions, or report neither when either commit is
 * missing from this checkout.
 *
 * @param {(args: string[]) => { status: number, stdout: string }} runGit
 */
export function resolveAncestry(runGit, expected, deployed) {
  const undetermined = { expectedIsAncestor: null, deployedIsAncestor: null }
  if (!commitExists(runGit, expected) || !commitExists(runGit, deployed)) return undetermined

  const expectedIsAncestor = isAncestor(runGit, expected, deployed)
  const deployedIsAncestor = isAncestor(runGit, deployed, expected)
  if (expectedIsAncestor === null || deployedIsAncestor === null) return undetermined
  return { expectedIsAncestor, deployedIsAncestor }
}

/**
 * @param {string[]} args
 * @returns {{ status: number, stdout: string }}
 */
function gitRunner(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' })
  // A signal kill leaves `status` null; treat anything that is not a clean
  // numeric exit as git erroring out, i.e. as "could not determine".
  if (result.error || typeof result.status !== 'number') return { status: 128, stdout: '' }
  return { status: result.status, stdout: result.stdout ?? '' }
}

/**
 * The whole CLI but for `process.exit`, so it is callable from a test without
 * starting a subprocess — which keeps the code CI runs and the code the tests
 * exercise the same code. `runGit` is injectable so a test can point it at a
 * throwaway repository while still going through real git.
 *
 * stdout is one line, `<verdict>: <explanation>`. The workflow logs the whole
 * line and reads the verdict name off the front of it.
 *
 * @param {string[]} argv positional arguments: the expected SHA, then the SHA
 *   production reported (which may be empty when the fetch failed)
 * @param {(line: string) => void} stdout
 * @param {(line: string) => void} stderr
 * @param {(args: string[]) => { status: number, stdout: string }} [runGit]
 * @returns {number} process exit code
 */
export function main(argv, stdout, stderr, runGit = gitRunner) {
  const expected = normalize(argv[0])
  if (!SHA.test(expected)) {
    stderr(
      `check-deployed-commit: ${JSON.stringify(argv[0] ?? '')} is not a commit SHA — ` +
        'nothing can be verified against it',
    )
    return EXIT.badInput
  }

  const deployed = normalize(argv[1])
  // Only consult git when there is an ancestry question to ask. An exact match,
  // an empty read and a garbage read are all answerable without any history,
  // and must stay answerable in a shallow checkout.
  const ancestry =
    deployed && deployed !== expected && SHA.test(deployed)
      ? resolveAncestry(runGit, expected, deployed)
      : { expectedIsAncestor: null, deployedIsAncestor: null }

  const verdict = classifyDeployedCommit({ expected, deployed, ...ancestry })
  stdout(`${verdict}: ${EXPLAIN[verdict](expected, deployed)}`)
  return VERDICT_EXIT[verdict]
}
