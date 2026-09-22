#!/usr/bin/env node
// Print how the commit production is serving relates to the commit this CI run
// pushed — `match`, `superseded`, `behind`, `unrelated` or `unknown` — or fail
// with a diagnostic on stderr when the question cannot be asked at all. Run by
// `.github/workflows/ci.yml`'s `smoke-test-production` job; see
// `scripts/deployed-commit.mjs` for the logic and for why an exact SHA match
// is not the right question (LIFT-1414).
//
// Deliberately unconditional: no `import.meta.url === argv[1]` entry guard,
// because a guard that silently failed to match would make this print nothing
// and exit 0 — handing the workflow an empty verdict, which is the same silent
// misattribution LIFT-1412 removed from the domain reader beside it. The
// testable half lives in the module this imports.

import { main } from './deployed-commit.mjs'

// `process.exitCode`, never `process.exit()`: stdout is a PIPE here (the
// workflow reads this through `$(…)`), and Node's writes to a pipe are
// asynchronous on Linux — `process.exit()` is documented to drop pending
// stdout writes. A truncated verdict would leave the job polling for the full
// window and then blaming the deploy. Setting the code lets the process exit
// on its own once the write has landed.
process.exitCode = main(
  process.argv.slice(2),
  (line) => process.stdout.write(`${line}\n`),
  (line) => process.stderr.write(`${line}\n`),
)
