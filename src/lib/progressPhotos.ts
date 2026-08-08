/**
 * Progress Photos — local-first storage layer (LIFT-1108).
 *
 * A private, opt-in visual transformation timeline. Photos never leave the
 * device: the image bytes are stored as Blobs in a dedicated IndexedDB
 * database (`lift-photos`), and only lightweight metadata (id, date, note)
 * lives in localStorage via the photos store. There is deliberately NO
 * Supabase sync — progress photos are the most sensitive data the app holds,
 * so keeping them device-local is the privacy-forward default (an opt-in
 * encrypted-sync path is a possible future follow-up, intentionally deferred).
 *
 * This module owns two concerns kept apart for testability:
 *  1. Pure helpers (metadata guarding, sorting, compare-pair selection, file
 *     validation) — no I/O, unit-tested directly.
 *  2. A thin IndexedDB blob layer (put/get/delete/clear) — I/O only, no logic.
 */

/** Metadata for a single progress photo. Image bytes live in IndexedDB. */
export interface PhotoMeta {
  /** Stable id, also the IndexedDB blob key. */
  id: string
  /** Local calendar day the photo represents (YYYY-MM-DD). */
  date: string
  /** Optional freeform note (e.g. "start of cut", bodyweight). */
  note?: string
  /** ISO 8601 timestamp the entry was created — stable sort tiebreaker. */
  createdAt: string
}

export const PHOTO_DB_NAME = 'lift-photos'
const PHOTO_DB_VERSION = 1
const PHOTO_STORE = 'photos'

/**
 * Reject files larger than this at the boundary. iPhone photos are typically
 * 2–5 MB; 20 MB leaves headroom for high-res / ProRAW-adjacent exports while
 * still guarding against a runaway import filling the device quota.
 */
export const MAX_PHOTO_BYTES = 20 * 1024 * 1024

// ── Pure helpers ────────────────────────────────────────────────────────────

/** True when the file looks like a browser-renderable image within size limits. */
export function isSupportedPhoto(file: { type?: string; size?: number } | null | undefined): boolean {
  if (!file) return false
  if (typeof file.type !== 'string' || !file.type.startsWith('image/')) return false
  if (typeof file.size === 'number' && (file.size <= 0 || file.size > MAX_PHOTO_BYTES)) return false
  return true
}

function isValidPhotoMeta(value: unknown): value is PhotoMeta {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (typeof v.id !== 'string' || v.id.length === 0) return false
  if (typeof v.date !== 'string' || v.date.length === 0) return false
  if (typeof v.createdAt !== 'string' || v.createdAt.length === 0) return false
  if (v.note !== undefined && typeof v.note !== 'string') return false
  return true
}

/**
 * Element-level guard for a persisted metadata list (LIFT-946 boundary rule):
 * drops any entry missing id/date/createdAt or with a non-string note, so a
 * single corrupt row can't poison the timeline. Non-array input → [].
 */
export function parsePhotoMetaList(raw: unknown): PhotoMeta[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(isValidPhotoMeta)
    .map(v => ({ id: v.id, date: v.date, createdAt: v.createdAt, ...(v.note ? { note: v.note } : {}) }))
}

/**
 * Sort by calendar date, then createdAt as a deterministic tiebreaker.
 * Defaults to newest-first (the timeline order); pass `'asc'` for the
 * chronological order the compare view uses (before → after).
 */
export function sortPhotosByDate(photos: readonly PhotoMeta[], dir: 'asc' | 'desc' = 'desc'): PhotoMeta[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...photos].sort((a, b) => {
    const byDate = a.date.localeCompare(b.date)
    if (byDate !== 0) return sign * byDate
    return sign * a.createdAt.localeCompare(b.createdAt)
  })
}

/**
 * The default before/after pair for the comparison view: the earliest and the
 * latest photo. Returns null when there are fewer than two photos (nothing to
 * compare). `before` is always the chronologically earlier of the two.
 */
export function selectComparePair(
  photos: readonly PhotoMeta[],
): { before: PhotoMeta; after: PhotoMeta } | null {
  if (photos.length < 2) return null
  const asc = sortPhotosByDate(photos, 'asc')
  return { before: asc[0], after: asc[asc.length - 1] }
}

// ── IndexedDB blob layer ────────────────────────────────────────────────────

let photoDB: IDBDatabase | null = null

function openPhotoDB(): Promise<IDBDatabase> {
  if (photoDB) return Promise.resolve(photoDB)
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB unavailable'))
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PHOTO_DB_NAME, PHOTO_DB_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(PHOTO_STORE)) {
        request.result.createObjectStore(PHOTO_STORE)
      }
    }
    request.onsuccess = () => {
      photoDB = request.result
      resolve(photoDB)
    }
    request.onerror = () => reject(request.error)
  })
}

/** Close the cached connection so `deleteDatabase()` can proceed (account deletion). */
export function closePhotoDB(): void {
  if (photoDB) {
    photoDB.close()
    photoDB = null
  }
}

/** Persist a photo's image bytes. Rejects are surfaced so the caller can roll back metadata. */
export async function putPhotoBlob(id: string, blob: Blob): Promise<void> {
  const db = await openPhotoDB()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, 'readwrite')
    tx.objectStore(PHOTO_STORE).put(blob, id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

/** Read a photo's image bytes, or null if missing / IndexedDB unavailable. */
export async function getPhotoBlob(id: string): Promise<Blob | null> {
  try {
    const db = await openPhotoDB()
    return await new Promise((resolve) => {
      const tx = db.transaction(PHOTO_STORE, 'readonly')
      const request = tx.objectStore(PHOTO_STORE).get(id)
      request.onsuccess = () => resolve((request.result as Blob) ?? null)
      request.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

/** Delete a photo's image bytes. Silent no-op when IndexedDB is unavailable. */
export async function deletePhotoBlob(id: string): Promise<void> {
  try {
    const db = await openPhotoDB()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(PHOTO_STORE, 'readwrite')
      tx.objectStore(PHOTO_STORE).delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    })
  } catch {
    // IndexedDB unavailable — nothing to delete.
  }
}

/** Wipe every stored photo blob. Used by account deletion / clear-all. */
export async function clearAllPhotoBlobs(): Promise<void> {
  try {
    const db = await openPhotoDB()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(PHOTO_STORE, 'readwrite')
      tx.objectStore(PHOTO_STORE).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    })
  } catch {
    // IndexedDB unavailable — nothing to clear.
  }
}
