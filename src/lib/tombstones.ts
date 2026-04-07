/**
 * Lightweight tombstone tracker for offline deletions.
 *
 * When an entity is deleted offline, its ID is recorded here so that
 * the next sync cycle knows not to resurrect it from remote data.
 * Tombstones are cleaned up once the remote no longer contains the ID
 * (meaning the delete was successfully synced).
 */

const STORAGE_KEY = 'lift-sync-tombstones'

let _tombstones: Set<string> | null = null

function load(): Set<string> {
  if (_tombstones) return _tombstones
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    _tombstones = raw ? new Set(JSON.parse(raw)) : new Set()
  } catch {
    _tombstones = new Set()
  }
  return _tombstones
}

function save() {
  if (_tombstones) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([..._tombstones]))
  }
}

export function addTombstone(id: string) {
  load().add(id)
  save()
}

export function removeTombstones(ids: string[]) {
  const ts = load()
  for (const id of ids) ts.delete(id)
  save()
}

export function isTombstoned(id: string): boolean {
  return load().has(id)
}

/**
 * Remove tombstones for IDs that no longer exist in remote data.
 * This means the delete was successfully synced — the tombstone is no longer needed.
 */
export function cleanupTombstones(remoteIds: Set<string>) {
  const ts = load()
  const toRemove: string[] = []
  for (const id of ts) {
    if (!remoteIds.has(id)) toRemove.push(id)
  }
  if (toRemove.length > 0) {
    for (const id of toRemove) ts.delete(id)
    save()
  }
}
