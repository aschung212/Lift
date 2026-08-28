/**
 * Shared persistence plumbing for the Pinia stores (LIFT-819).
 *
 * Every store used to copy-paste the same three-step write dance inside its
 * `_persist()` (localStorage.setItem in a try/catch, IndexedDB backup, cross-tab
 * broadcast) and the same read dance inside its `load()` (getItem + JSON.parse +
 * shape check + corrupt-data fallback). Four copies meant every cross-cutting
 * change — a new storage backend, an encryption layer, quota handling, a schema
 * bump — had to be made and tested four times, and subtle divergences had already
 * crept in.
 *
 * These helpers own ONLY the storage mechanics. Store-specific concerns —
 * payload shape, secondary keys, merge/migration logic, and remote sync — stay
 * in each store.
 */

import { backupToIDB } from './durableStorage'
import { broadcastStoreUpdate, type StoreKey } from './crossTabSync'
import { logError, logWarn } from './logger'

/**
 * Write a store's serialized primary payload to localStorage, mirror it to the
 * IndexedDB backup, and notify other tabs.
 *
 * The localStorage write is guarded so a quota/serialization failure is logged
 * (tagged with the store name) rather than thrown into a store mutation; the
 * IndexedDB backup and the cross-tab broadcast still fire so a transient
 * localStorage failure doesn't also silence the durable backup or other tabs.
 *
 * Secondary localStorage keys (e.g. the workout store's tag keys, the
 * preferences store's FOUC keys) remain the store's responsibility — only the
 * primary payload is mirrored to the backup.
 */
export function persistStoreData(store: StoreKey, key: string, data: string): void {
  try {
    localStorage.setItem(key, data)
  } catch (e) {
    logError(e, { source: `${store}._persist`, size: data.length })
  }
  backupToIDB(key, data)
  broadcastStoreUpdate(store)
}

/**
 * Read and JSON.parse a store's primary payload from localStorage.
 *
 * Returns `fallback()` (invoked fresh so the caller can safely mutate the
 * result) when the key is absent, unparseable, or rejected by `validate`.
 * Unlike the lower-level `loadJSON`, a corrupt payload is surfaced via
 * `logWarn` (tagged with the store name) so silent local-state resets are
 * observable instead of vanishing.
 */
export function loadStoreData<T>(
  store: StoreKey,
  key: string,
  fallback: () => T,
  validate?: (parsed: unknown) => boolean,
): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback()
    const parsed: unknown = JSON.parse(raw)
    if (validate && !validate(parsed)) {
      logWarn(`Corrupt ${store} data in localStorage, using fallback`, { reason: 'failed validation' })
      return fallback()
    }
    return parsed as T
  } catch (e) {
    logWarn(`Corrupt ${store} data in localStorage, using fallback`, { error: String(e) })
    return fallback()
  }
}
