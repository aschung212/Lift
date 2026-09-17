#!/usr/bin/env node
// Print the production domain recorded in CLAUDE.md's `**Live:**` line, or
// fail with a diagnostic on stderr. Run by `.github/workflows/ci.yml`'s
// `smoke-test-production` job; see `scripts/live-domain.mjs` for the parsing
// and for why it fails closed (LIFT-1412).
//
// Deliberately unconditional: no `import.meta.url === argv[1]` entry guard,
// because a guard that silently failed to match would make this print nothing
// and exit 0 — handing the workflow an empty domain to poll for 300s, which is
// the exact silent misattribution LIFT-1412 exists to remove. The testable
// half lives in the module this imports.

import { main } from './live-domain.mjs'

// `process.exitCode`, never `process.exit()`: stdout is a PIPE here (the
// workflow reads this through `$(…)`), and Node's writes to a pipe are
// asynchronous on Linux — `process.exit()` is documented to drop pending
// stdout writes. Truncating the domain to nothing would leave the job polling
// an empty URL for 300s, which is the failure this script exists to remove.
// Setting the code lets the process exit on its own once the write has landed.
process.exitCode = main(
  process.argv.slice(2),
  (line) => process.stdout.write(`${line}\n`),
  (line) => process.stderr.write(`${line}\n`),
)
