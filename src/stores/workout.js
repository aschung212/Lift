import { defineStore } from 'pinia'
import { supabase } from '../lib/supabase'

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
    exercises: load(),
    _userId: null
  }),

  actions: {
    _persist() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.exercises))
    },

    async init(userId) {
      this._userId = userId
      await this._fetchFromSupabase()
    },

    async _fetchFromSupabase() {
      if (!supabase || !this._userId) return

      const [{ data: exercises }, { data: sets }] = await Promise.all([
        supabase.from('exercises').select('*').eq('user_id', this._userId).order('created_at'),
        supabase.from('sets').select('*').eq('user_id', this._userId).order('created_at')
      ])

      if (!exercises) return

      this.exercises = exercises.map(ex => ({
        id: ex.id,
        name: ex.name,
        sets: (sets || [])
          .filter(s => s.exercise_id === ex.id)
          .map(s => ({
            id: s.id,
            date: s.date,
            weight: s.weight,
            reps: s.reps,
            estimated1RM: s.estimated_1rm
          }))
      }))
      this._persist()
    },

    addExercise(name) {
      const trimmed = name.trim()
      if (!trimmed) return null
      const existing = this.exercises.find(
        e => e.name.toLowerCase() === trimmed.toLowerCase()
      )
      if (existing) return existing.id
      const id = crypto.randomUUID()
      this.exercises.push({ id, name: trimmed, sets: [] })
      this._persist()

      if (supabase && this._userId) {
        supabase.from('exercises').insert({
          id, user_id: this._userId, name: trimmed
        }).then()
      }
      return id
    },

    logSet(exerciseId, weight, reps, dateStr) {
      const exercise = this.exercises.find(e => e.id === exerciseId)
      if (!exercise) return
      const date = dateStr
        ? new Date(dateStr + 'T12:00:00').toISOString()
        : new Date().toISOString()
      const id = crypto.randomUUID()
      const estimated1RM = epley(weight, reps)
      exercise.sets.push({ id, date, weight, reps, estimated1RM })
      this._persist()

      if (supabase && this._userId) {
        supabase.from('sets').insert({
          id, user_id: this._userId, exercise_id: exerciseId,
          date, weight, reps, estimated_1rm: estimated1RM
        }).then()
      }
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

      if (supabase && this._userId) {
        const update = { weight, reps, estimated_1rm: set.estimated1RM }
        if (dateStr) update.date = set.date
        supabase.from('sets').update(update).eq('id', setId).then()
      }
    },

    deleteSet(exerciseId, setId) {
      const exercise = this.exercises.find(e => e.id === exerciseId)
      if (!exercise) return
      exercise.sets = exercise.sets.filter(s => s.id !== setId)
      this._persist()

      if (supabase && this._userId) {
        supabase.from('sets').delete().eq('id', setId).then()
      }
    },

    clearSets(exerciseId) {
      const exercise = this.exercises.find(e => e.id === exerciseId)
      if (!exercise) return
      exercise.sets = []
      this._persist()

      if (supabase && this._userId) {
        supabase.from('sets').delete().eq('exercise_id', exerciseId).then()
      }
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
