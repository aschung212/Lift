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

/**
 * Drop `//`-style and block-comment lines. Comments that explain a banned
 * pattern often quote the banned call, and a guard that flags its own
 * documentation is a guard people delete. Shared by the modal-open and
 * reload-guard invariants.
 */
function stripComments(source: string): string {
  return source
    .split('\n')
    .filter(line => !/^\s*(\/\/|\/\*|\*|<!--)/.test(line))
    .join('\n')
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

// ── Invariant 2b: every store write is durable (LIFT-1239) ──────────
// Guard: the IndexedDB write journal (LIFT-706) only engages when a caller
// passes a SyncDescriptor — a descriptor-less enqueue silently keeps the legacy
// in-memory-only behavior, so the write is lost if the app closes before the 1s
// flush and has no durable record to retain when retries are exhausted
// (LIFT-1229). Only workout.ts passed descriptors for a year; bodyweight,
// preferences and progression didn't, and none of those three has a
// reconciliation pass to recover the write later. Nothing failed when a table
// opted out, which is why it went unnoticed — hence a structural guard.

/**
 * Argument count of the call starting at `start` (index of the `(`), counting
 * only commas at the top level of the argument list — commas inside nested
 * calls, object/array literals, and strings belong to an argument, not to the
 * list. Returns 0 for `f()`.
 */
function countCallArgs(source: string, start: number): number {
  let depth = 0
  let args = 1
  let quote: string | null = null
  for (let i = start; i < source.length; i++) {
    const ch = source[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
    if (ch === '(' || ch === '{' || ch === '[') depth++
    else if (ch === ')' || ch === '}' || ch === ']') {
      depth--
      if (depth === 0) return source.slice(start + 1, i).trim() === '' ? 0 : args
    } else if (ch === ',' && depth === 1) args++
  }
  throw new Error('Unbalanced call expression while scanning syncQueue arguments')
}

describe('Invariant: store writes carry a durable descriptor (LIFT-1239)', () => {
  /**
   * An enqueue may opt out of the journal only with this marker plus a written
   * justification. The one current exemption is bodyweight's `clearAll`: its
   * match is unbounded ("every live row for this user"), a descriptor can only
   * express `eq` filters so the `.is('deleted_at', null)` guard would be lost
   * on replay, and re-applying a wipe on the next launch would destroy entries
   * logged on another device in the meantime.
   */
  const EXEMPT_MARKER = 'durable-journal-exempt'

  /** Every syncQueue.enqueue / enqueueDelete call site under src/stores/. */
  function enqueueCallSites(): { file: string; line: number; args: number; exempt: boolean }[] {
    const sites: { file: string; line: number; args: number; exempt: boolean }[] = []
    for (const { name, content } of getStoreFiles()) {
      const re = /syncQueue\s*\.\s*(enqueue|enqueueDelete)\s*\(/g
      let match: RegExpExecArray | null
      while ((match = re.exec(content)) !== null) {
        const open = match.index + match[0].length - 1
        sites.push({
          file: name,
          line: content.slice(0, match.index).split('\n').length,
          args: countCallArgs(content, open),
          // The marker must be the last comment line before the call, so it
          // can't be inherited from an unrelated block further up.
          exempt: content
            .slice(0, match.index)
            .trimEnd()
            .split('\n')
            .slice(-1)[0]
            .includes(EXEMPT_MARKER),
        })
      }
    }
    return sites
  }

  it('the argument counter handles nested literals, arrows and strings (self-test)', () => {
    const two = "syncQueue.enqueue(`k:${id}`, () => supabase!.from('x').update(v).eq('id', id))"
    expect(countCallArgs(two, two.indexOf('('))).toBe(2)
    const three = "syncQueue.enqueue('k', () => f(a, b), { op: 'update', values: { a: 1 }, match: { b: 2 } })"
    expect(countCallArgs(three, three.indexOf('('))).toBe(3)
    // A comma inside a string literal must not be read as an argument separator.
    const stringy = "syncQueue.enqueue('a,b', op)"
    expect(countCallArgs(stringy, stringy.indexOf('('))).toBe(2)
  })

  it('every store enqueue passes a SyncDescriptor (or is explicitly exempt)', () => {
    const sites = enqueueCallSites()

    // Non-vacuity: all four stores must be reached, or the scan proves nothing.
    expect(sites.length).toBeGreaterThan(5)
    for (const file of ['workout.ts', 'bodyweight.ts', 'preferences.ts', 'progression.ts']) {
      expect(sites.some(s => s.file === file), `${file} has no syncQueue call site`).toBe(true)
    }

    const violations = sites
      .filter(s => s.args < 3 && !s.exempt)
      .map(s =>
        `${s.file}:${s.line} — syncQueue enqueue with ${s.args} arguments and no ` +
        `SyncDescriptor. Without one the write is in-memory only: it is lost if ` +
        `the app closes before the flush, and has no durable record to retain ` +
        `when retries are exhausted. Pass a descriptor, or add a ` +
        `'${EXEMPT_MARKER}' comment above the call with a justification.`,
      )

    expect(violations).toEqual([])
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

// ── Invariant 3b: collection reads must page (#1152) ────────────────
// Guard: PostgREST truncates every response at max_rows (1000) and reports it
// nowhere. An unpaged `.select()` on a collection therefore returns the first
// page and looks successful — which silently hid 454 of a real user's 1454 sets
// and made the app claim they hadn't trained in four weeks.
//
// A read is exempt only when it can't return a collection: `.single()` /
// `.maybeSingle()` (one row by contract) or a `head: true` count probe (no rows
// at all). Everything else must go through `fetchAllRows`.

describe('Invariant: Supabase collection reads are paged (#1152)', () => {
  /** Collection tables — a per-user read of these can exceed max_rows. */
  const COLLECTION_TABLES = ['sets', 'exercises', 'bodyweight_entries']

  it('no store reads a collection table without fetchAllRows', () => {
    const violations: string[] = []

    for (const { name, content } of getStoreFiles()) {
      for (const table of COLLECTION_TABLES) {
        // Find each `.from('<table>')` and inspect the chain that follows it.
        const pattern = new RegExp(`\\.from\\(\\s*['"\`]${table}['"\`]\\s*\\)`, 'g')
        let match: RegExpExecArray | null
        while ((match = pattern.exec(content)) !== null) {
          // The chain runs to the end of the statement; 500 chars covers the
          // longest multi-line query in the stores by a wide margin.
          const chain = content.slice(match.index, match.index + 500)
          const isSelect = /^\s*\.from\([^)]*\)\s*[\s\S]{0,80}?\.select\(/.test(chain)
          if (!isSelect) continue // upsert/update/delete are unaffected by max_rows
          if (/\.(single|maybeSingle)\s*\(/.test(chain.slice(0, 300))) continue
          if (/head:\s*true/.test(chain.slice(0, 300))) continue

          // The read must be wrapped by the paging helper, which appears just
          // before `.from(` on the same expression.
          const before = content.slice(Math.max(0, match.index - 200), match.index)
          if (!/fetchAllRows\s*\(/.test(before)) {
            const line = content.slice(0, match.index).split('\n').length
            violations.push(
              `${name}:${line} — reads the '${table}' collection without ` +
              `fetchAllRows. PostgREST caps the response at max_rows (1000) ` +
              `with no error, so this silently returns a partial collection.`,
            )
          }
        }
      }
    }

    expect(violations).toEqual([])
  })

  it('every paged read carries a total sort order', () => {
    // Pagination is only coherent under a deterministic order. `created_at` is
    // `default now()`, so a CSV import writes many rows with an identical
    // value; without a tiebreaker the database may order ties differently
    // between two page requests, repeating some rows and skipping others.
    const violations: string[] = []

    for (const { name, content } of getStoreFiles()) {
      const pattern = /fetchAllRows\s*\(/g
      let match: RegExpExecArray | null
      while ((match = pattern.exec(content)) !== null) {
        const chain = content.slice(match.index, match.index + 500)
        const orderCount = (chain.match(/\.order\(/g) || []).length
        if (orderCount < 2) {
          const line = content.slice(0, match.index).split('\n').length
          violations.push(
            `${name}:${line} — paged read has ${orderCount} .order() clause(s). ` +
            `A paged read needs a total order (add .order('id') as a tiebreaker).`,
          )
        }
      }
    }

    expect(violations).toEqual([])
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

// ── Invariant: automatic reloads are circuit-broken (#1155) ─────────
// Guard: 2026-08-17 — the installed iOS PWA hit "A problem repeatedly
// occurred" (WebKit's kill screen for an app that fails repeatedly at boot).
// An automatic `location.reload()` whose trigger condition recurs after the
// reload loops the boot forever, with zero telemetry. guardedReload
// (src/lib/reloadGuard.ts) bounds every automatic reload to one per trigger
// per session and reports suppressed repeats to Sentry — but only if new
// reload sites actually route through it. This scan makes that structural.

describe('Invariant: automatic reloads go through guardedReload (#1155)', () => {
  const OWNER = join('lib', 'reloadGuard.ts')

  // USER-initiated reloads are exempt: a human tapping a button is not a
  // loop — the danger is code reloading with no human in the path. Every
  // entry here must be a reload behind an explicit user gesture.
  const USER_INITIATED = new Set([
    // Dev tools (localhost/LAN only), each behind an explicit tap.
    join('components', 'SettingsSheet.vue'),
  ])

  const RELOAD_CALL = /\blocation\s*\.\s*reload\s*\(/

  it('no source file calls location.reload() directly except the guard owner', () => {
    const files = getSourceFiles()
    // Non-vacuity: the walker must reach the owner and the known exempt
    // file, or this scan proves nothing.
    expect(files.map(f => f.path)).toContain(OWNER)
    expect(files.map(f => f.path)).toContain(join('components', 'SettingsSheet.vue'))

    const violations = files
      .filter(f => f.path !== OWNER && !USER_INITIATED.has(f.path))
      .filter(f => RELOAD_CALL.test(stripComments(f.content)))
      .map(f =>
        `${f.path} — calls location.reload() directly. An automatic reload ` +
        `whose trigger recurs is a boot loop; route it through ` +
        `guardedReload('<reason>') from src/lib/reloadGuard.ts. If this is a ` +
        `USER-initiated reload behind an explicit tap, add the file to the ` +
        `USER_INITIATED allowlist with a justification instead.`,
      )

    expect(violations).toEqual([])
  })

  it('the scan actually flags a direct reload and skips commented ones (self-test)', () => {
    expect(RELOAD_CALL.test(stripComments('const a = 1\nwindow.location.reload()'))).toBe(true)
    expect(RELOAD_CALL.test(stripComments('doRefresh()\nlocation.reload()'))).toBe(true)
    expect(RELOAD_CALL.test(stripComments('// window.location.reload()'))).toBe(false)
    expect(RELOAD_CALL.test(stripComments(' * `controllerchange → window.location.reload()`'))).toBe(false)
  })

  it('the exempt call sites are still the dev tools they were vetted as', () => {
    // The allowlist is only sound while its reloads stay behind the
    // localhost-gated dev tools. If SettingsSheet's dev gate disappears,
    // re-vet every reload in the file before loosening this.
    const settingsSheet = readFileSync(join(SRC_DIR, 'components', 'SettingsSheet.vue'), 'utf-8')
    expect(settingsSheet).toMatch(/const isDev = /)
  })
})
