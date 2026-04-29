/**
 * Durable Storage Layer
 *
 * Adds IndexedDB as a backup alongside localStorage to prevent data loss.
 * Also requests persistent storage from the browser so data isn't evicted.
 *
 * Strategy:
 * - Writes go to BOTH localStorage and IndexedDB
 * - Reads prefer localStorage (fast), fall back to IndexedDB if missing
 * - On app startup, if localStorage is empty but IndexedDB has data, restore it
 */

const DB_NAME = 'lift-backup'
const DB_VERSION = 1
const STORE_NAME = 'keyval'

let db: IDBDatabase | null = null

function openDB(): Promise<IDBDatabase> {
  if (db) return Promise.resolve(db)

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => {
      db = request.result
      resolve(db)
    }
    request.onerror = () => reject(request.error)
  })
}

/** Write a value to IndexedDB backup. Fire-and-forget. */
export function backupToIDB(key: string, value: string): void {
  openDB().then(database => {
    const tx = database.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(value, key)
  }).catch(() => {
    // IndexedDB unavailable — silently fail
  })
}

/** Clear all data from IndexedDB backup. */
export async function clearIDB(): Promise<void> {
  try {
    const database = await openDB()
    const tx = database.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).clear()
  } catch {
    // IndexedDB unavailable — silently fail
  }
}

/** Read a value from IndexedDB backup. */
export async function restoreFromIDB(key: string): Promise<string | null> {
  try {
    const database = await openDB()
    return new Promise((resolve) => {
      const tx = database.transaction(STORE_NAME, 'readonly')
      const request = tx.objectStore(STORE_NAME).get(key)
      request.onsuccess = () => resolve(request.result ?? null)
      request.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

/**
 * Request persistent storage from the browser.
 * Prevents eviction under storage pressure.
 * Should be called once on app startup.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (navigator.storage?.persist) {
    return navigator.storage.persist()
  }
  return false
}

/** Storage quota estimate result. */
export interface StorageQuota {
  usage: number
  quota: number
  pct: number
}

/**
 * Estimate current storage usage via the StorageManager API.
 * Returns null if the API is unavailable.
 */
export async function estimateStorageQuota(): Promise<StorageQuota | null> {
  if (!navigator.storage?.estimate) return null
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate()
    return { usage, quota, pct: quota > 0 ? usage / quota : 0 }
  } catch {
    return null
  }
}

/**
 * Check if a caught error is a QuotaExceededError.
 */
export function isQuotaExceeded(e: unknown): boolean {
  return e instanceof DOMException && (
    e.name === 'QuotaExceededError' ||
    e.code === 22 // Legacy code for QuotaExceededError
  )
}

/**
 * Check if localStorage has data for a key. If not, try restoring from IndexedDB.
 * Returns true if data was restored.
 */
export async function ensureLocalStorage(key: string): Promise<boolean> {
  const local = localStorage.getItem(key)
  if (local) {
    // Sync to IDB in case it's out of date
    backupToIDB(key, local)
    return false
  }

  // localStorage is empty — try IndexedDB
  const backup = await restoreFromIDB(key)
  if (backup) {
    localStorage.setItem(key, backup)
    return true // data was restored
  }

  return false
}
