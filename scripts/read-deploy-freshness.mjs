#!/usr/bin/env node
// Print how the commit production is serving relates to the commit this CI run
// pushed — `current`, `superseded`, `behind`, `unrelated`, `unknown`,
// `malformed` or `none`. Run once per poll attempt by
// `.github/workflows/ci.yml`'s `smoke-test-production` job; see
// `scripts/deploy-freshness.mjs` for the classification and for why a
// descendant counts as live (LIFT-1414).
//
// Deliberately unconditional: no `import.meta.url === argv[1]` entry guard,
// because a guard that silently failed to match would make this print nothing
// and exit 0 — handing the workflow an empty state that falls through to
// "keep waiting" for 300s and then blames the deploy, which is the class of
// silent misattribution LIFT-1412 exists to remove. The testable half lives in
// the module this imports.

import { main } from './deploy-freshness.mjs'

// `process.exitCode`, never `process.exit()`: stdout is a PIPE here (the
// workflow reads this through `$(…)`), and Node's writes to a pipe are
// asynchronous on Linux — `process.exit()` is documented to drop pending
// stdout writes. A truncated state word would read as "keep waiting".
process.exitCode = main(
  process.argv.slice(2),
  (line) => process.stdout.write(`${line}\n`),
  (line) => process.stderr.write(`${line}\n`),
)
