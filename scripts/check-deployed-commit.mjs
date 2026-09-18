#!/usr/bin/env node
// Report whether the commit production is serving satisfies the commit CI
// pushed — exactly it, or a later master commit that contains it (LIFT-1414).
// Run once per poll by `.github/workflows/ci.yml`'s `smoke-test-production`
// job; see `scripts/deployed-commit.mjs` for the verdicts, the exit codes, and
// why every uncertain answer fails closed.
//
//   node scripts/check-deployed-commit.mjs <expected-sha> <deployed-sha>
//
// Deliberately unconditional: no `import.meta.url === argv[1]` entry guard,
// because a guard that silently failed to match would make this print nothing
// and exit 0 — a pass for a deploy nobody checked, which is the whole failure
// class LIFT-1167 exists to remove. The testable half lives in the module this
// imports.

import { main } from './deployed-commit.mjs'

// `process.exitCode`, never `process.exit()`: stdout is a PIPE here (the
// workflow reads the verdict line through `$(…)`), and Node's writes to a pipe
// are asynchronous on Linux — `process.exit()` is documented to drop pending
// stdout writes. Setting the code lets the process exit on its own once the
// write has landed.
process.exitCode = main(
  process.argv.slice(2),
  (line) => process.stdout.write(`${line}\n`),
  (line) => process.stderr.write(`${line}\n`),
)
