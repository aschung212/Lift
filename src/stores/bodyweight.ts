import { defineStore } from 'pinia'
import { supabase, isPreviewMode } from '../lib/supabase'
import { syncQueue } from '../lib/syncQueue'
import { mergeEntities } from '../lib/conflictResolver'
import { uuid } from '../lib/uuid'
import { backupToIDB } from '../lib/durableStorage'
import { logError, logWarn } from '../lib/logger'

const STORAGE_KEY = 'bodyweight-entries'

export interface BodyweightEntry {
  id: string
  date: string
  weight: number
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

      const remoteEntries = data.map((e: Record<string, unknown>) => ({
        id: e.id as string,
        date: e.date as string,
        weight: e.weight as number,
        updated_at: (e.updated_at as string) || (e.created_at as string) || new Date().toISOString()
      }))

      // Merge local + remote using last-write-wins
      const localWithTimestamps = this.entries.map(e => ({
        ...e,
        updated_at: (e as BodyweightEntry & { updated_at?: string }).updated_at || new Date(0).toISOString()
      }))
      const { merged, localOnly } = mergeEntities(localWithTimestamps, remoteEntries)

      // Deduplicate by date — keep only the latest entry per date (by updated_at)
      const byDate = new Map<string, typeof merged[0]>()
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
            supabase!.from('bodyweight_entries').delete().eq('id', id).eq('user_id', userId)
          )
        }
      }

      this.entries = [...byDate.values()].map(({ updated_at: _, ...rest }) => rest)
      this._persist()

      // Push local-only entries to remote
      if (localOnly.length > 0) {
        const userId = this._userId
        for (const entry of localOnly) {
          syncQueue.enqueue(`bodyweight-push:${entry.id}`, () =>
            supabase!.from('bodyweight_entries').upsert({
              id: entry.id, user_id: userId, date: entry.date, weight: entry.weight
            })
          )
        }
      }
    },

    addEntry(weight: number, dateStr?: string, { sync = true }: { sync?: boolean } = {}): string {
      const date = dateStr
        ? dateStr + 'T23:59:59.000Z'
        : new Date().toISOString()
      const id = uuid()
      this.entries.push({ id, date, weight })
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
