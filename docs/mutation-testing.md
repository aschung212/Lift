# Mutation testing (LIFT-667)

Line/branch coverage measures **execution** — that a line ran during the suite.
It says nothing about **assertion strength**: a test can call a function and
never meaningfully assert on the result, inflating coverage while catching no
regressions. [Stryker Mutator](https://stryker-mutator.io/) closes that gap. It
mutates the source (flips `>` to `>=`, `+` to `-`, `&&` to `||`, removes `return`
values, …) and re-runs the tests. A mutant that is **killed** means some test
failed — good. A mutant that **survives** means the tests passed on broken code —
a blind spot in the assertions.

## Scope

Configured in [`stryker.config.json`](../stryker.config.json), deliberately
scoped to the deterministic, high-consequence pure logic in `src/lib/`:

- `xp.ts`, `epley.ts` — 1RM / XP math
- `conflictResolver.ts` — last-write-wins sync merge
- `classifyWarmupSets.ts` — warmup/working-set inference
- `intensityTable.ts`, `plateCalculator.ts`, `setScoring.ts` — load/scoring math
- `weeklyGoal.ts`, `gyms.ts` — goal + gym-filter derivation

These modules are pure and fast, so the mutation score is a clean signal. The
scope is intentionally **not** broadened to components, stores, or
layout/time-dependent composables — those produce flaky, low-value mutation runs
and are better served by the existing unit/E2E suites. The
`strykerConfigRegression.test.ts` guardrail pins this intent.

## Running it

```bash
npm run test:mutation
```

Stryker and its Vitest runner are **not** committed to `package.json` /
`package-lock.json`. Like `@lhci/cli` in `.github/workflows/ci.yml`, they are
pulled on demand via a pinned `npx` invocation, because the tool drags in a
large transitive dependency tree that would bloat the lockfile and trip the
`dependency-review` CI gate for something that never runs in PR CI.

The HTML report is written to `reports/mutation/index.html` (git-ignored).

## Notes

- **Not a PR gate.** `thresholds.break` is `null`, so a run never fails CI — this
  is a local rigor/diagnostic tool, run periodically or before hardening a module,
  not on every push. Raise `break` if you later want to gate a specific module.
- **Version pinning.** The script uses `@^9`. The Vitest runner must match the
  installed Vitest major (this repo is on Vitest 4). After a first successful
  local run, pin the exact resolved versions in the `test:mutation` script for
  reproducibility.
- **Reading results.** Focus on *survived* mutants in the HTML report — each is a
  concrete missing assertion. Kill it by adding/strengthening a test, not by
  deleting the mutated branch.
