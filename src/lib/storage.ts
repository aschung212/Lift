/**
 * Read and parse a JSON value from localStorage.
 *
 * Returns `fallback` when the key is absent, the value is unparseable, or
 * `validate` rejects the parsed shape — corrupt storage must never throw
 * into store/composable initialization. The fallback is returned as-is, so
 * pass a fresh literal (not a shared module-level object) when the caller
 * mutates the result.
 */
export function loadJSON<T>(key: string, fallback: T, validate?: (parsed: unknown) => boolean): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    const parsed: unknown = JSON.parse(raw)
    if (validate && !validate(parsed)) return fallback
    return parsed as T
  } catch {
    return fallback
  }
}

/**
 * True for a non-null, non-array object (the shape of a parsed JSON object), and
 * narrows to `Record<string, unknown>` so a caller reads fields without a cast.
 * Also a `loadJSON` `validate` helper. The one definition of this check
 * (LIFT-1599): import it rather than re-declaring it. `aiCoach.ts` imports it,
 * which puts this module in the `api/coach.ts` function too, so keep it free of
 * import-time browser access.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
