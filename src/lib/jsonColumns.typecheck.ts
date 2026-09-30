/**
 * Compile-time assertions for `JsonSafe` / `toJsonColumn` (LIFT-1493).
 *
 * This file contains NO runtime code — only type-level statements — so it emits
 * nothing to the bundle and is never imported. It exists purely so `npm run
 * typecheck` (vue-tsc, which covers `src/**` but excludes `*.test.ts`) fails if
 * the constraint ever loosens back toward the `as unknown as Json` double cast
 * it replaced. The `@ts-expect-error` lines are inverted assertions: each MUST
 * error, and typecheck fails if one stops erroring.
 *
 * Only the REJECTING direction is asserted here. The accepting direction is
 * already proven by production code — `preferences._persist` calls
 * `toJsonColumn(payload)` with the real 17-field blob, and typecheck covers it —
 * so a `JsonSafe` that degenerated to `any` and accepted everything would pass a
 * positive assertion and fail these.
 */
import type { JsonSafe, toJsonColumn } from './jsonColumns'

/** The parameter type `toJsonColumn` declares, with `T` already inferred. */
type ToJsonColumnArg<T> = T & JsonSafe<T>

/** `true` iff `toJsonColumn(value: T)` would compile. */
type Accepts<T> = T extends ToJsonColumnArg<T> ? true : false

/** Compiles only when `T` is exactly `true`. */
type Expect<T extends true> = T

/** `true` iff `A` and `B` are mutually assignable (exact type equality). */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false

// The local restatement above must stay in step with the real signature — a
// widened parameter (back to `Json`, or to a bare `T`) would otherwise leave
// every assertion below measuring a type nothing calls.
export type _ArgMatchesSignature =
  Expect<Equal<Parameters<typeof toJsonColumn>[0], ToJsonColumnArg<unknown>>>

// ── Plain JSON data is accepted ───────────────────────────────────
export type _AcceptsNestedPlainData = Expect<Accepts<{
  flags: { [key: string]: boolean }
  presets: number[]
  anchor: string | null
  profile: { competing: boolean; competition: { sport: string } }
}>>

// ── Anything JSON can't represent is rejected ─────────────────────

// A Date survives `JSON.stringify` only because it hands over a method; the
// column would read back as a string on one device and a Date-shaped object on
// none. Its state lives behind methods, so every field maps to `never`.
// @ts-expect-error - a Date is not JSON data
export type _RejectsDate = Expect<Accepts<Date>>

// A Map/Set serializes to `{}` — the silent one, and the reason this is a type
// error rather than a lint rule.
// @ts-expect-error - a Map is not JSON data
export type _RejectsMap = Expect<Accepts<Map<string, number>>>

// @ts-expect-error - a Set is not JSON data
export type _RejectsSet = Expect<Accepts<Set<string>>>

// @ts-expect-error - a function is dropped entirely by JSON.stringify
export type _RejectsFunctionField = Expect<Accepts<{ onDone: () => void }>>

// Nesting must be checked all the way down, not just at the top level.
// @ts-expect-error - a nested Date is still not JSON data
export type _RejectsNestedDate = Expect<Accepts<{ profile: { updatedAt: Date } }>>

// @ts-expect-error - an array of non-JSON values is not JSON data
export type _RejectsArrayOfDates = Expect<Accepts<{ history: Date[] }>>
