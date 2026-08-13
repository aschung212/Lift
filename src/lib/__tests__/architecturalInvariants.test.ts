/**
 * Consolidated architectural invariant tests.
 *
 * These tests scan source code to enforce structural rules that prevent
 * specific classes of bugs from returning. Each invariant documents the
 * SEV / incident it guards against.
 *
 * Why source scanning instead of runtime tests?
 * - Runtime tests prove behavior for specific inputs; structural tests
 *   prove the *absence* of dangerous patterns across the entire codebase.
 * - The SEV1 on 2026-04-12 passed all behavioral tests because the bug
 *   only triggered on specific data patterns. A structural test would
 *   have caught the anti-pattern before it shipped.
 *
 * Consolidated from: syncQueue.test.ts, syncQueueSafety.test.ts,
 * workout.test.ts, crossTabSyncStructural.test.ts (LIFT-653).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join, relative, resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

// ── Shared helpers ──────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const STORES_DIR = resolve(__dirname, '../../stores')
const SRC_DIR = resolve(__dirname, '../..')
const MIGRATIONS_DIR = resolve(SRC_DIR, '../supabase/migrations')

/** Returns { path (relative to src/), content } for every non-test .ts/.vue file. */
function getSourceFiles(dir = SRC_DIR, out: { path: string; content: string }[] = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) getSourceFiles(full, out)
    else if (/\.(ts|vue)$/.test(entry.name)) {
      out.push({ path: relative(SRC_DIR, full), content: readFileSync(full, 'utf-8') })
    }
  }
  return out
}

/** Returns absolute paths of all non-test .ts files in src/stores/. */
function getStoreFilePaths(): string[] {
  return readdirSync(STORES_DIR)
    .filter(f => f.endsWith('.ts') && !f.includes('__tests__'))
    .map(f => join(STORES_DIR, f))
}

/** Returns { name, content } for each store file. */
function getStoreFiles(): { name: string; content: string }[] {
  return readdirSync(STORES_DIR)
    .filter(f => f.endsWith('.ts') && !f.includes('__tests__'))
    .map(f => ({
      name: f,
      content: readFileSync(join(STORES_DIR, f), 'utf-8'),
    }))
}

/**
 * Extract a function body from source using brace-counting.
 * Returns the content between the opening and closing braces (exclusive).
 * Throws if the function signature is not found.
 */
function extractFunctionBody(source: string, signature: string): string {
  const fnStart = source.indexOf(signature)
  if (fnStart === -1) {
    throw new Error(`Function signature "${signature}" not found in source`)
  }
  const openBrace = source.indexOf('{', fnStart)
  let depth = 1
  let i = openBrace + 1
  while (i < source.length && depth > 0) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') depth--
    i++
  }
  return source.slice(openBrace + 1, i - 1)
}

/**
 * Scan a source string for all occurrences of `pattern` within a
 * `syncQueue.enqueue(` call, using brace/paren counting to scope
 * the search to the enqueue callback body.
 *
 * Returns a violation message for each match, or an empty array.
 */
function findPatternInsideSyncEnqueue(
  source: string,
  fileName: string,
  pattern: RegExp,
  violationMessage: (line: number, startLine: number) => string,
): string[] {
  const violations: string[] = []
  const lines = source.split('\n')

  let insideSyncEnqueue = false
  let enqueueStartLine = 0
  let parenDepth = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.includes('syncQueue.enqueue')) {
      insideSyncEnqueue = true
      enqueueStartLine = i + 1
      parenDepth = 0
    }

    if (insideSyncEnqueue) {
      for (const ch of line) {
        if (ch === '(') parenDepth++
        if (ch === ')') parenDepth--
      }

      if (pattern.test(line)) {
        violations.push(violationMessage(i + 1, enqueueStartLine))
      }

      if (parenDepth <= 0) {
        insideSyncEnqueue = false
      }
    }
  }

  return violations
}

// ── Invariant 1: Delete routing discipline ──────────────────────────
// Guard: SEV1 2026-04-12 — delete storm destroyed ~40-60% of user data.
// Every Supabase DELETE must go through syncQueue.enqueueDelete (not
// plain enqueue) so the circuit breaker sees it.

describe('Invariant: delete routing discipline (SEV1 2026-04-12 guard)', () => {
  const STORE_FILES = ['workout.ts', 'bodyweight.ts', 'preferences.ts', 'progression.ts']

  it('stores never wrap a .delete() in plain syncQueue.enqueue — must use enqueueDelete', () => {
    for (const file of STORE_FILES) {
      const src = readFileSync(resolve(STORES_DIR, file), 'utf-8')
      // Find every syncQueue.enqueue( and check a window of the following 300 chars
      // for .delete() — if present, it should have been enqueueDelete instead.
      const enqueueRe = /syncQueue\.enqueue\(/g
      let match: RegExpExecArray | null
      while ((match = enqueueRe.exec(src)) !== null) {
        const window = src.slice(match.index, match.index + 300)
        if (/\.delete\s*\(/.test(window)) {
          throw new Error(
            `${file} has syncQueue.enqueue wrapping a .delete() at offset ${match.index}. ` +
            `Use syncQueue.enqueueDelete so the circuit breaker sees it. ` +
            `Context:\n${window.slice(0, 200)}`,
          )
        }
      }
    }
  })

  // Gate 5 invariant: stores do not issue hard DELETEs at all.
  // Every removal must go through UPDATE { deleted_at: ... } so data is
  // recoverable within the grace window before the hard-delete cron runs.
  it('stores never call .delete() on a Supabase query — all removals are soft (Gate 5)', () => {
    for (const file of STORE_FILES) {
      const src = readFileSync(resolve(STORES_DIR, file), 'utf-8')
      // Match any supabase query builder .delete(), allowing whitespace / newlines
      // between .from(...) and .delete(). Non-supabase .delete() (Map/Set) is not
      // matched because the anchor requires .from(...) upstream within 200 chars.
      const re = /\.from\(\s*['"][^'"]+['"]\s*\)[\s\S]{0,200}?\.delete\s*\(/g
      const match = re.exec(src)
      if (match) {
        const offset = match.index
        throw new Error(
          `${file} contains a hard .delete() on a Supabase query at offset ${offset}. ` +
          `Gate 5 requires UPDATE { deleted_at: new Date().toISOString() } for all removals. ` +
          `Context:\n${src.slice(offset, offset + 200)}`,
        )
      }
    }
  })
})

// ── Invariant 2: SyncQueue idempotency ──────────────────────────────
// Guard: SyncQueue retries failed operations with exponential backoff.
// Non-idempotent .insert() retried after server processing creates
// duplicate data. Only .upsert(), .update(), .delete() are safe.

describe('Invariant: syncQueue idempotency (no .insert() in retry path)', () => {
  it('no .insert() calls are routed through syncQueue (non-idempotent, unsafe to retry)', () => {
    const violations: string[] = []

    for (const filePath of getStoreFilePaths()) {
      const content = readFileSync(filePath, 'utf-8')
      const fileName = filePath.split('/').pop()!

      const found = findPatternInsideSyncEnqueue(
        content,
        fileName,
        /\.insert\(/,
        (line, startLine) =>
          `${fileName}:${line} — .insert() inside syncQueue.enqueue (started line ${startLine}). ` +
          `Use .upsert() instead, or call Supabase directly without the queue.`,
      )
      violations.push(...found)
    }

    expect(
      violations,
      'Non-idempotent .insert() calls must not go through syncQueue (retries could create duplicates):\n' +
      violations.join('\n'),
    ).toHaveLength(0)
  })

  it('no fire-and-forget Supabase calls — all mutations must go through syncQueue', () => {
    const violations: string[] = []

    for (const filePath of getStoreFilePaths()) {
      const content = readFileSync(filePath, 'utf-8')
      const lines = content.split('\n')
      const fileName = filePath.split('/').pop()!

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (/supabase[!]?\.from\(/.test(line) || /\)\s*\.then\(\s*\)/.test(line)) {
          const window = lines.slice(Math.max(0, i - 2), i + 3).join('\n')
          if (/\.(?:insert|upsert|update|delete)\([\s\S]*?\)[\s\S]*?\.then\(\s*\)/.test(window)) {
            violations.push(
              `${fileName}:${i + 1} — fire-and-forget .then() on Supabase call. ` +
              `Route through syncQueue.enqueue() for retry, rate limiting, and error handling.`,
            )
          }
        }
      }
    }

    expect(
      violations,
      'Fire-and-forget Supabase calls bypass syncQueue error handling and retries:\n' +
      violations.join('\n'),
    ).toHaveLength(0)
  })
})

// ── Invariant 3: READ path is read-only ─────────────────────────────
// Guard: SEV1 2026-04-12 — _fetchFromSupabase broadcast DELETEs from a
// client-side dedup heuristic. 40-60% of one user's workout data was
// destroyed. Free tier = no PITR = unrecoverable.
//
// Rule: .delete() inside _fetchFromSupabase is ONLY allowed when
// processing tombstones (syncing pending user-initiated deletes).
// Variable names from the original bug (`dupSetIds`, etc.) must not
// reappear.

describe('Invariant: _fetchFromSupabase READ path is read-only (SEV1 2026-04-12 guard)', () => {
  it('workout _fetchFromSupabase: .delete() only allowed in tombstone context', () => {
    const src = readFileSync(resolve(STORES_DIR, 'workout.ts'), 'utf-8')
    const body = extractFunctionBody(src, 'async function _fetchFromSupabase()')

    // Every .delete() must be preceded (within 400 chars) by "tombstone"
    const deletePattern = /\.delete\s*\(/g
    let match: RegExpExecArray | null
    while ((match = deletePattern.exec(body)) !== null) {
      const before = body.slice(Math.max(0, match.index - 400), match.index)
      expect(before).toMatch(/tombstone/i)
    }

    // Guard against the specific variable names from the original bug
    expect(body).not.toMatch(/dupSetIds/)
    expect(body).not.toMatch(/Set was content-deduped out/)
    expect(body).not.toMatch(/Delete the duplicate exercise from Supabase/)
  })

  it('bodyweight _fetchFromSupabase: .delete() only allowed in tombstone context', () => {
    const src = readFileSync(resolve(STORES_DIR, 'bodyweight.ts'), 'utf-8')
    const body = extractFunctionBody(src, 'async _fetchFromSupabase()')

    const deletePattern = /\.delete\s*\(/g
    let match: RegExpExecArray | null
    while ((match = deletePattern.exec(body)) !== null) {
      const before = body.slice(Math.max(0, match.index - 400), match.index)
      expect(before).toMatch(/tombstone/i)
    }

    expect(body).not.toMatch(/dupIds/)
    expect(body).not.toMatch(/Clean up duplicate entries from Supabase/)
  })
})

// ── Invariant 4: Cross-tab sync completeness ────────────────────────
// Guard: if a store has _persist() but doesn't broadcast, cross-tab
// sync silently breaks. This catches missing wiring when new stores
// are added or _persist() is refactored.
//
// Stores broadcast either directly (broadcastStoreUpdate) or by delegating
// the storage plumbing to persistStoreData, which broadcasts internally
// (LIFT-819). Either satisfies the invariant.

describe('Invariant: cross-tab sync completeness', () => {
  it('every store with _persist() must broadcast cross-tab updates', () => {
    const violations: string[] = []

    for (const { name, content } of getStoreFiles()) {
      if (!content.includes('_persist()')) continue

      if (!content.includes('broadcastStoreUpdate') && !content.includes('persistStoreData')) {
        violations.push(
          `${name} — has _persist() but neither calls broadcastStoreUpdate ` +
          `nor delegates to persistStoreData. Cross-tab sync needs one of these. ` +
          `Either call broadcastStoreUpdate('<storeName>') inside _persist(), ` +
          `or route the write through persistStoreData() from '../lib/storePersistence'.`,
        )
      }
    }

    expect(violations).toEqual([])
  })

  it('every store with _persist() must have _reloadFromStorage()', () => {
    const violations: string[] = []

    for (const { name, content } of getStoreFiles()) {
      if (!content.includes('_persist()')) continue

      if (!content.includes('_reloadFromStorage()')) {
        violations.push(
          `${name} — has _persist() but no _reloadFromStorage(). ` +
          `Cross-tab sync needs this to apply changes from other tabs.`,
        )
      }
    }

    expect(violations).toEqual([])
  })
})

// ── Modal background-scroll lock (#830 guard) ───────────────────────

/**
 * `html.modal-open` drives `overflow: hidden` on `.tabContent` — the only
 * iOS-correct way to stop the background scrolling behind a modal
 * (`touch-action: none` on the overlay does nothing in iOS Safari/WKWebView).
 *
 * useModal owns it behind a REFERENCE COUNT, and that ownership has to be
 * exclusive. A component that toggles the class itself only knows about its
 * own modals: when it closes one while another surface still has a modal up,
 * its `toggle(…, false)` strips the class even though the count is > 0. The
 * background then scrolls under a `position: fixed` modal, and the moment the
 * iOS keyboard opens — visual viewport shifts, layout viewport does not —
 * paint desyncs from hit-testing and taps land a row low.
 *
 * A behavioural test only catches this in the exact component it covers.
 * This one catches it anywhere in the codebase, which is what let the
 * WorkoutTracker copy survive: no test mounted two modal-owning components
 * at once.
 */
describe('Invariant: useModal is the only owner of html.modal-open (#830)', () => {
  const OWNER = join('composables', 'useModal.ts')

  /**
   * Drop `//`-style and block-comment lines. The migration comments that
   * explain this rule quote the banned call, and a guard that flags its own
   * documentation is a guard people delete.
   */
  function stripComments(source: string): string {
    return source
      .split('\n')
      .filter(line => !/^\s*(\/\/|\/\*|\*|<!--)/.test(line))
      .join('\n')
  }

  it('no component or composable toggles the modal-open class directly', () => {
    const files = getSourceFiles()
    // Non-vacuity: the walker must actually reach the .vue components and the
    // owner itself, or this scan proves nothing.
    expect(files.map(f => f.path)).toContain(OWNER)
    expect(files.filter(f => f.path.endsWith('.vue')).length).toBeGreaterThan(20)

    const violations = files
      .filter(f => f.path !== OWNER)
      .filter(f => /classList\s*\.\s*(add|remove|toggle|replace)\s*\(\s*['"`]modal-open/.test(stripComments(f.content)))
      .map(f =>
        `${f.path} — hand-rolls the background-scroll lock. Use useModal() so ` +
        `the shared reference count decides when the class comes off.`,
      )

    expect(violations).toEqual([])
  })

  it('useModal applies the class from the reference count, not a boolean', () => {
    const owner = readFileSync(join(SRC_DIR, OWNER), 'utf-8')
    expect(owner).toMatch(/classList\.toggle\('modal-open', scrollLockCount > 0\)/)
  })
})

// ── Invariant: Row-Level Security on every table (LIFT-1130) ─────────
// Guard: tenant isolation depends ENTIRELY on RLS. The anon key ships in
// the client bundle, so anyone can hit PostgREST directly; the client-side
// .eq('user_id', ...) filters are trivially bypassable defense-in-depth,
// not a real boundary. Each table's protection is a single hand-repeated
// `alter table ... enable row level security` line in its migration. A
// future `create table` (or a recreated table) that omits that one line
// would silently expose every user's rows to any authenticated client,
// with no behavioural test failing.
//
// This scans the migrations as text and treats a missing RLS enablement as
// a build-blocking failure. It also asserts every user-scoped table carries
// at least one auth.uid()-scoped policy, so RLS-on-but-unscoped can't slip
// through either.

/** Strip SQL line comments and block comments so commented-out DDL
 *  (documentation) never counts as a real statement. */
function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(line => line.replace(/--.*$/, ''))
    .join('\n')
}

// Optional `schema.` qualifier (e.g. `public.exercises`) — captured and
// discarded so the bare table name is always group 1. Without this, a
// schema-qualified DDL would capture `public` and hide the real table from
// the RLS check, letting an unprotected table pass silently.
const SCHEMA = '(?:\\w+\\.)?'

/** Every table name introduced by a `create table [if not exists] <name>`. */
function createdTables(sql: string): string[] {
  const re = new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?["']?${SCHEMA}(\\w+)["']?`, 'gi')
  const names = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = re.exec(sql)) !== null) names.add(m[1].toLowerCase())
  return [...names]
}

/** Every table with an `alter table <name> enable row level security`. */
function rlsEnabledTables(sql: string): Set<string> {
  const re = new RegExp(`alter\\s+table\\s+(?:only\\s+)?["']?${SCHEMA}(\\w+)["']?\\s+enable\\s+row\\s+level\\s+security`, 'gi')
  const names = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = re.exec(sql)) !== null) names.add(m[1].toLowerCase())
  return names
}

/** The definition block for a `create table` — from its opening `(` to the
 *  matching `)` — used to tell whether a table is user-scoped (`user_id`). */
function tableBody(sql: string, table: string): string {
  const re = new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?["']?${SCHEMA}${table}["']?`, 'i')
  const start = sql.search(re)
  if (start === -1) return ''
  const open = sql.indexOf('(', start)
  if (open === -1) return ''
  let depth = 1
  let i = open + 1
  while (i < sql.length && depth > 0) {
    if (sql[i] === '(') depth++
    else if (sql[i] === ')') depth--
    i++
  }
  return sql.slice(open + 1, i - 1)
}

/** Created tables that never `enable row level security`. */
function tablesMissingRls(sql: string): string[] {
  const enabled = rlsEnabledTables(sql)
  return createdTables(sql).filter(t => !enabled.has(t))
}

/**
 * Each `create policy` statement, mapped to the table it targets.
 *
 * SQL is tokenized on `;` FIRST so every policy is matched in isolation — a
 * lazy `[\s\S]*?` run across the whole file could otherwise stitch two
 * consecutive policies together (`create policy … on A … on B`) and let one
 * table's `auth.uid()` clear another table's unscoped policy.
 */
function policyStatements(sql: string): { table: string; text: string }[] {
  const out: { table: string; text: string }[] = []
  const re = new RegExp(`create\\s+policy\\b[\\s\\S]*?\\bon\\s+["']?${SCHEMA}(\\w+)["']?`, 'i')
  for (const stmt of sql.split(';')) {
    const m = re.exec(stmt)
    if (m) out.push({ table: m[1].toLowerCase(), text: stmt })
  }
  return out
}

/** User-scoped tables (have a `user_id` column) with no auth.uid()-scoped policy. */
function userTablesMissingScopedPolicy(sql: string): string[] {
  const policies = policyStatements(sql)
  const missing: string[] = []
  for (const table of createdTables(sql)) {
    if (!/\buser_id\b/.test(tableBody(sql, table))) continue
    const own = policies.filter(p => p.table === table)
    if (!own.some(p => /auth\.uid\(\)/i.test(p.text))) missing.push(table)
  }
  return missing
}

describe('Invariant: RLS enabled on every Supabase table (LIFT-1130)', () => {
  const migrations = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(f => ({ name: f, content: readFileSync(join(MIGRATIONS_DIR, f), 'utf-8') }))

  const sql = stripSqlComments(migrations.map(m => m.content).join('\n'))

  it('reads the real migrations directory (non-vacuity)', () => {
    // If this ever finds zero migrations the whole suite would pass for the
    // wrong reason — pin the core tables so a broken path can't hide a gap.
    expect(migrations.length).toBeGreaterThan(5)
    expect(createdTables(sql)).toEqual(
      expect.arrayContaining(['exercises', 'sets', 'bodyweight_entries']),
    )
  })

  it('the scan actually flags a table missing RLS / a scoped policy (self-test)', () => {
    // Proves the regexes aren't vacuously passing: a leaky table with a
    // user_id column but no RLS and no policy must be caught by both checks.
    const leaky = `create table leaky (
      id uuid primary key,
      user_id uuid not null references auth.users(id)
    );`
    const bad = stripSqlComments(leaky)
    expect(tablesMissingRls(bad)).toContain('leaky')
    expect(userTablesMissingScopedPolicy(bad)).toContain('leaky')

    // And a well-formed table passes both.
    const good = bad +
      '\nalter table leaky enable row level security;' +
      '\ncreate policy "p" on leaky for select using (auth.uid() = user_id);'
    expect(tablesMissingRls(good)).not.toContain('leaky')
    expect(userTablesMissingScopedPolicy(good)).not.toContain('leaky')

    // Cross-statement stitching guard: a scoped policy on ANOTHER table must
    // not launder an unscoped (or missing) policy on the target table.
    const stitched = bad +
      '\nalter table leaky enable row level security;' +
      '\ncreate policy "safe" on other for select using (auth.uid() = user_id);' +
      '\ncreate policy "leak" on leaky for select using (true);'
    expect(userTablesMissingScopedPolicy(stitched)).toContain('leaky')

    // Schema-qualified DDL (`public.<table>`) must resolve to the bare table
    // name, not the schema — otherwise an unprotected qualified table hides.
    const qualified = stripSqlComments(`create table public.walled (
      id uuid primary key,
      user_id uuid not null
    );`)
    expect(createdTables(qualified)).toContain('walled')
    expect(createdTables(qualified)).not.toContain('public')
    expect(tablesMissingRls(qualified)).toContain('walled')
  })

  it('every created table has RLS enabled in some migration', () => {
    const missing = tablesMissingRls(sql)

    expect(
      missing,
      'These tables are created but never `enable row level security`. ' +
      'The anon key is public, so RLS is the ONLY tenant boundary — a table ' +
      'without it exposes every user\'s rows. Add ' +
      '`alter table <name> enable row level security;` in the same migration:\n' +
      missing.join('\n'),
    ).toEqual([])
  })

  it('every user-scoped table carries at least one auth.uid()-scoped policy', () => {
    // A `user_id` column means rows belong to a user; that table must have at
    // least one policy that scopes access to auth.uid(). (Tables with no
    // user_id — e.g. the day-keyed coach_global_spend, touched only by
    // SECURITY DEFINER functions — are deliberately policy-free and skipped.)
    const violations = userTablesMissingScopedPolicy(sql).map(
      table =>
        `${table} — has a user_id column but no create policy scoped to ` +
        `auth.uid(). RLS with no scoped policy either denies all access or ` +
        `(if a permissive policy exists) leaks across tenants.`,
    )

    expect(violations).toEqual([])
  })
})
