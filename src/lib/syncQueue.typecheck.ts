/**
 * Compile-time assertions for the typed sync-descriptor schema (LIFT-948).
 *
 * This file contains NO runtime code — only type-level statements — so it emits
 * nothing to the bundle and is never imported. It exists purely so `npm run
 * typecheck` (vue-tsc, which covers `src/**` but excludes `*.test.ts`) fails if
 * the `SyncDescriptor` schema ever loosens back toward `Record<string, unknown>`
 * or lets an unknown table / column through. The `@ts-expect-error` lines are
 * inverted assertions: each MUST error, and typecheck fails if one stops
 * erroring (e.g. `table` widens back to `string`).
 */
import type { Database } from './database.types'
import type { SyncDescriptor, SyncDescriptorFor, SyncTable } from './syncQueue'

type PublicTables = Database['public']['Tables']

/** `true` iff `A` and `B` are mutually assignable (exact type equality). */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false

/** Compiles only when `T` is exactly `true`. */
type Expect<T extends true> = T

// ── The table union is bound to the generated schema, not a bare string ──
export type _TableIsSchemaKeyed = Expect<Equal<SyncTable, keyof PublicTables>>

// A `string`-typed table is NOT a valid SyncTable — the whole point of the
// tightening. If this stopped erroring, `SyncTable` has widened back to string.
// @ts-expect-error - an arbitrary string is not an allowed table name
export type _RejectsArbitraryTable = SyncDescriptorFor<string>

// @ts-expect-error - a table absent from the schema is rejected
export type _RejectsUnknownTable = SyncDescriptorFor<'definitely_not_a_table'>

// ── Upsert rows are the table's generated Insert shape, per table literal ──
type SetUpsertRow = Extract<SyncDescriptor, { op: 'upsert'; table: 'sets' }>['row']
export type _SetRowIsInsert = Expect<Equal<SetUpsertRow, PublicTables['sets']['Insert']>>

type ExerciseUpsertRow = Extract<SyncDescriptor, { op: 'upsert'; table: 'exercises' }>['row']
export type _ExerciseRowIsInsert = Expect<Equal<ExerciseUpsertRow, PublicTables['exercises']['Insert']>>

// ── Update values are the table's generated Update shape, per table literal ──
type SetUpdateValues = Extract<SyncDescriptor, { op: 'update'; table: 'sets' }>['values']
export type _SetValuesAreUpdate = Expect<Equal<SetUpdateValues, PublicTables['sets']['Update']>>

// The row type is NOT an untyped record any more — a set row is the strict
// Insert shape, so it is NOT mutually assignable with `Record<string, unknown>`
// (the old freedom this issue removes).
// @ts-expect-error - a typed upsert row is not equal to an untyped record
export type _RejectsUntypedRow = Expect<Equal<SetUpsertRow, Record<string, unknown>>>
