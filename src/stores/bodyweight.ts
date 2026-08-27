import { defineStore } from 'pinia'
import { supabase, isPreviewMode } from '../lib/supabase'
import type { Tables } from '../lib/database.types'
import { syncQueue } from '../lib/syncQueue'
import { isAuthError, ensureFreshSession } from '../lib/sessionHealth'
import { classifySyncError, type SyncErrorKind } from '../lib/syncStatus'
import { mergeEntities } from '../lib/conflictResolver'
import { uuid, endOfDayISO } from '../lib/uuid'
import { reportFetchError } from '../lib/fetchErrorClassifier'
import { addTombstone, removeTombstone, isTombstoned, cleanupTombstones } from '../lib/tombstones'
import { persistStoreData, loadStoreData } from '../lib/storePersistence'
import { parseBodyweightEntries } from '../lib/parseGuards'
import { mapRemoteBodyweightEntry } from '../lib/remoteRows'
import { fetchAllRows } from '../lib/supabasePagination'
import { logWarn } from '../lib/logger'

const TOMBSTONE_STORE = 'bodyweight'

const STORAGE_KEY = 'bodyweight-entries'

export interface BodyweightEntry {
  id: string
  date: string
  weight: number
  updated_at?: string  // ISO 8601, used for last-write-wins merge
  sample?: boolean     // true for onboarding sample data — never synced to Supabase
}

function load(): BodyweightEntry[] {
  // Element-level validation (LIFT-946): drop entries missing id/date or with a
  // non-numeric weight so a single corrupt row can't poison charts / e1RM / sync.
  return parseBodyweightEntries(loadStoreData<unknown[]>('bodyweight', STORAGE_KEY, () => [], Array.isArray))
}

export const useBodyweightStore = defineStore('bodyweight', {
  state: () => ({
    entries: load() as BodyweightEntry[],
    _userId: null as string | null,
    // Uniform sync-status contract (LIFT-820): observable by the UI.
    syncing: false,
    lastSyncError: null as SyncErrorKind | null,
  }),

  actions: {
    _persist() {
      persistStoreData('bodyweight', STORAGE_KEY, JSON.stringify(this.entries))
    },

    /** Re-read state from localStorage (called by cross-tab sync listener). */
    _reloadFromStorage() {
      this.entries = load()
    },

    /**
     * Sign-out wipe (called by useAuth.resetStores). Pinia's built-in
     * options-store $reset re-runs the state() factory — whose `load()` would
     * re-hydrate the signed-out user's entries straight back out of
     * localStorage, and the surviving `bodyweight-entries` payload would then
     * be pushed into the NEXT empty account that signs in on this device by
     * migrateLocalStorageToSupabase. Wipe to defaults and persist the cleared
     * payload (localStorage + IDB mirror) instead, mirroring the workout
     * store's $reset. `_userId` is nulled first so nothing below can enqueue
     * against the just-ended session.
     */
    $reset() {
      this._userId = null
      this.entries = []
      this.syncing = false
      this.lastSyncError = null
      this._persist()
    },

    async init(userId: string) {
      this._userId = userId
      await this._fetchFromSupabase()
    },

    /**
     * Re-pull from Supabase without re-running migration (LIFT-1226). The
     * read-side recovery entry point: `_fetchFromSupabase` swallows read
     * failures into `lastSyncError` with no retry, so a transient blip / token
     * expiry / offline cold start leaves stale local-only data until a full
     * relaunch. Called on reconnect / resume / post-token-refresh. No-ops when
     * signed out or when a fetch is already in flight (overlap guard).
     */
    async refetch() {
      if (!this._userId || this.syncing) return
      await this._fetchFromSupabase()
    },

    async _fetchFromSupabase() {
      if (!supabase || !this._userId) return
      // Pin the narrowed client and user id: both bindings are mutable, so TS
      // re-widens them inside the per-page query factory below.
      const client = supabase
      const userId = this._userId

      this.syncing = true
      let data: Tables<'bodyweight_entries'>[] | null
      try {
        // Paged like every other collection read (#1152). This table sits well
        // under PostgREST's 1000-row max_rows today (one entry per day), which
        // is precisely why the workout truncation looked like selective data
        // loss — bodyweight survived while sets did not. Daily logging reaches
        // the cap in under three years, so it pages too rather than waiting to
        // become the next silent truncation.
        const result = await fetchAllRows(() => client
          .from('bodyweight_entries')
          .select('*')
          .eq('user_id', userId)
          .is('deleted_at', null)
          .order('created_at')
          .order('id'))
        // A SIGNED_OUT teardown ($reset) may have landed while this fetch was
        // awaited — refetch now fires on TOKEN_REFRESHED/reconnect, so that
        // teardown can race a refetch (LIFT-1226). $reset nulls _userId and
        // persists cleared defaults; applying this stale response would
        // rehydrate the signed-out user's entries on a shared device. Bail.
        if (this._userId !== userId) return
        if (result.error) {
          reportFetchError('bodyweight', result.error)
          this.lastSyncError = classifySyncError(result.error)
          // A 401 means an expired token, not offline — refresh once so the next
          // fetch recovers rather than staying local-only forever (LIFT-784).
          if (isAuthError(result.error)) void ensureFreshSession()
          return
        }
        data = result.data
      } catch (err) {
        reportFetchError('bodyweight', err)
        this.lastSyncError = classifySyncError(err)
        return
      } finally {
        this.syncing = false
      }

      if (!data) return
      this.lastSyncError = null

      // Filter out tombstoned entries (deleted offline, not yet synced)
      const remoteIds = new Set(data.map(e => e.id))
      cleanupTombstones(TOMBSTONE_STORE, remoteIds)
      const filteredData = data.filter(
        e => !isTombstoned(TOMBSTONE_STORE, e.id)
      )

      type BWWithTimestamp = BodyweightEntry & { updated_at: string }

      // Validate weight at the boundary (LIFT-1135): an entry with a non-finite
      // weight is dropped rather than skewing min/max/latest getters.
      const remoteEntries: BWWithTimestamp[] = []
      for (const e of filteredData) {
        const entry = mapRemoteBodyweightEntry(e)
        if (entry) remoteEntries.push(entry)
        else logWarn('Dropping malformed remote bodyweight entry during fetch', { id: e.id })
      }

      // Merge local + remote using last-write-wins
      // (#1 fix: local entries now carry updated_at from mutations)
      const localWithTimestamps: BWWithTimestamp[] = this.entries.map((e) => ({
        ...e,
        updated_at: e.updated_at || new Date(0).toISOString(),
      }))
      const { merged, localOnly, localWins } = mergeEntities<BWWithTimestamp>(localWithTimestamps, remoteEntries)

      // Deduplicate by date for LOCAL display only — keep the entry with the
      // later updated_at per date. We intentionally do NOT push deletes to
      // Supabase for the losers; the client has no authority to mutate server
      // data based on dedup heuristics. Server-side cleanup should be a
      // controlled one-time SQL migration. See incident 2026-04-12 (SEV1).
      const byDate = new Map<string, (typeof merged)[0]>()
      for (const entry of merged) {
        const dateKey = entry.date.slice(0, 10)
        const existing = byDate.get(dateKey)
        if (!existing) {
          byDate.set(dateKey, entry)
        } else {
          // Keep the one with the later updated_at
          if (entry.updated_at > existing.updated_at) {
            // If a sample entry replaces a real remote entry, adopt it so it gets synced back
            if (entry.sample && !existing.sample) delete entry.sample
            byDate.set(dateKey, entry)
          } else {
            // If existing sample entry beats a real remote entry, adopt it
            if (existing.sample && !entry.sample) delete existing.sample
          }
        }
      }

      // Keep updated_at in persisted state so future merges have accurate timestamps
      this.entries = [...byDate.values()]
      this._persist()

      // Push local-only entries to remote
      // (#3 fix: filter localOnly to exclude entries removed by date dedup)
      const survivingIds = new Set([...byDate.values()].map(e => e.id))
      const filteredLocalOnly = localOnly.filter(e => survivingIds.has(e.id) && !e.sample)
      if (filteredLocalOnly.length > 0) {
        const userId = this._userId
        for (const entry of filteredLocalOnly) {
          syncQueue.enqueue(`bodyweight:${entry.id}`, () =>
            supabase!.from('bodyweight_entries').upsert({
              id: entry.id,
              user_id: userId,
              date: entry.date,
              weight: entry.weight,
            }),
          )
        }
      }

      // Push local-wins back to Supabase (offline edits that beat remote timestamps)
      // Filter against surviving IDs to avoid racing with dedup deletes
      const filteredLocalWins = localWins.filter(e => survivingIds.has(e.id) && !e.sample)
      if (filteredLocalWins.length > 0) {
        const userId = this._userId
        for (const entry of filteredLocalWins) {
          syncQueue.enqueue(`bodyweight:${entry.id}`, () =>
            supabase!.from('bodyweight_entries').upsert({
              id: entry.id,
              user_id: userId,
              date: entry.date,
              weight: entry.weight,
            }),
          )
        }
      }

      // Process active tombstones: ensure pending deletes are synced
      const tombstoneEntries = data.filter(
        e => isTombstoned(TOMBSTONE_STORE, e.id),
      )
      if (tombstoneEntries.length > 0) {
        const userId = this._userId
        const deletedAt = new Date().toISOString()
        for (const e of tombstoneEntries) {
          const entryId = e.id
          syncQueue.enqueueDelete(`bodyweight:${entryId}`, () =>
            supabase!.from('bodyweight_entries')
              .update({ deleted_at: deletedAt })
              .eq('id', entryId).eq('user_id', userId),
          )
        }
      }
    },

    addEntry(weight: number, dateStr?: string, { sync = true }: { sync?: boolean } = {}): string {
      const date = dateStr
        ? endOfDayISO(dateStr)
        : new Date().toISOString()
      const id = uuid()
      this.entries.push({ id, date, weight, updated_at: new Date().toISOString(), ...(!sync ? { sample: true } : {}) })
      this._persist()

      if (sync && supabase && !isPreviewMode.value && this._userId) {
        const userId = this._userId
        syncQueue.enqueue(`bodyweight:${id}`, () =>
          supabase!.from('bodyweight_entries').upsert({
            id, user_id: userId, date, weight
          })
        )
      }
      return id
    },

    updateEntry(id: string, weight: number, dateStr?: string) {
      const entry = this.entries.find((e: BodyweightEntry) => e.id === id)
      if (!entry) return
      if (entry.sample) delete entry.sample
      entry.weight = weight
      if (dateStr) {
        entry.date = endOfDayISO(dateStr)
      }
      entry.updated_at = new Date().toISOString()
      this._persist()

      if (supabase && this._userId) {
        const userId = this._userId
        syncQueue.enqueue(`bodyweight:${id}`, () =>
          supabase!.from('bodyweight_entries').upsert({
            id, user_id: userId, date: entry.date, weight: entry.weight
          })
        )
      }
    },

    deleteEntry(id: string, { sync = true }: { sync?: boolean } = {}) {
      addTombstone(TOMBSTONE_STORE, id)
      this.entries = this.entries.filter((e: BodyweightEntry) => e.id !== id)
      this._persist()

      if (sync && supabase && this._userId) {
        const userId = this._userId
        const deletedAt = new Date().toISOString()
        syncQueue.enqueueDelete(`bodyweight:${id}`, () =>
          supabase!.from('bodyweight_entries')
            .update({ deleted_at: deletedAt })
            .eq('id', id).eq('user_id', userId)
        )
      }
    },

    restoreEntry(entry: BodyweightEntry) {
      removeTombstone(TOMBSTONE_STORE, entry.id)
      this.entries.push(entry)
      this._persist()

      // Soft-delete restore: clear deleted_at on server. Uses the same key as
      // deleteEntry so an in-flight delete is canceled by this enqueue's last-
      // write-wins. If the delete already flushed, this un-soft-deletes the row.
      if (supabase && !isPreviewMode.value && this._userId) {
        const userId = this._userId
        syncQueue.enqueue(`bodyweight:${entry.id}`, () =>
          supabase!.from('bodyweight_entries')
            .update({ deleted_at: null })
            .eq('id', entry.id).eq('user_id', userId)
        )
      }
    },

    syncDeleteEntry(id: string) {
      if (supabase && this._userId) {
        const userId = this._userId
        const deletedAt = new Date().toISOString()
        syncQueue.enqueueDelete(`bodyweight:${id}`, () =>
          supabase!.from('bodyweight_entries')
            .update({ deleted_at: deletedAt })
            .eq('id', id).eq('user_id', userId)
        )
      }
    },

    clearAll() {
      this.entries = []
      this._persist()

      if (supabase && this._userId) {
        const userId = this._userId
        const deletedAt = new Date().toISOString()
        syncQueue.enqueueDelete('bodyweight:clear-all', () =>
          supabase!.from('bodyweight_entries')
            .update({ deleted_at: deletedAt })
            .eq('user_id', userId)
            .is('deleted_at', null)
        )
      }
    }
  },

  getters: {
    sortedEntries: (state): BodyweightEntry[] => {
      return [...state.entries].sort((a, b) => a.date.localeCompare(b.date))
    },

    latestWeight: (state): number | null => {
      if (state.entries.length === 0) return null
      const sorted = [...state.entries].sort((a, b) => b.date.localeCompare(a.date))
      return sorted[0].weight
    },

    minWeight: (state): number | null => {
      if (state.entries.length === 0) return null
      return Math.min(...state.entries.map(e => e.weight))
    },

    maxWeight: (state): number | null => {
      if (state.entries.length === 0) return null
      return Math.max(...state.entries.map(e => e.weight))
    }
  }
})
