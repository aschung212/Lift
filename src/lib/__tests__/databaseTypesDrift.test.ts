/**
 * Schema-drift guard for database.types.ts (LIFT-1131).
 *
 * `database.types.ts` is hand-maintained against the SQL migrations rather than
 * regenerated from a live DB (there is no DB connection in CI). That is fine —
 * as long as it stays in sync. It had *silently* drifted: migrations added
 * `updated_at` to `sets` and `bodyweight_entries` (and `plate_loaded` to
 * `exercises`), yet those columns were absent from the corresponding Row types.
 * `select('*')` returns those columns at runtime while the type system denies
 * they exist, which is exactly what forced `supabase as any` escape hatches and,
 * worse, blinds the typed client to a genuine future column rename.
 *
 * This test parses the migration SQL and asserts that every column added to a
 * client-typed table appears in that table's Row/Insert/Update shapes in
 * database.types.ts. It runs with zero DB access, so it can gate every PR the
 * way `supabase gen types --check` would if a DB were reachable.
 *
 * Scope: only the tables the browser client actually queries through the typed
 * `Database` (exercises, sets, bodyweight_entries, user_preferences,
 * progression_snapshots, user_progression, xp_events). The server-only AI-coach
 * tables are deliberately excluded from the client types and from this guard.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = resolve(__dirname, '../../../supabase/migrations')
const TYPES_FILE = resolve(__dirname, '../database.types.ts')

/** Tables that are part of the browser-client typed Database. */
const CLIENT_TABLES = [
  'exercises',
  'sets',
  'bodyweight_entries',
  'user_preferences',
  'progression_snapshots',
  'user_progression',
  'xp_events',
] as const

/**
 * Parse the migration SQL corpus into a table -> Set<column> map.
 *
 * Handles the two shapes the migrations use:
 *   - `create table <name> ( col type ..., col type ..., <constraints> )`
 *   - `alter table <name> add column [if not exists] <col> ...`
 *   - `alter table <name> drop column [if exists] <col>`
 * SQL keywords are case-insensitive; identifiers are lower-cased for matching.
 */
function columnsFromMigrations(): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>()
  const ensure = (t: string) => {
    const key = t.toLowerCase()
    if (!tables.has(key)) tables.set(key, new Set())
    return tables.get(key)!
  }

  // Column lines inside a CREATE TABLE body start with an identifier; skip
  // table-level constraint clauses that begin with these keywords.
  const CONSTRAINT_KEYWORDS = new Set([
    'primary', 'foreign', 'unique', 'constraint', 'check', 'exclude', 'like',
  ])

  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort() // timestamp-prefixed → chronological, so drops apply after adds
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8')

    // ALTER TABLE ... ADD COLUMN [IF NOT EXISTS] <col>
    // The optional `(?:\w+\.)?` strips a schema qualifier (e.g. `public.sets`)
    // so it isn't mistaken for the table name (which would drop the real column).
    for (const m of sql.matchAll(
      /alter\s+table\s+(?:if\s+exists\s+)?(?:\w+\.)?(\w+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)/gi,
    )) {
      ensure(m[1]).add(m[2].toLowerCase())
    }

    // ALTER TABLE ... DROP COLUMN [IF EXISTS] <col>
    for (const m of sql.matchAll(
      /alter\s+table\s+(?:if\s+exists\s+)?(?:\w+\.)?(\w+)\s+drop\s+column\s+(?:if\s+exists\s+)?(\w+)/gi,
    )) {
      ensure(m[1]).delete(m[2].toLowerCase())
    }

    // CREATE TABLE <name> ( ...body... )
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:\w+\.)?(\w+)\s*\(([\s\S]*?)\n\)/gi)) {
      const cols = ensure(m[1])
      // Split the body on top-level commas (no nested parens appear in these
      // simple column defs, so a plain split is safe here).
      for (const rawLine of m[2].split(',')) {
        const line = rawLine.trim()
        if (!line) continue
        const first = line.split(/\s+/)[0].toLowerCase()
        if (CONSTRAINT_KEYWORDS.has(first)) continue
        if (/^\w+$/.test(first)) cols.add(first)
      }
    }
  }
  return tables
}

/**
 * Parse database.types.ts into table -> { Row, Insert, Update } column-name sets.
 * The generated file nests each table as `<name>: { Row: { ... } ... }`; we walk
 * the `public.Tables` block and extract the `key:`/`key?:` identifiers from each
 * of the three shape objects.
 */
function columnsFromTypes(): Map<string, { Row: Set<string>; Insert: Set<string>; Update: Set<string> }> {
  const src = readFileSync(TYPES_FILE, 'utf-8')
  const out = new Map<string, { Row: Set<string>; Insert: Set<string>; Update: Set<string> }>()

  for (const table of CLIENT_TABLES) {
    const tableStart = src.indexOf(`\n      ${table}: {`)
    // A missing table is reported by the dedicated "declares every client table"
    // test below — skip it here rather than throwing during describe-phase setup,
    // which would crash the whole file instead of failing one named test.
    if (tableStart === -1) continue

    const shapes = { Row: new Set<string>(), Insert: new Set<string>(), Update: new Set<string>() }
    for (const shape of ['Row', 'Insert', 'Update'] as const) {
      const shapeStart = src.indexOf(`${shape}: {`, tableStart)
      const bodyStart = src.indexOf('{', shapeStart) + 1
      // Find the matching close brace for this shape object.
      let depth = 1
      let i = bodyStart
      for (; i < src.length && depth > 0; i++) {
        if (src[i] === '{') depth++
        else if (src[i] === '}') depth--
      }
      const body = src.slice(bodyStart, i - 1)
      for (const line of body.split('\n')) {
        const m = line.match(/^\s*(\w+)\??:/)
        if (m) shapes[shape].add(m[1])
      }
    }
    out.set(table, shapes)
  }
  return out
}

describe('database.types.ts schema-drift guard (LIFT-1131)', () => {
  const migrationCols = columnsFromMigrations()
  const typeCols = columnsFromTypes()

  it('parsed a non-trivial schema from the migrations', () => {
    // Sanity check the parser itself so a regex break can't silently pass the
    // suite by producing empty column sets.
    expect(migrationCols.get('exercises')!.size).toBeGreaterThan(5)
    expect(migrationCols.get('sets')!.has('updated_at')).toBe(true)
    expect(migrationCols.get('bodyweight_entries')!.has('updated_at')).toBe(true)
  })

  it('database.types.ts declares every client-typed table', () => {
    const missing = CLIENT_TABLES.filter(t => !typeCols.has(t))
    expect(missing, `tables absent from database.types.ts: ${missing.join(', ')}`).toEqual([])
  })

  for (const table of CLIENT_TABLES) {
    it(`Row type for "${table}" covers every column the migrations define`, () => {
      const expected = migrationCols.get(table)
      expect(expected, `no migration defines table "${table}"`).toBeDefined()
      const row = typeCols.get(table)!.Row
      const missing = [...expected!].filter(col => !row.has(col))
      expect(
        missing,
        `Row type for "${table}" is missing migration columns: ${missing.join(', ')}. ` +
          `Regenerate/hand-sync src/lib/database.types.ts against the migrations.`,
      ).toEqual([])
    })

    it(`Insert/Update types for "${table}" cover every column the migrations define`, () => {
      const expected = migrationCols.get(table)!
      const { Insert, Update } = typeCols.get(table)!
      const missingInsert = [...expected].filter(col => !Insert.has(col))
      const missingUpdate = [...expected].filter(col => !Update.has(col))
      expect(missingInsert, `Insert type for "${table}" missing: ${missingInsert.join(', ')}`).toEqual([])
      expect(missingUpdate, `Update type for "${table}" missing: ${missingUpdate.join(', ')}`).toEqual([])
    })

    it(`Row type for "${table}" has no phantom columns absent from the migrations`, () => {
      const expected = migrationCols.get(table)!
      const row = typeCols.get(table)!.Row
      const phantom = [...row].filter(col => !expected.has(col))
      expect(
        phantom,
        `Row type for "${table}" declares columns not in any migration: ${phantom.join(', ')}. ` +
          `Either the type is stale or a migration is missing.`,
      ).toEqual([])
    })
  }
})
