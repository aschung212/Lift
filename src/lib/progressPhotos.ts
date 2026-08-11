/**
 * Progress-photos storage layer (LIFT-1108).
 *
 * Progress photos are a distinct, privacy-sensitive data type: image blobs, not
 * the small JSON payloads the Pinia stores keep in localStorage. Base64-ing a
 * few megapixel photos into localStorage would blow its ~5 MB quota in a handful
 * of shots, so the binary lives in its own IndexedDB database (`lift-photos`) —
 * separate from the `lift-backup` keyval DB (durableStorage.ts) so this feature
 * can never force a version bump / migration on the durable-backup schema.
 *
 * Each record is self-contained (`{ id, date, caption, createdAt, blob }`), so
 * BOTH the timeline metadata and the pixels are durable in one place. The store
 * hydrates its reactive metadata list from `getProgressPhotoMetas()` (blob
 * stripped) and lazily fetches a blob via `getProgressPhotoBlob()` only when a
 * thumbnail or comparison view needs to paint it.
 *
 * Everything degrades silently when IndexedDB is unavailable (private mode, an
 * old WebView) — reads resolve to `[]`/`null` and writes reject so the caller
 * can surface a friendly failure, mirroring durableStorage.ts.
 */

const DB_NAME = 'lift-photos'
const DB_VERSION = 1
const STORE_NAME = 'photos'

let db: IDBDatabase | null = null

/** Persisted record: timeline metadata plus the image blob, keyed by `id`. */
export interface StoredProgressPhoto {
  id: string
  /** Local-calendar day key (YYYY-MM-DD) the photo represents. */
  date: string
  caption: string
  /** ISO 8601 capture timestamp — the stable tiebreaker within a single day. */
  createdAt: string
  blob: Blob
}

/** Timeline metadata (no blob) — the shape the reactive store holds. */
export type ProgressPhotoMeta = Omit<StoredProgressPhoto, 'blob'>

function openDB(): Promise<IDBDatabase> {
  if (db) return Promise.resolve(db)
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB unavailable'))
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => {
      db = request.result
      resolve(db)
    }
    request.onerror = () => reject(request.error)
  })
}

/** Insert or replace a photo record (metadata + blob). Rejects on failure. */
export async function putProgressPhoto(record: StoredProgressPhoto): Promise<void> {
  const database = await openDB()
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(record)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * Read every photo's metadata (blob stripped) for the timeline.
 * Resolves to `[]` when IndexedDB is unavailable so the store can render an
 * empty timeline rather than throwing during hydration.
 */
export async function getProgressPhotoMetas(): Promise<ProgressPhotoMeta[]> {
  let database: IDBDatabase
  try {
    database = await openDB()
  } catch {
    return []
  }
  return new Promise((resolve) => {
    const tx = database.transaction(STORE_NAME, 'readonly')
    const request = tx.objectStore(STORE_NAME).getAll()
    request.onsuccess = () => {
      const rows = (request.result ?? []) as StoredProgressPhoto[]
      // Strip the blob so the reactive store never retains megabytes of pixels.
      resolve(rows.map(({ id, date, caption, createdAt }) => ({ id, date, caption, createdAt })))
    }
    request.onerror = () => resolve([])
  })
}

/** Fetch a single photo's blob for display. Resolves `null` when absent. */
export async function getProgressPhotoBlob(id: string): Promise<Blob | null> {
  let database: IDBDatabase
  try {
    database = await openDB()
  } catch {
    return null
  }
  return new Promise((resolve) => {
    const tx = database.transaction(STORE_NAME, 'readonly')
    const request = tx.objectStore(STORE_NAME).get(id)
    request.onsuccess = () => {
      const row = request.result as StoredProgressPhoto | undefined
      resolve(row?.blob ?? null)
    }
    request.onerror = () => resolve(null)
  })
}

/**
 * Update just the caption on an existing record. No-ops if the id is gone.
 * Degrades silently when IndexedDB is unavailable — the same "resolve, don't
 * throw" contract as the reads, so store/UI callers never see a rejection they
 * have no way to surface.
 */
export async function updateProgressPhotoCaption(id: string, caption: string): Promise<void> {
  let database: IDBDatabase
  try {
    database = await openDB()
  } catch {
    return
  }
  return new Promise((resolve) => {
    const tx = database.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const getReq = store.get(id)
    getReq.onsuccess = () => {
      const row = getReq.result as StoredProgressPhoto | undefined
      if (row) store.put({ ...row, caption })
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

/** Delete a single photo record (metadata + blob). Degrades silently. */
export async function deleteProgressPhoto(id: string): Promise<void> {
  let database: IDBDatabase
  try {
    database = await openDB()
  } catch {
    return
  }
  return new Promise((resolve) => {
    const tx = database.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

/** Wipe every photo. Degrades silently when IndexedDB is unavailable. */
export async function clearProgressPhotos(): Promise<void> {
  let database: IDBDatabase
  try {
    database = await openDB()
  } catch {
    return
  }
  return new Promise((resolve) => {
    const tx = database.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

/**
 * Close the cached connection so `indexedDB.deleteDatabase('lift-photos')` in
 * account deletion isn't blocked by an open handle (mirrors durableStorage's
 * `closeDB`). Safe to call when nothing is open.
 */
export function closeProgressPhotoDB(): void {
  if (db) {
    db.close()
    db = null
  }
}
