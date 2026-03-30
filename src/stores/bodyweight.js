import { defineStore } from 'pinia'
import { supabase } from '../lib/supabase'
import { uuid } from '../lib/uuid'

const STORAGE_KEY = 'bodyweight-entries'

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export const useBodyweightStore = defineStore('bodyweight', {
  state: () => ({
    entries: load(),
    _userId: null
  }),

  actions: {
    _persist() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries))
    },

    async init(userId) {
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

      this.entries = data.map(e => ({
        id: e.id,
        date: e.date,
        weight: e.weight
      }))
      this._persist()
    },

    addEntry(weight, dateStr) {
      const date = dateStr
        ? new Date(dateStr + 'T12:00:00').toISOString()
        : new Date().toISOString()
      const id = uuid()
      this.entries.push({ id, date, weight })
      this._persist()

      if (supabase && this._userId) {
        supabase.from('bodyweight_entries').insert({
          id, user_id: this._userId, date, weight
        }).then()
      }
      return id
    },

    updateEntry(id, weight, dateStr) {
      const entry = this.entries.find(e => e.id === id)
      if (!entry) return
      entry.weight = weight
      if (dateStr) {
        entry.date = new Date(dateStr + 'T12:00:00').toISOString()
      }
      this._persist()

      if (supabase && this._userId) {
        const update = { weight }
        if (dateStr) update.date = entry.date
        supabase.from('bodyweight_entries').update(update).eq('id', id).then()
      }
    },

    deleteEntry(id) {
      this.entries = this.entries.filter(e => e.id !== id)
      this._persist()

      if (supabase && this._userId) {
        supabase.from('bodyweight_entries').delete().eq('id', id).then()
      }
    },

    clearAll() {
      this.entries = []
      this._persist()

      if (supabase && this._userId) {
        supabase.from('bodyweight_entries').delete().eq('user_id', this._userId).then()
      }
    }
  },

  getters: {
    sortedEntries: (state) => {
      return [...state.entries].sort((a, b) => a.date.localeCompare(b.date))
    },

    latestWeight: (state) => {
      if (state.entries.length === 0) return null
      const sorted = [...state.entries].sort((a, b) => b.date.localeCompare(a.date))
      return sorted[0].weight
    },

    minWeight: (state) => {
      if (state.entries.length === 0) return null
      return Math.min(...state.entries.map(e => e.weight))
    },

    maxWeight: (state) => {
      if (state.entries.length === 0) return null
      return Math.max(...state.entries.map(e => e.weight))
    }
  }
})
