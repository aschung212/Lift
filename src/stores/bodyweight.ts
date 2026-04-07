import { defineStore } from 'pinia'
import { supabase, isPreviewMode } from '../lib/supabase'
import { syncQueue } from '../lib/syncQueue'
import { mergeEntities } from '../lib/conflictResolver'
import { uuid } from '../lib/uuid'
import { backupToIDB } from '../lib/durableStorage'
import { logError, logWarn } from '../lib/logger'
import { addTombstone, isTombstoned, cleanupTombstones } from '../lib/tombstones'

const TOMBSTONE_STORE = 'bodyweight'

const STORAGE_KEY = 'bodyweight-entries'

export interface BodyweightEntry {
  id: string
  date: string
  weight: number
  updated_at?: string  // ISO 8601, used for last-write-wins merge
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
    _userId: null as string | null
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
    },

    async init(userId: string) {
      this._userId = userId
      await this._fetchFromSupabase()
    },

    async _fetchFromSupabase() {
      if (!supabase || !this._userId) return

      const { data } = await supabase
        .from('bodyweight_entries')
        .select('*')
        .eq('user_id', this._userId)
        .order('created_at')

      if (!data) return

      // Filter out tombstoned entries (deleted offline, not yet synced)
      const remoteIds = new Set(data.map((e: Record<string, unknown>) => e.id as string))
      cleanupTombstones(TOMBSTONE_STORE, remoteIds)
      const filteredData = data.filter(
        (e: Record<string, unknown>) => !isTombstoned(TOMBSTONE_STORE, e.id as string)
      )

      const remoteEntries = filteredData.map((e: Record<string, unknown>) => ({
        id: e.id as string,
        date: e.date as string,
        weight: e.weight as number,
        updated_at: (e.updated_at as string) || (e.created_at as string) || new Date().toISOString(),
      }))

      // Merge local + remote using last-write-wins
      // (#1 fix: local entries now carry updated_at from mutations)
      const localWithTimestamps = this.entries.map((e) => ({
        ...e,
        updated_at: e.updated_at || new Date(0).toISOString(),
      }))
      const { merged, localOnly, localWins } = mergeEntities(localWithTimestamps, remoteEntries)

      // Deduplicate by date — keep only the latest entry per date (by updated_at)
      const byDate = new Map<string, (typeof merged)[0]>()
      const dupIds: string[] = []
      for (const entry of merged) {
        const dateKey = entry.date.slice(0, 10)
        const existing = byDate.get(dateKey)
        if (!existing) {
          byDate.set(dateKey, entry)
        } else {
          // Keep the one with the later updated_at
          if (entry.updated_at > existing.updated_at) {
            dupIds.push(existing.id)
            byDate.set(dateKey, entry)
          } else {
            dupIds.push(entry.id)
          }
        }
      }

      // Clean up duplicate entries from Supabase
      if (dupIds.length > 0) {
        const userId = this._userId
        for (const id of dupIds) {
          syncQueue.enqueue(`bodyweight-dedup:${id}`, () =>
            supabase!.from('bodyweight_entries').delete().eq('id', id).eq('user_id', userId),
          )
        }
      }

      // Keep updated_at in persisted state so future merges have accurate timestamps
      this.entries = [...byDate.values()]
      this._persist()

      // Push local-only entries to remote
      // (#3 fix: filter localOnly to exclude entries removed by date dedup)
      const survivingIds = new Set([...byDate.values()].map(e => e.id))
      const filteredLocalOnly = localOnly.filter(e => survivingIds.has(e.id))
      if (filteredLocalOnly.length > 0) {
        const userId = this._userId
        for (const entry of filteredLocalOnly) {
          syncQueue.enqueue(`bodyweight-push:${entry.id}`, () =>
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
      if (localWins.length > 0) {
        const userId = this._userId
        for (const entry of localWins) {
          syncQueue.enqueue(`bodyweight-sync:${entry.id}`, () =>
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
        (e: Record<string, unknown>) => isTombstoned(TOMBSTONE_STORE, e.id as string),
      )
      if (tombstoneEntries.length > 0) {
        const userId = this._userId
        for (const e of tombstoneEntries) {
          const entryId = e.id as string
          syncQueue.enqueue(`bodyweight-delete:${entryId}`, () =>
            supabase!.from('bodyweight_entries').delete().eq('id', entryId).eq('user_id', userId),
          )
        }
      }
    },

    addEntry(weight: number, dateStr?: string, { sync = true }: { sync?: boolean } = {}): string {
      const date = dateStr
        ? dateStr + 'T23:59:59.000Z'
        : new Date().toISOString()
      const id = uuid()
      this.entries.push({ id, date, weight, updated_at: new Date().toISOString() })
      this._persist()

      if (sync && supabase && !isPreviewMode.value && this._userId) {
        supabase.from('bodyweight_entries').insert({
          id, user_id: this._userId, date, weight
        }).then()
      }
      return id
    },

    updateEntry(id: string, weight: number, dateStr?: string) {
      const entry = this.entries.find((e: BodyweightEntry) => e.id === id)
      if (!entry) return
      entry.weight = weight
      if (dateStr) {
        entry.date = dateStr + 'T23:59:59.000Z'
      }
      entry.updated_at = new Date().toISOString()
      this._persist()

      if (supabase && this._userId) {
        const update: Record<string, unknown> = { weight }
        if (dateStr) update.date = entry.date
        const userId = this._userId
        syncQueue.enqueue(`bodyweight-update:${id}`, () =>
          supabase!.from('bodyweight_entries').update(update).eq('id', id).eq('user_id', userId)
        )
      }
    },

    deleteEntry(id: string, { sync = true }: { sync?: boolean } = {}) {
      addTombstone(TOMBSTONE_STORE, id)
      this.entries = this.entries.filter((e: BodyweightEntry) => e.id !== id)
      this._persist()

      if (sync && supabase && this._userId) {
        const userId = this._userId
        syncQueue.enqueue(`bodyweight-delete:${id}`, () =>
          supabase!.from('bodyweight_entries').delete().eq('id', id).eq('user_id', userId)
        )
      }
    },

    restoreEntry(entry: BodyweightEntry) {
      this.entries.push(entry)
      this._persist()
    },

    syncDeleteEntry(id: string) {
      if (supabase && this._userId) {
        const userId = this._userId
        syncQueue.enqueue(`bodyweight-delete:${id}`, () =>
          supabase!.from('bodyweight_entries').delete().eq('id', id).eq('user_id', userId)
        )
      }
    },

    clearAll() {
      this.entries = []
      this._persist()

      if (supabase && this._userId) {
        const userId = this._userId
        syncQueue.enqueue('bodyweight-clear-all', () =>
          supabase!.from('bodyweight_entries').delete().eq('user_id', userId)
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
