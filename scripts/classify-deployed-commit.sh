#!/usr/bin/env bash
# Classify what the commit production reports in `/version.json` means for the
# master push that ci.yml's `smoke-test-production` job is verifying.
#
#   usage: classify-deployed-commit.sh <expected-sha> <deployed-sha>
#   prints exactly one of:
#     exact       production is serving this very commit
#     descendant  production is serving a later commit that CONTAINS this one
#     stale       production is serving a commit that does NOT contain this one
#                 (an ancestor, or a diverged history)
#     unknown     nothing to compare: no commit reported, a value that isn't a
#                 git object name, or an object this clone does not have
#
# LIFT-1414: the job used to accept string equality alone, which silently
# assumed at most one master push lands inside its own runtime window. It does
# not. `smoke-test-production` waits on build-and-test + e2e + migrate-db
# (~6 minutes), while the production alias only ever serves the LATEST ready
# deployment — so merging two PRs 90 seconds apart leaves the first one's job
# polling for a SHA production has already moved past and can never report
# again. It burned its full 300s budget and posted a red "Post-merge CI failed"
# for a deploy that had in fact succeeded (2026-09-14: #1400, #1404 and #1409
# all reached READY; the #1400 run still cried failure).
#
# A descendant on master is therefore a pass, and it is a STRICTLY STRONGER
# result than an exact match: production is serving a build that contains this
# commit's code. That holds even when this commit's own Vercel build failed —
# the descendant that replaced it carries the same code, and the descendant's
# own run verifies itself. Only a commit that does not contain this one means
# the push never reached production, which is the failure LIFT-1167 built this
# job to catch, and it still fails.
set -euo pipefail

EXPECTED=${1:-}
DEPLOYED=${2:-}

if [ -z "$EXPECTED" ]; then
  echo "usage: $0 <expected-sha> <deployed-sha>" >&2
  exit 2
fi

# `deployed` arrives from the public internet (production's version.json), so
# its shape is checked before it is handed to git as an object name: junk, an
# empty string, or a leading `-` that git would read as an option is simply
# not something this can classify. Written with `case` rather than a bash
# regex so it behaves identically under the bash 3.2 that ships on macOS.
is_sha() {
  case "$1" in
    '' | *[!0-9a-f]*) return 1 ;;
  esac
  [ "${#1}" -ge 7 ] && [ "${#1}" -le 40 ]
}

if ! is_sha "$EXPECTED" || ! is_sha "$DEPLOYED"; then
  echo unknown
  exit 0
fi

if [ "$DEPLOYED" = "$EXPECTED" ]; then
  echo exact
  exit 0
fi

# Both objects have to be in this clone before their relationship means
# anything. A commit pushed to master after the job checked out is not — the
# caller re-fetches and asks again rather than writing it off as a failure.
for sha in "$EXPECTED" "$DEPLOYED"; do
  if ! git cat-file -e "${sha}^{commit}" 2>/dev/null; then
    echo unknown
    exit 0
  fi
done

if git merge-base --is-ancestor "$EXPECTED" "$DEPLOYED"; then
  echo descendant
else
  echo stale
fi
