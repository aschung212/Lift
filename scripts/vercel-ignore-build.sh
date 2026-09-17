#!/usr/bin/env bash
# Vercel's ignoreCommand contract is inverted: exit 0 means SKIP the build.
#
# This is a DENYLIST (LIFT-1354): skip only when every changed path between
# HEAD^ and HEAD is one of the known non-deployable paths below. That fails
# safe — a new root-level file nobody has excluded here still deploys, rather
# than silently never deploying the way the old allowlist did (it named
# vite.config.js but none of the vite-plugin-*.ts files that config imports).
#
# This logic lives in its own file, not inline in vercel.json's
# `ignoreCommand`, because Vercel's schema caps that field at 256 characters
# and the pathspec list below is already well past that on its own — the
# denylist shipped as one long inline command in #1409 and every deployment
# errored with "`ignoreCommand` should NOT be longer than 256 characters"
# instead of running. `vercel.json` just does `bash scripts/vercel-ignore-build.sh`.
#
# .github/workflows/ci.yml's `deploy-production` job executes this same command
# (read out of vercel.json, not restated) to decide whether to deploy at all —
# since LIFT-1169 CI owns the production deploy, so CI has to apply the gate
# Vercel no longer gets to. Its `case` guard pins the exact invocation, so a
# rename here needs a matching edit there and in deployVerification.test.ts.
# `smoke-test-production` reads that job's `deployed` output rather than
# re-running this, so "did this commit deploy" has one derivation.
set -euo pipefail
git diff --quiet HEAD^ HEAD -- . ':(exclude).github/' ':(exclude).husky/' ':(exclude)Screenshots/' ':(exclude)docs/' ':(exclude)e2e/' ':(exclude)scripts/' ':(exclude)supabase/' ':(exclude)test-results/' ':(exclude).coverage-baseline.json' ':(exclude)capacitor.config.ts' ':(exclude)eslint.config.js' ':(exclude)lighthouserc.json' ':(exclude)netlify.toml' ':(exclude)playwright.config.ts' ':(exclude,glob)*.md' ':(exclude,glob)vitest*.config.js'
