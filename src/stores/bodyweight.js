import { defineStore } from 'pinia'

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
    entries: load()
  }),

  actions: {
    _persist() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries))
    },

    addEntry(weight, dateStr) {
      const date = dateStr
        ? new Date(dateStr + 'T12:00:00').toISOString()
        : new Date().toISOString()
      const id = Date.now()
      this.entries.push({ id, date, weight })
      this._persist()
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
    },

    deleteEntry(id) {
      this.entries = this.entries.filter(e => e.id !== id)
      this._persist()
    },

    clearAll() {
      this.entries = []
      this._persist()
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
    }
  }
})
