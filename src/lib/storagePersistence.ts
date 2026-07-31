/**
 * Storage-eviction warning decision (LIFT-1063).
 *
 * `navigator.storage.persist()` reports whether the browser granted persistent
 * storage. When it is DENIED, the browser may evict IndexedDB + localStorage
 * under storage pressure — and iOS Safari evicts the storage of an un-installed
 * PWA after ~7 days of inactivity. For a local-first app that means silent
 * workout-data loss for a user whose writes haven't reached Supabase yet (logged
 * offline, or before a sync completed).
 *
 * When persistence is denied we nudge the user to add Lift to their Home Screen:
 * installed PWAs are granted persistent storage and are not subject to the 7-day
 * eviction, so their local data is durably retained alongside cloud sync.
 *
 * `App.vue` currently discards the boolean `requestPersistentStorage()` returns;
 * this module turns that discarded signal into a single, cheap decision.
 */

const WORKOUT_STORAGE_KEY = 'workout-exercises'
const BODYWEIGHT_STORAGE_KEY = 'bodyweight-entries'

export interface StorageEvictionInput {
  /**
   * Whether `navigator.storage.persist` exists. A `false` `persisted` result on
   * an *unsupported* browser is meaningless (nothing was actually denied), so we
   * only warn when the API is present and returned `false`.
   */
  supported: boolean
  /** The boolean returned by `navigator.storage.persist()`. */
  persisted: boolean
  /**
   * Running as an installed PWA. Installed apps already receive persistent
   * storage and escape the 7-day eviction, so the "add to Home Screen" nudge is
   * moot — never warn there.
   */
  standalone: boolean
  /** The user has local workout/bodyweight data worth protecting. */
  hasLocalData: boolean
  /** The user previously dismissed this warning. */
  dismissed: boolean
}

/**
 * Decide whether to surface the storage-eviction warning banner. Pure so the
 * gating logic is unit-testable without a DOM.
 */
export function shouldWarnStorageEviction(input: StorageEvictionInput): boolean {
  const { supported, persisted, standalone, hasLocalData, dismissed } = input
  if (!supported) return false
  if (persisted) return false
  if (standalone) return false
  if (!hasLocalData) return false
  if (dismissed) return false
  return true
}

/**
 * True when the Storage persistence API is available. Distinguishes a genuine
 * DENIAL (`persist()` → false) from an unsupported browser (no API at all).
 */
export function isPersistenceSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.storage?.persist === 'function'
}

/**
 * Whether localStorage holds any real user workout/bodyweight data. Read straight
 * from localStorage (the local-first source of truth) so the check is synchronous
 * and race-free against async store hydration.
 */
export function hasLocalUserData(): boolean {
  return isNonEmptyArrayKey(WORKOUT_STORAGE_KEY) || isNonEmptyArrayKey(BODYWEIGHT_STORAGE_KEY)
}

function isNonEmptyArrayKey(key: string): boolean {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return false
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.length > 0
  } catch {
    return false
  }
}
