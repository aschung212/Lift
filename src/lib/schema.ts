/**
 * Shared runtime-validation primitives for the deserialization boundary.
 *
 * Every persisted store hydrates from an untrusted source — localStorage,
 * IndexedDB, a cross-tab BroadcastChannel payload, or a Supabase JSON blob.
 * Historically each store invented its own posture: some validated every
 * field, some only checked `Array.isArray`, and some spread `JSON.parse`
 * results wholesale (so a corrupt cross-tab broadcast could inject a
 * non-boolean feature flag straight into reactive state). This module is the
 * single, declarative place those boundaries share so the validation style
 * can't drift store-to-store (LIFT-949).
 *
 * Rule: no `JSON.parse` result may be cast to a domain type without first
 * passing through a guard here (or a domain-specific parser built on these).
 */

/** Narrow an unknown value to a non-null, non-array object. */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** A type guard usable as a per-field validator in the merge helpers. */
export type Guard<T> = (v: unknown) => v is T

export const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean'
export const isString = (v: unknown): v is string => typeof v === 'string'
/** Finite numbers only — rejects NaN/±Infinity which JSON can round-trip as null but structured-clone cannot. */
export const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Merge an untrusted object over defaults for an OPEN-shaped map — one whose
 * TypeScript contract is `{ [key: string]: V }` (e.g. `FeatureFlags`). Every
 * key from `raw` whose value passes `validate` is copied (preserving
 * forward-compatible keys a newer app version may have written); any key whose
 * value fails validation is dropped in favor of the default. Never mutates
 * `defaults` or `raw`.
 */
export function mergeValidatedOpen<V>(
  defaults: Record<string, V>,
  raw: unknown,
  validate: Guard<V>,
): Record<string, V> {
  const result: Record<string, V> = { ...defaults }
  if (!isPlainObject(raw)) return result
  for (const [key, value] of Object.entries(raw)) {
    if (validate(value)) result[key] = value
  }
  return result
}

/**
 * Merge an untrusted object over defaults for a CLOSED-shaped record — one with
 * a fixed set of known keys (e.g. `ExperienceFlags`, `FilterSettings`). Only
 * keys present in `defaults` are considered, and each is taken from `raw` only
 * when its value passes `validate`; unknown keys in `raw` are ignored so junk
 * can't accrete onto a typed shape. Never mutates `defaults` or `raw`.
 */
export function mergeValidatedKnown<T extends Record<string, unknown>>(
  defaults: T,
  raw: unknown,
  validate: Guard<T[keyof T]>,
): T {
  const result = { ...defaults }
  if (!isPlainObject(raw)) return result
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    const value = raw[key as string]
    if (validate(value)) result[key] = value as T[keyof T]
  }
  return result
}
