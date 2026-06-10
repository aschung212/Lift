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

/** `validate` helper for plain-object payloads (rejects arrays and null). */
export function isPlainObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
