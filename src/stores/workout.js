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
        tags: ex.tags || [],
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

    addExercise(name, tags = []) {
      const trimmed = name.trim()
      if (!trimmed) return null
      const existing = this.exercises.find(
        e => e.name.toLowerCase() === trimmed.toLowerCase()
      )
      if (existing) return existing.id
      const id = crypto.randomUUID()
      this.exercises.push({ id, name: trimmed, tags: [...tags], sets: [] })
      this._persist()

      if (supabase && this._userId) {
        supabase.from('exercises').insert({
          id, user_id: this._userId, name: trimmed, tags: [...tags]
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
    },

    renameExercise(exerciseId, newName) {
      const trimmed = newName.trim()
      if (!trimmed) return
      const exercise = this.exercises.find(e => e.id === exerciseId)
      if (!exercise) return
      exercise.name = trimmed
      this._persist()

      if (supabase && this._userId) {
        supabase.from('exercises').update({ name: trimmed }).eq('id', exerciseId).then()
      }
    },

    updateExerciseTags(exerciseId, tags) {
      const exercise = this.exercises.find(e => e.id === exerciseId)
      if (!exercise) return
      exercise.tags = [...tags]
      this._persist()

      if (supabase && this._userId) {
        supabase.from('exercises').update({ tags }).eq('id', exerciseId).then()
      }
    },

    deleteExercise(exerciseId) {
      const idx = this.exercises.findIndex(e => e.id === exerciseId)
      if (idx === -1) return
      this.exercises.splice(idx, 1)
      this._persist()

      if (supabase && this._userId) {
        Promise.all([
          supabase.from('sets').delete().eq('exercise_id', exerciseId),
          supabase.from('exercises').delete().eq('id', exerciseId)
        ]).then()
      }
    },

    moveExercise(exerciseId, direction) {
      const idx = this.exercises.findIndex(e => e.id === exerciseId)
      if (idx === -1) return
      const newIdx = idx + direction
      if (newIdx < 0 || newIdx >= this.exercises.length) return
      const [item] = this.exercises.splice(idx, 1)
      this.exercises.splice(newIdx, 0, item)
      this._persist()
    },

    reorderExercise(fromIndex, toIndex) {
      if (fromIndex === toIndex) return
      if (fromIndex < 0 || toIndex < 0) return
      if (fromIndex >= this.exercises.length || toIndex >= this.exercises.length) return
      const [item] = this.exercises.splice(fromIndex, 1)
      this.exercises.splice(toIndex, 0, item)
      this._persist()
    }
  },

  getters: {
    allTags: (state) => {
      const tagSet = new Set()
      state.exercises.forEach(e => (e.tags || []).forEach(t => tagSet.add(t)))
      return [...tagSet].sort()
    },

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
