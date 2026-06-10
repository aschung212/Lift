import { defineStore } from 'pinia'
import { supabase, isPreviewMode } from '../lib/supabase'
import type { Tables } from '../lib/database.types'
import { syncQueue } from '../lib/syncQueue'
import { mergeEntities } from '../lib/conflictResolver'
import { uuid, endOfDayISO } from '../lib/uuid'
import { backupToIDB } from '../lib/durableStorage'
import { logError, logWarn } from '../lib/logger'
import { addTombstone, removeTombstone, isTombstoned, cleanupTombstones } from '../lib/tombstones'
import { broadcastStoreUpdate } from '../lib/crossTabSync'

const TOMBSTONE_STORE = 'body_measurements'

const STORAGE_KEY = 'body-measurements'

/** Body parts the user can track circumference for. */
export const MEASUREMENT_TYPES = ['chest', 'arms', 'waist', 'thighs'] as const
export type MeasurementType = (typeof MEASUREMENT_TYPES)[number]

export function isMeasurementType(value: string): value is MeasurementType {
  return (MEASUREMENT_TYPES as readonly string[]).includes(value)
}

export interface MeasurementEntry {
  id: string
  date: string
  type: MeasurementType
  /** Circumference stored canonically in centimeters. */
  value: number
  updated_at?: string  // ISO 8601, used for last-write-wins merge
  sample?: boolean     // true for onboarding sample data — never synced to Supabase
}

function load(): MeasurementEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error('Expected array')
    // Drop any rows with an unknown type so a corrupt/foreign value can't break charts.
    return parsed.filter((e: MeasurementEntry) => e && isMeasurementType(e.type))
  } catch (e) {
    logWarn('Corrupt body-measurements data in localStorage, using empty state', { error: String(e) })
    return []
  }
}

export const useBodyMeasurementsStore = defineStore('bodyMeasurements', {
  state: () => ({
    entries: load() as MeasurementEntry[],
    _userId: null as string | null
  }),

  actions: {
    _persist() {
      const data = JSON.stringify(this.entries)
      try {
        localStorage.setItem(STORAGE_KEY, data)
      } catch (e) {
        logError(e, { source: 'bodyMeasurements._persist', size: data.length })
      }
      backupToIDB(STORAGE_KEY, data)
      broadcastStoreUpdate('bodyMeasurements')
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

      let data: Tables<'body_measurements'>[] | null
      try {
        const result = await supabase
          .from('body_measurements')
          .select('*')
          .eq('user_id', this._userId)
          .is('deleted_at', null)
          .order('created_at')
        if (result.error) {
          logWarn('Supabase fetch failed in body-measurements store — using local data', { error: String(result.error) })
          return
        }
        data = result.data
      } catch (err) {
        logWarn('Supabase fetch failed in body-measurements store — using local data', { error: String(err) })
        return
      }

      if (!data) return

      // Filter out tombstoned entries (deleted offline, not yet synced)
      const remoteIds = new Set(data.map(e => e.id))
      cleanupTombstones(TOMBSTONE_STORE, remoteIds)
      const filteredData = data.filter(
        e => !isTombstoned(TOMBSTONE_STORE, e.id) && isMeasurementType(e.type)
      )

      const remoteEntries = filteredData.map(e => ({
        id: e.id,
        date: e.date,
        type: e.type as MeasurementType,
        value: e.value,
        updated_at: e.created_at || new Date().toISOString(),
      }))

      // Merge local + remote using last-write-wins (local entries carry updated_at)
      type MWithTimestamp = MeasurementEntry & { updated_at: string }
      const localWithTimestamps: MWithTimestamp[] = this.entries.map((e) => ({
        ...e,
        updated_at: e.updated_at || new Date(0).toISOString(),
      }))
      const { merged, localOnly, localWins } = mergeEntities<MWithTimestamp>(localWithTimestamps, remoteEntries as MWithTimestamp[])

      // Deduplicate by (type, date) for LOCAL display only — keep the entry with
      // the later updated_at. As in the bodyweight store, we intentionally do NOT
      // push deletes to Supabase for the losers (the client has no authority to
      // mutate server data from a dedup heuristic — see incident 2026-04-12).
      const byKey = new Map<string, (typeof merged)[0]>()
      for (const entry of merged) {
        const key = `${entry.type}|${entry.date.slice(0, 10)}`
        const existing = byKey.get(key)
        if (!existing) {
          byKey.set(key, entry)
        } else if (entry.updated_at > existing.updated_at) {
          if (entry.sample && !existing.sample) delete entry.sample
          byKey.set(key, entry)
        } else if (existing.sample && !entry.sample) {
          delete existing.sample
        }
      }

      this.entries = [...byKey.values()]
      this._persist()

      const survivingIds = new Set([...byKey.values()].map(e => e.id))

      const pushUpsert = (entry: MeasurementEntry) => {
        const userId = this._userId!
        syncQueue.enqueue(`bodyMeasurement:${entry.id}`, () =>
          supabase!.from('body_measurements').upsert({
            id: entry.id,
            user_id: userId,
            date: entry.date,
            type: entry.type,
            value: entry.value,
          }),
        )
      }

      // Push local-only entries to remote (excluding sample + dedup-dropped rows)
      const filteredLocalOnly = localOnly.filter(e => survivingIds.has(e.id) && !e.sample)
      filteredLocalOnly.forEach(pushUpsert)

      // Push local-wins back to Supabase (offline edits that beat remote timestamps)
      const filteredLocalWins = localWins.filter(e => survivingIds.has(e.id) && !e.sample)
      filteredLocalWins.forEach(pushUpsert)

      // Process active tombstones: ensure pending deletes are synced
      const tombstoneEntries = data.filter(e => isTombstoned(TOMBSTONE_STORE, e.id))
      if (tombstoneEntries.length > 0) {
        const userId = this._userId
        const deletedAt = new Date().toISOString()
        for (const e of tombstoneEntries) {
          const entryId = e.id
          syncQueue.enqueueDelete(`bodyMeasurement:${entryId}`, () =>
            supabase!.from('body_measurements')
              .update({ deleted_at: deletedAt })
              .eq('id', entryId).eq('user_id', userId),
          )
        }
      }
    },

    addEntry(type: MeasurementType, value: number, dateStr?: string, { sync = true }: { sync?: boolean } = {}): string {
      const date = dateStr
        ? endOfDayISO(dateStr)
        : new Date().toISOString()
      const id = uuid()
      this.entries.push({ id, date, type, value, updated_at: new Date().toISOString(), ...(!sync ? { sample: true } : {}) })
      this._persist()

      if (sync && supabase && !isPreviewMode.value && this._userId) {
        const userId = this._userId
        syncQueue.enqueue(`bodyMeasurement:${id}`, () =>
          supabase!.from('body_measurements').upsert({
            id, user_id: userId, date, type, value
          })
        )
      }
      return id
    },

    updateEntry(id: string, value: number, dateStr?: string) {
      const entry = this.entries.find((e: MeasurementEntry) => e.id === id)
      if (!entry) return
      if (entry.sample) delete entry.sample
      entry.value = value
      if (dateStr) {
        entry.date = endOfDayISO(dateStr)
      }
      entry.updated_at = new Date().toISOString()
      this._persist()

      if (supabase && this._userId) {
        const userId = this._userId
        syncQueue.enqueue(`bodyMeasurement:${id}`, () =>
          supabase!.from('body_measurements').upsert({
            id, user_id: userId, date: entry.date, type: entry.type, value: entry.value
          })
        )
      }
    },

    deleteEntry(id: string, { sync = true }: { sync?: boolean } = {}) {
      addTombstone(TOMBSTONE_STORE, id)
      this.entries = this.entries.filter((e: MeasurementEntry) => e.id !== id)
      this._persist()

      if (sync && supabase && this._userId) {
        const userId = this._userId
        const deletedAt = new Date().toISOString()
        syncQueue.enqueueDelete(`bodyMeasurement:${id}`, () =>
          supabase!.from('body_measurements')
            .update({ deleted_at: deletedAt })
            .eq('id', id).eq('user_id', userId)
        )
      }
    },

    restoreEntry(entry: MeasurementEntry) {
      removeTombstone(TOMBSTONE_STORE, entry.id)
      this.entries.push(entry)
      this._persist()

      if (supabase && !isPreviewMode.value && this._userId) {
        const userId = this._userId
        syncQueue.enqueue(`bodyMeasurement:${entry.id}`, () =>
          supabase!.from('body_measurements')
            .update({ deleted_at: null })
            .eq('id', entry.id).eq('user_id', userId)
        )
      }
    },

    syncDeleteEntry(id: string) {
      if (supabase && this._userId) {
        const userId = this._userId
        const deletedAt = new Date().toISOString()
        syncQueue.enqueueDelete(`bodyMeasurement:${id}`, () =>
          supabase!.from('body_measurements')
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
        syncQueue.enqueueDelete('bodyMeasurement:clear-all', () =>
          supabase!.from('body_measurements')
            .update({ deleted_at: deletedAt })
            .eq('user_id', userId)
            .is('deleted_at', null)
        )
      }
    }
  },

  getters: {
    /** All entries for a given measurement type, sorted oldest → newest. */
    entriesForType: (state) => (type: MeasurementType): MeasurementEntry[] =>
      state.entries
        .filter(e => e.type === type)
        .sort((a, b) => a.date.localeCompare(b.date)),

    /** Most recent value for a given measurement type (cm), or null. */
    latestForType: (state) => (type: MeasurementType): number | null => {
      const forType = state.entries.filter(e => e.type === type)
      if (forType.length === 0) return null
      return [...forType].sort((a, b) => b.date.localeCompare(a.date))[0].value
    },

    /** Set of measurement types that currently have at least one entry. */
    trackedTypes: (state): Set<MeasurementType> =>
      new Set(state.entries.map(e => e.type)),
  }
})
