/**
 * Guarded localStorage reads, and the app's one plain-object guard.
 *
 * `api/coach.ts` runs on the server and imports `aiCoach.ts`, which imports
 * `isPlainObject` from here. So this module must load in Node: nothing in it,
 * or in anything it imports, may touch a browser API at load time.
 * `localStorage` is read only when `loadJSON` is called.
 */

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
 * It does not check the prototype (a `Date` passes), which is moot for parsed
 * JSON. Also a `loadJSON` `validate` helper. The one definition of this check
 * (LIFT-1599): import it rather than re-declaring it.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
