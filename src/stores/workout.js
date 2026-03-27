import { defineStore } from 'pinia'

const STORAGE_KEY = 'workout-exercises'

function epley(weight, reps) {
  if (reps === 1) return Math.round(weight)
  return Math.round(weight * (1 + reps / 30))
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export const useWorkoutStore = defineStore('workout', {
  state: () => ({
    exercises: load()
  }),

  actions: {
    _persist() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.exercises))
    },

    addExercise(name) {
      const trimmed = name.trim()
      if (!trimmed) return null
      const existing = this.exercises.find(
        e => e.name.toLowerCase() === trimmed.toLowerCase()
      )
      if (existing) return existing.id
      const id = Date.now()
      this.exercises.push({ id, name: trimmed, sets: [] })
      this._persist()
      return id
    },

    logSet(exerciseId, weight, reps, dateStr) {
      const exercise = this.exercises.find(e => e.id === exerciseId)
      if (!exercise) return
      // Use the provided date (YYYY-MM-DD) at noon local time to avoid
      // timezone-induced day shifts, falling back to right now if omitted.
      const date = dateStr
        ? new Date(dateStr + 'T12:00:00').toISOString()
        : new Date().toISOString()
      exercise.sets.push({
        id: Date.now(),
        date,
        weight,
        reps,
        estimated1RM: epley(weight, reps)
      })
      this._persist()
    },

    updateSet(exerciseId, setId, weight, reps, dateStr) {
      const exercise = this.exercises.find(e => e.id === exerciseId)
      if (!exercise) return
      const set = exercise.sets.find(s => s.id === setId)
      if (!set) return
      set.weight = weight
      set.reps = reps
      set.estimated1RM = epley(weight, reps)
      if (dateStr) {
        set.date = new Date(dateStr + 'T12:00:00').toISOString()
      }
      this._persist()
    },

    deleteSet(exerciseId, setId) {
      const exercise = this.exercises.find(e => e.id === exerciseId)
      if (!exercise) return
      exercise.sets = exercise.sets.filter(s => s.id !== setId)
      this._persist()
    },

    clearSets(exerciseId) {
      const exercise = this.exercises.find(e => e.id === exerciseId)
      if (!exercise) return
      exercise.sets = []
      this._persist()
    }
  },

  getters: {
    getExercisePR: (state) => (exerciseId) => {
      const exercise = state.exercises.find(e => e.id === exerciseId)
      if (!exercise || exercise.sets.length === 0) return 0
      return Math.max(...exercise.sets.map(s => s.estimated1RM))
    },

    getRecentSets: (state) => (exerciseId, limit = 5) => {
      const exercise = state.exercises.find(e => e.id === exerciseId)
      if (!exercise) return []
      return [...exercise.sets].reverse().slice(0, limit)
    }
  }
})
