/**
 * Lightweight tombstone tracker for offline deletions.
 *
 * When an entity is deleted offline, its ID is recorded here so that
 * the next sync cycle knows not to resurrect it from remote data.
 * Tombstones are scoped by store name to prevent cross-store interference.
 * They are cleaned up once the remote no longer contains the ID
 * (meaning the delete was successfully synced).
 */

const STORAGE_KEY = 'lift-sync-tombstones'

interface TombstoneData {
  [store: string]: string[]
}

let _data: TombstoneData | null = null

function load(): TombstoneData {
  if (_data) return _data
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    _data = raw ? JSON.parse(raw) : {}
  } catch {
    _data = {}
  }
  return _data!
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(load()))
}

function getStoreSet(store: string): Set<string> {
  const data = load()
  return new Set(data[store] || [])
}

function setStoreSet(store: string, ids: Set<string>) {
  const data = load()
  if (ids.size > 0) {
    data[store] = [...ids]
  } else {
    delete data[store]
  }
  save()
}

export function addTombstone(store: string, id: string) {
  const ids = getStoreSet(store)
  ids.add(id)
  setStoreSet(store, ids)
}

export function removeTombstone(store: string, id: string) {
  const ids = getStoreSet(store)
  if (ids.has(id)) {
    ids.delete(id)
    setStoreSet(store, ids)
  }
}

export function isTombstoned(store: string, id: string): boolean {
  return getStoreSet(store).has(id)
}

/** Reset in-memory cache (for testing only). */
export function _resetCache(): void {
  _data = null
}

/**
 * Remove tombstones for IDs that no longer exist in remote data.
 * Only operates on the specified store's tombstones — other stores are untouched.
 */
export function cleanupTombstones(store: string, remoteIds: Set<string>) {
  const ids = getStoreSet(store)
  if (ids.size === 0) return
  const toRemove: string[] = []
  for (const id of ids) {
    if (!remoteIds.has(id)) toRemove.push(id)
  }
  if (toRemove.length > 0) {
    for (const id of toRemove) ids.delete(id)
    setStoreSet(store, ids)
  }
}
