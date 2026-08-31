#!/usr/bin/env node
/**
 * Migration ordering guard (LIFT-1280).
 *
 * WHY THIS EXISTS
 *
 * `migrate-db` runs only on pushes to master, so a PR never exercises it and
 * always reports green. On 2026-08-29 a migration whose timestamp predated the
 * last one already applied on the remote (20260529000000_add_notes.sql) made
 * `supabase db push` abort — WITHOUT APPLYING ANYTHING — on every master push
 * for days. Nobody noticed, because the only signal was a job PRs cannot run.
 * That also silently disabled smoke-test-production and notify-deploy.
 *
 * The push now passes --include-all so one stale file cannot wedge the whole
 * queue. But --include-all also disables the CLI's own out-of-order guard: a
 * genuinely mis-ordered pair (two branches picking clashing timestamps, where
 * one migration depends on schema the other creates) would then apply in the
 * wrong order silently instead of failing loudly.
 *
 * This restores that protection one step earlier, where it is actually useful:
 * at PR time, against the repo rather than the remote. A migration added by
 * this branch must sort after every migration already on the base branch.
 *
 * Comparing against the BASE BRANCH rather than the remote database is
 * deliberate — it needs no credentials, so it can run on every PR.
 *
 * Usage: node scripts/check-migration-order.mjs [baseRef]   (default: origin/master)
 */
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'

const baseRef = process.argv[2] || 'origin/master'
const DIR = 'supabase/migrations'
const TIMESTAMP = /^(\d{14})_/

function timestampsOn(ref) {
  let out
  try {
    out = execFileSync('git', ['ls-tree', '--name-only', ref, `${DIR}/`], {
      encoding: 'utf-8',
    })
  } catch {
    // Base ref unavailable (shallow clone, first commit). Nothing to compare
    // against — pass rather than fail the build on a checkout detail.
    return null
  }
  return out
    .split('\n')
    .map((p) => p.split('/').pop())
    .filter(Boolean)
}

function parse(names) {
  return names
    .map((n) => {
      const m = TIMESTAMP.exec(n)
      return m ? { name: n, ts: m[1] } : null
    })
    .filter(Boolean)
}

const baseNames = timestampsOn(baseRef)
if (baseNames === null) {
  console.log(`migration-order: base ref ${baseRef} unavailable — skipping.`)
  process.exit(0)
}

const localNames = readdirSync(DIR).filter((f) => f.endsWith('.sql'))

// Every file must carry a sortable 14-digit timestamp, or ordering is undefined.
const malformed = localNames.filter((n) => !TIMESTAMP.test(n))
if (malformed.length) {
  console.error('migration-order: filenames must start with a 14-digit timestamp:')
  for (const n of malformed) console.error(`  ${n}`)
  process.exit(1)
}

const base = parse(baseNames)
const added = parse(localNames).filter((f) => !baseNames.includes(f.name))

if (!added.length) {
  console.log('migration-order: no new migrations in this branch.')
  process.exit(0)
}

const highestBase = base.reduce((max, f) => (f.ts > max.ts ? f : max), { ts: '', name: '(none)' })

const offenders = added.filter((f) => f.ts <= highestBase.ts)
if (offenders.length) {
  console.error(
    `migration-order: new migrations must sort AFTER the newest on ${baseRef}.\n` +
      `  newest on ${baseRef}: ${highestBase.name}\n`,
  )
  for (const f of offenders) console.error(`  ✖ ${f.name}`)
  console.error(
    '\nRename the offending file(s) with a timestamp later than the newest above.\n' +
      'An out-of-order migration wedged every production schema push for days\n' +
      'on 2026-08-29 (LIFT-1280) — and because `db push` now runs with\n' +
      '--include-all, the CLI will no longer catch this for you.',
  )
  process.exit(1)
}

console.log(
  `migration-order: ${added.length} new migration(s) sort after ${highestBase.name}. OK.`,
)
