/**
 * Database type-drift guard (LIFT-783).
 *
 * `database.types.ts` is the single source of compile-time safety for every
 * Supabase query — "if it compiles, the shape is right." That guarantee only
 * holds while the generated types track the SQL migrations. They had drifted:
 * the `plate_loaded` column was missing entirely, `input_mode` was typed
 * nullable despite a NOT NULL default, and the client synced a field
 * (`plateCountMode`) that had no column at all, so it silently diverged across
 * devices.
 *
 * These tests scan the committed migrations and the workout store to catch
 * that class of drift without needing a live database in CI:
 *   1. every column an ADD COLUMN migration creates must appear in the typed
 *      table it belongs to;
 *   2. every field the store actually upserts must map to a known column.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { execSync } from 'child_process'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const MIGRATIONS_DIR = resolve(__dirname, '../../../supabase/migrations')
const TYPES_PATH = resolve(__dirname, '../database.types.ts')
const WORKOUT_STORE_PATH = resolve(__dirname, '../../stores/workout.ts')

const typesSource = readFileSync(TYPES_PATH, 'utf-8')
const workoutSource = readFileSync(WORKOUT_STORE_PATH, 'utf-8')

/**
 * The committed migration files. We deliberately exclude untracked (WIP)
 * migrations: an in-flight feature branch may have a migration in the working
 * tree whose matching type changes live on a different PR. Drift is only
 * meaningful between *committed* schema and *committed* types.
 */
function getCommittedMigrationFiles(): string[] {
  const all = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql'))
  try {
    const tracked = new Set(
      execSync('git ls-files', { cwd: MIGRATIONS_DIR, encoding: 'utf-8' })
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean),
    )
    const committed = all.filter(f => tracked.has(f))
    // If git reports nothing (detached/odd checkout), fall back to all files
    // rather than vacuously passing.
    return committed.length > 0 ? committed : all
  } catch {
    return all
  }
}

/** Extract the body of a named type block (Row/Insert/Update) by brace-count. */
function extractTableBlock(source: string, table: string): string {
  const marker = `      ${table}: {`
  const start = source.indexOf(marker)
  if (start === -1) throw new Error(`Table "${table}" not found in database.types.ts`)
  const open = source.indexOf('{', start)
  let depth = 1
  let i = open + 1
  while (i < source.length && depth > 0) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') depth--
    i++
  }
  return source.slice(open + 1, i - 1)
}

/** Extract a function body from source using brace-counting. */
function extractFunctionBody(source: string, signature: string): string {
  const fnStart = source.indexOf(signature)
  if (fnStart === -1) throw new Error(`Function "${signature}" not found`)
  const open = source.indexOf('{', fnStart)
  let depth = 1
  let i = open + 1
  while (i < source.length && depth > 0) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') depth--
    i++
  }
  return source.slice(open + 1, i - 1)
}

/** All `ALTER TABLE <t> ADD COLUMN [IF NOT EXISTS] <col>` pairs in committed migrations. */
function getMigrationColumns(): { table: string; column: string; file: string }[] {
  const pairs: { table: string; column: string; file: string }[] = []
  const re = /alter\s+table\s+(\w+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)/gi
  for (const file of getCommittedMigrationFiles()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8')
    let m: RegExpExecArray | null
    while ((m = re.exec(sql)) !== null) {
      pairs.push({ table: m[1], column: m[2], file })
    }
  }
  return pairs
}

describe('database.types.ts drift guard (LIFT-783)', () => {
  it('every column added by a committed migration appears in its typed table', () => {
    const violations: string[] = []
    const blockCache = new Map<string, string>()

    for (const { table, column, file } of getMigrationColumns()) {
      if (!blockCache.has(table)) blockCache.set(table, extractTableBlock(typesSource, table))
      const block = blockCache.get(table)!
      // Column keys appear as `<column>:` / `<column>?:` inside the Row/Insert/Update shapes.
      const present = new RegExp(`\\b${column}\\??:`).test(block)
      if (!present) {
        violations.push(
          `${file}: column "${column}" on table "${table}" is missing from database.types.ts. ` +
          `Regenerate the types (supabase gen types) or add it by hand.`,
        )
      }
    }

    expect(violations, violations.join('\n')).toEqual([])
  })

  it('input_mode is typed NOT NULL to match its DB default (no nullable drift)', () => {
    const block = extractTableBlock(typesSource, 'exercises')
    // Row shape must type input_mode as a non-nullable string.
    expect(block).toMatch(/input_mode:\s*string\b/)
    expect(block).not.toMatch(/input_mode:\s*string\s*\|\s*null/)
  })

  it('every field _buildExerciseUpsert sends maps to a known exercises column', () => {
    const body = extractFunctionBody(workoutSource, 'function _buildExerciseUpsert(')
    const exercisesBlock = extractTableBlock(typesSource, 'exercises')

    // Object keys in the upsert payload are snake_case identifiers followed by `:`.
    const keys = new Set<string>()
    const keyRe = /\b([a-z][a-z0-9_]+):/g
    let m: RegExpExecArray | null
    while ((m = keyRe.exec(body)) !== null) keys.add(m[1])

    // Sanity: the payload must include the previously-diverging field.
    expect(keys.has('plate_count_mode'), 'plateCountMode must now be synced').toBe(true)

    const unmapped = [...keys].filter(k => !new RegExp(`\\b${k}\\??:`).test(exercisesBlock))
    expect(
      unmapped,
      `Synced exercise field(s) with no matching column in database.types.ts: ${unmapped.join(', ')}`,
    ).toEqual([])
  })
})
