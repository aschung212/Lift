/**
 * Conflict resolution for multi-device sync.
 *
 * Uses a **last-write-wins** strategy with per-entity timestamp comparison.
 * When merging local and remote datasets:
 *   - Entities present only locally → push to remote
 *   - Entities present only remotely → accept into local state
 *   - Entities present in both → keep the one with the later `updated_at`
 *
 * The resolver is data-agnostic — it works with any entity type that
 * carries `id` and `updated_at` fields.
 */

export interface Timestamped {
  id: string
  updated_at: string // ISO 8601
}

export interface MergeResult<T extends Timestamped> {
  /** Merged dataset (union of both sides, conflicts resolved by timestamp) */
  merged: T[]
  /** Entities that exist locally but not remotely — need to be pushed */
  localOnly: T[]
  /** Entities that exist remotely but not locally — newly accepted */
  remoteOnly: T[]
  /** Entities where the local version won (newer timestamp) */
  localWins: T[]
  /** Entities where the remote version won (newer timestamp) */
  remoteWins: T[]
}

/**
 * Merge local and remote entity arrays using last-write-wins.
 *
 * @param local  - Entities from local storage
 * @param remote - Entities fetched from the remote database
 * @returns A MergeResult with the resolved dataset and categorized changes
 */
export function mergeEntities<T extends Timestamped>(
  local: T[],
  remote: T[]
): MergeResult<T> {
  const localMap = new Map(local.map(e => [e.id, e]))
  const remoteMap = new Map(remote.map(e => [e.id, e]))

  const localOnly: T[] = []
  const remoteOnly: T[] = []
  const localWins: T[] = []
  const remoteWins: T[] = []
  const merged: T[] = []

  // Process all local entities
  for (const entity of local) {
    const remoteEntity = remoteMap.get(entity.id)
    if (!remoteEntity) {
      // Only exists locally — keep and flag for push
      localOnly.push(entity)
      merged.push(entity)
    } else {
      // Exists in both — compare timestamps
      const localTime = new Date(entity.updated_at).getTime()
      const remoteTime = new Date(remoteEntity.updated_at).getTime()
      if (localTime >= remoteTime) {
        localWins.push(entity)
        merged.push(entity)
      } else {
        remoteWins.push(remoteEntity)
        merged.push(remoteEntity)
      }
    }
  }

  // Process remote-only entities
  for (const entity of remote) {
    if (!localMap.has(entity.id)) {
      remoteOnly.push(entity)
      merged.push(entity)
    }
  }

  return { merged, localOnly, remoteOnly, localWins, remoteWins }
}

/**
 * Compute a lightweight sync summary for logging/debugging.
 */
export function syncSummary<T extends Timestamped>(result: MergeResult<T>): string {
  const parts: string[] = []
  if (result.localOnly.length) parts.push(`${result.localOnly.length} local-only`)
  if (result.remoteOnly.length) parts.push(`${result.remoteOnly.length} remote-only`)
  if (result.localWins.length) parts.push(`${result.localWins.length} local-wins`)
  if (result.remoteWins.length) parts.push(`${result.remoteWins.length} remote-wins`)
  return parts.length ? parts.join(', ') : 'no changes'
}
