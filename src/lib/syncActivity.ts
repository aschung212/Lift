/**
 * Reactive facts about the background write queue (LIFT-1323).
 *
 * `SyncQueue` tracks its pending operations and its durable journal in plain
 * `Map`s, and exposes them through the non-reactive `pending` / `journalSize`
 * getters — fine for telemetry, useless for a UI that has to tell the user how
 * many of their changes are still unsent. This module is the reactive mirror
 * the queue publishes into, so the sync-status sheet can read it like any other
 * piece of state.
 *
 * The number that matters most is `stranded`. A write whose retries are
 * exhausted — or which the server understood and refused (LIFT-1321) — leaves
 * the in-memory queue but deliberately KEEPS its durable journal entry
 * (LIFT-1229), so it replays on the next launch. Until now nothing surfaced
 * that state: the next successful flush of some *other* key set `syncStatus`
 * back to `'synced'`, and the user's stranded change became invisible. That is
 * the worst failure class the app has — persistent silent divergence — and it
 * is exactly what `stranded` counts.
 */
import { ref, type Ref } from 'vue'

export interface SyncQueueStats {
  /** Operations waiting to be sent: queued, awaiting retry, or rate-limit deferred. */
  pending: number
  /** Durable journal entries — every write not yet confirmed by the server. */
  journaled: number
  /**
   * Journaled writes that have LEFT the in-memory queue: they ran out of
   * retries or were refused outright, and nothing will re-attempt them until a
   * reconnect/resume replay (LIFT-1322) or the next cold start.
   */
  stranded: number
}

const EMPTY: SyncQueueStats = { pending: 0, journaled: 0, stranded: 0 }

/** Reactive snapshot of the shared write queue. Published by `SyncQueue`. */
export const syncQueueStats: Ref<SyncQueueStats> = ref(EMPTY)

/**
 * Publish a new snapshot. A no-op when nothing changed, so the queue can call
 * this after every state transition without churning every dependent computed
 * (and the indicator it drives) on each of a rapid burst of logged sets.
 */
export function publishSyncQueueStats(next: SyncQueueStats): void {
  const cur = syncQueueStats.value
  if (cur.pending === next.pending && cur.journaled === next.journaled && cur.stranded === next.stranded) {
    return
  }
  syncQueueStats.value = next
}

/**
 * Reset to the empty snapshot. Tests only in practice — sign-out reaches the
 * same end state through `syncQueue.clear()`, which publishes after wiping.
 */
export function resetSyncQueueStats(): void {
  syncQueueStats.value = EMPTY
}

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/**
 * Plain-language age of a timestamp, for "Last synced …".
 *
 * Deliberately coarse: the user is asking "is this minutes or days stale?", not
 * for a clock reading, and a precise figure would imply a precision the stamp
 * does not have (it marks the last moment every store and the write queue
 * agreed, not a specific request). A future timestamp — a clock adjustment
 * between the stamp and the read — degrades to "just now" rather than rendering
 * a negative age.
 */
export function formatSyncAge(ageMs: number): string {
  if (!Number.isFinite(ageMs) || ageMs < MINUTE_MS) return 'just now'
  if (ageMs < HOUR_MS) {
    const minutes = Math.floor(ageMs / MINUTE_MS)
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  }
  if (ageMs < DAY_MS) {
    const hours = Math.floor(ageMs / HOUR_MS)
    return `${hours} hour${hours === 1 ? '' : 's'} ago`
  }
  const days = Math.floor(ageMs / DAY_MS)
  return `${days} day${days === 1 ? '' : 's'} ago`
}
