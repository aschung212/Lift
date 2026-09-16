#!/usr/bin/env bash
#
# Classify the commit production is serving against the commit this CI run
# pushed (LIFT-1414). Prints exactly one word to stdout:
#
#   exact       production is serving this very commit
#   descendant  production is serving a LATER commit that contains this one
#   ancestor    production is serving an OLDER commit on this line
#   unrelated   production is serving a commit that does not contain this one
#               and is not contained by it (a diverged line, a force-push)
#   absent      a well-formed object name this clone does not have — the
#               caller can fetch and ask again
#   unknown     the deployed value is not a plausible object name at all
#
# `absent` and `unknown` are split so the caller re-fetches only when a fetch
# could help. It is the classifier that knows the difference, so the shape
# check stays here rather than being restated in the workflow.
#
# Why this exists: `smoke-test-production` used to compare the two SHAs with
# string equality, which silently assumed at most one master push lands inside
# the job's own runtime window. It does not. The job waits on build-and-test +
# e2e + migrate-db (~6 minutes, e2e alone 3-4), `spa-rho-sandy.vercel.app` only
# ever serves the LATEST ready deployment, and master runs serialize behind
# `concurrency`. So merging two PRs 90 seconds apart leaves the first one's job
# polling for a SHA production has already moved past and can never report
# again: it burns the full poll budget and posts a red "Post-merge CI failed"
# for a deploy that reached READY. That happened on 2026-09-14 (#1400, #1404
# and #1409 merged in a row, all three deployed, the #1400 run still failed).
#
# `descendant` is a SUCCESS for this job, and that is stronger than equality
# rather than looser: the build being served contains this commit's code. It
# holds even if this commit's own Vercel build failed, because the descendant
# that replaced it carries the same code and verifies itself in its own run.
# `ancestor` is still a failure — that is the stale-deploy case LIFT-1167
# exists to catch, where a failed Vercel build leaves the PREVIOUS deployment
# live and a plain reachability curl answers 200 off it.
#
# The decision lives in a script, not inline in the workflow, so
# deployVerification.test.ts can EXECUTE it against throwaway git repos. That
# is the point: the defect was a comparison that could never be true, and a
# string assertion over a comparison reads identically whether it is right or
# wrong. Same argument that made the LIFT-1354 ignoreCommand evaluator run the
# real command.
#
# Usage: classify-deployed-commit.sh <expected-sha> <deployed-sha>
# Run from inside the repository whose history is being consulted. Always
# exits 0 — the classification is the output, not the status.
set -euo pipefail

EXPECTED="${1:-}"
DEPLOYED="${2:-}"

# `deployed` arrives from the public internet (version.json on the production
# domain), so it is shape-checked before it is ever handed to git as an object
# name. Junk and option-shaped values ("--upload-pack=…") classify as unknown —
# fail closed — instead of reaching `git rev-parse`.
is_object_name() {
  case "$1" in
    *[!0-9a-fA-F]* | '') return 1 ;;
  esac
  [ "${#1}" -ge 7 ] && [ "${#1}" -le 40 ]
}

if ! is_object_name "$EXPECTED" || ! is_object_name "$DEPLOYED"; then
  echo unknown
  exit 0
fi

# `--quiet --verify` prints the resolved id or nothing; `^{commit}` rejects a
# tag or tree that happens to share the prefix.
resolve() {
  git rev-parse --quiet --verify "$1^{commit}" 2>/dev/null || true
}

EXPECTED_ID=$(resolve "$EXPECTED")
DEPLOYED_ID=$(resolve "$DEPLOYED")

if [ -z "$EXPECTED_ID" ] || [ -z "$DEPLOYED_ID" ]; then
  echo absent
  exit 0
fi

if [ "$EXPECTED_ID" = "$DEPLOYED_ID" ]; then
  echo exact
elif git merge-base --is-ancestor "$EXPECTED_ID" "$DEPLOYED_ID"; then
  echo descendant
elif git merge-base --is-ancestor "$DEPLOYED_ID" "$EXPECTED_ID"; then
  echo ancestor
else
  echo unrelated
fi
