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
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

// ── Shared helpers ──────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const STORES_DIR = resolve(__dirname, '../../stores')

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
