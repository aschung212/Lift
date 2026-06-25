import { defineStore } from 'pinia'
import { supabase, isPreviewMode } from '../lib/supabase'
import type { Tables } from '../lib/database.types'
import { syncQueue } from '../lib/syncQueue'
import { isAuthError, ensureFreshSession } from '../lib/sessionHealth'
import { classifySyncError, type SyncErrorKind } from '../lib/syncStatus'
import { mergeEntities } from '../lib/conflictResolver'
import { uuid, endOfDayISO } from '../lib/uuid'
import { backupToIDB } from '../lib/durableStorage'
import { logError, logWarn } from '../lib/logger'
import { addTombstone, removeTombstone, isTombstoned, cleanupTombstones } from '../lib/tombstones'
import { broadcastStoreUpdate } from '../lib/crossTabSync'

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
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error('Expected array')
    return parsed
  } catch (e) {
    logWarn('Corrupt bodyweight data in localStorage, using empty state', { error: String(e) })
    return []
  }
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
      const data = JSON.stringify(this.entries)
      try {
        localStorage.setItem(STORAGE_KEY, data)
      } catch (e) {
        logError(e, { source: 'bodyweight._persist', size: data.length })
      }
      backupToIDB(STORAGE_KEY, data)
      broadcastStoreUpdate('bodyweight')
    },

    /** Re-read state from localStorage (called by cross-tab sync listener). */
    _reloadFromStorage() {
      this.entries = load()
    },

    async init(userId: string) {
      this._userId = userId
      await this._fetchFromSupabase()
    },

    async _fetchFromSupabase() {
      if (!supabase || !this._userId) return

      this.syncing = true
      let data: Tables<'bodyweight_entries'>[] | null
      try {
        const result = await supabase
          .from('bodyweight_entries')
          .select('*')
          .eq('user_id', this._userId)
          .is('deleted_at', null)
          .order('created_at')
        if (result.error) {
          logWarn('Supabase fetch failed in bodyweight store — using local data', { error: String(result.error) })
          this.lastSyncError = classifySyncError(result.error)
          // A 401 means an expired token, not offline — refresh once so the next
          // fetch recovers rather than staying local-only forever (LIFT-784).
          if (isAuthError(result.error)) void ensureFreshSession()
          return
        }
        data = result.data
      } catch (err) {
        logWarn('Supabase fetch failed in bodyweight store — using local data', { error: String(err) })
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

      const remoteEntries = filteredData.map(e => ({
        id: e.id,
        date: e.date,
        weight: e.weight,
        updated_at: e.created_at || new Date().toISOString(),
      }))

      // Merge local + remote using last-write-wins
      // (#1 fix: local entries now carry updated_at from mutations)
      type BWWithTimestamp = BodyweightEntry & { updated_at: string }
      const localWithTimestamps: BWWithTimestamp[] = this.entries.map((e) => ({
        ...e,
        updated_at: e.updated_at || new Date(0).toISOString(),
      }))
      const { merged, localOnly, localWins } = mergeEntities<BWWithTimestamp>(localWithTimestamps, remoteEntries as BWWithTimestamp[])

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
