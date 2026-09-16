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
# .github/workflows/ci.yml's `smoke-test-production` job executes this same
# command (read out of vercel.json, not restated) to decide whether to poll
# production for a deploy that Vercel was never going to make — its `case`
# guard pins the exact invocation, so a rename here needs a matching edit
# there and in deployVerification.test.ts.
#
# `ios/` is excluded for the same reason `capacitor.config.ts` is (LIFT-1438):
# nothing under it reaches the web bundle. Capacitor's own ios/.gitignore keeps
# the generated parts out of the repo — App/App/public (the copied dist/) and
# capacitor.config.json — so the tracked contents are exclusively Xcode project
# state, Swift-side config, entitlements, the privacy manifest and native
# assets. It only became a tracked directory in #1429, which is why it was
# never named here; until then every native-only commit (an Info.plist usage
# string, an entitlement, an icon, an SPM bump) spent a Vercel build and
# re-promoted production with a bundle nobody had changed — invisibly, since a
# no-op deploy looks exactly like a real one right down to the Slack line.
# A judgement like this cannot be derived from the build graph the way
# "every module vite.config.js imports" can, so deployVerification.test.ts
# reconciles the list against the repo's tracked top-level entries instead: a
# new one fails the suite until someone writes down a verdict for it.
set -euo pipefail
git diff --quiet HEAD^ HEAD -- . ':(exclude).github/' ':(exclude).husky/' ':(exclude)Screenshots/' ':(exclude)docs/' ':(exclude)e2e/' ':(exclude)ios/' ':(exclude)scripts/' ':(exclude)supabase/' ':(exclude)test-results/' ':(exclude).coverage-baseline.json' ':(exclude)capacitor.config.ts' ':(exclude)eslint.config.js' ':(exclude)lighthouserc.json' ':(exclude)netlify.toml' ':(exclude)playwright.config.ts' ':(exclude,glob)*.md' ':(exclude,glob)vitest*.config.js'
