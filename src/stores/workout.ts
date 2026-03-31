import { defineStore } from 'pinia'
import { supabase } from '../lib/supabase'
import { uuid } from '../lib/uuid'

const STORAGE_KEY = 'workout-exercises'

export interface WorkoutSet {
  id: string
  date: string
  weight: number
  reps: number
  estimated1RM: number
}

export interface Exercise {
  id: string
  name: string
  tags: string[]
  sets: WorkoutSet[]
}

export interface OverloadSuggestion {
  type: 'increase_weight' | 'increase_reps'
  weight: number
  reps: number
  reason: string
}

function epley(weight: number, reps: number): number {
  if (reps === 1) return Math.round(weight)
  return Math.round(weight * (1 + reps / 30))
}

function load(): Exercise[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export const useWorkoutStore = defineStore('workout', {
  state: () => ({
    exercises: load() as Exercise[],
    _userId: null as string | null
  }),

  actions: {
    _persist() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.exercises))
    },

    async init(userId: string) {
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

      this.exercises = exercises.map((ex: Record<string, unknown>) => ({
        id: ex.id as string,
        name: ex.name as string,
        tags: (ex.tags as string[]) || [],
        sets: (sets || [])
          .filter((s: Record<string, unknown>) => s.exercise_id === ex.id)
          .map((s: Record<string, unknown>) => ({
            id: s.id as string,
            date: s.date as string,
            weight: s.weight as number,
            reps: s.reps as number,
            estimated1RM: s.estimated_1rm as number
          }))
      }))
      this._persist()
    },

    addExercise(name: string, tags: string[] = [], { sync = true }: { sync?: boolean } = {}): string | null {
      const trimmed = name.trim()
      if (!trimmed) return null
      const existing = this.exercises.find(
        (e: Exercise) => e.name.toLowerCase() === trimmed.toLowerCase()
      )
      if (existing) return existing.id
      const id = uuid()
      this.exercises.push({ id, name: trimmed, tags: [...tags], sets: [] })
      this._persist()

      if (sync && supabase && this._userId) {
        supabase.from('exercises').insert({
          id, user_id: this._userId, name: trimmed, tags: [...tags]
        }).then()
      }
      return id
    },

    logSet(exerciseId: string, weight: number, reps: number, dateStr?: string, { sync = true }: { sync?: boolean } = {}) {
      const exercise = this.exercises.find((e: Exercise) => e.id === exerciseId)
      if (!exercise) return
      const date = dateStr
        ? new Date(dateStr + 'T12:00:00').toISOString()
        : new Date().toISOString()
      const id = uuid()
      const estimated1RM = epley(weight, reps)
      exercise.sets.push({ id, date, weight, reps, estimated1RM })
      this._persist()

      if (sync && supabase && this._userId) {
        supabase.from('sets').insert({
          id, user_id: this._userId, exercise_id: exerciseId,
          date, weight, reps, estimated_1rm: estimated1RM
        }).then()
      }
    },

    updateSet(exerciseId: string, setId: string, weight: number, reps: number, dateStr?: string) {
      const exercise = this.exercises.find((e: Exercise) => e.id === exerciseId)
      if (!exercise) return
      const set = exercise.sets.find((s: WorkoutSet) => s.id === setId)
      if (!set) return
      set.weight = weight
      set.reps = reps
      set.estimated1RM = epley(weight, reps)
      if (dateStr) {
        set.date = new Date(dateStr + 'T12:00:00').toISOString()
      }
      this._persist()

      if (supabase && this._userId) {
        const update: Record<string, unknown> = { weight, reps, estimated_1rm: set.estimated1RM }
        if (dateStr) update.date = set.date
        supabase.from('sets').update(update).eq('id', setId).then()
      }
    },

    deleteSet(exerciseId: string, setId: string, { sync = true }: { sync?: boolean } = {}) {
      const exercise = this.exercises.find((e: Exercise) => e.id === exerciseId)
      if (!exercise) return
      exercise.sets = exercise.sets.filter((s: WorkoutSet) => s.id !== setId)
      this._persist()

      if (sync && supabase && this._userId) {
        supabase.from('sets').delete().eq('id', setId).then()
      }
    },

    restoreSet(exerciseId: string, set: WorkoutSet) {
      const exercise = this.exercises.find((e: Exercise) => e.id === exerciseId)
      if (!exercise) return
      exercise.sets.push(set)
      this._persist()
    },

    clearSets(exerciseId: string, { sync = true }: { sync?: boolean } = {}) {
      const exercise = this.exercises.find((e: Exercise) => e.id === exerciseId)
      if (!exercise) return
      exercise.sets = []
      this._persist()

      if (sync && supabase && this._userId) {
        supabase.from('sets').delete().eq('exercise_id', exerciseId).then()
      }
    },

    restoreSets(exerciseId: string, sets: WorkoutSet[]) {
      const exercise = this.exercises.find((e: Exercise) => e.id === exerciseId)
      if (!exercise) return
      exercise.sets = [...sets]
      this._persist()
    },

    renameExercise(exerciseId: string, newName: string) {
      const trimmed = newName.trim()
      if (!trimmed) return
      const exercise = this.exercises.find((e: Exercise) => e.id === exerciseId)
      if (!exercise) return
      exercise.name = trimmed
      this._persist()

      if (supabase && this._userId) {
        supabase.from('exercises').update({ name: trimmed }).eq('id', exerciseId).then()
      }
    },

    updateExerciseTags(exerciseId: string, tags: string[]) {
      const exercise = this.exercises.find((e: Exercise) => e.id === exerciseId)
      if (!exercise) return
      exercise.tags = [...tags]
      this._persist()

      if (supabase && this._userId) {
        supabase.from('exercises').update({ tags }).eq('id', exerciseId).then()
      }
    },

    deleteExercise(exerciseId: string, { sync = true }: { sync?: boolean } = {}) {
      const idx = this.exercises.findIndex((e: Exercise) => e.id === exerciseId)
      if (idx === -1) return
      this.exercises.splice(idx, 1)
      this._persist()

      if (sync && supabase && this._userId) {
        Promise.all([
          supabase.from('sets').delete().eq('exercise_id', exerciseId),
          supabase.from('exercises').delete().eq('id', exerciseId)
        ]).then()
      }
    },

    restoreExercise(exercise: Exercise, atIndex?: number) {
      if (atIndex !== undefined && atIndex >= 0 && atIndex <= this.exercises.length) {
        this.exercises.splice(atIndex, 0, exercise)
      } else {
        this.exercises.push(exercise)
      }
      this._persist()
    },

    syncDeleteSet(setId: string) {
      if (supabase && this._userId) {
        supabase.from('sets').delete().eq('id', setId).then()
      }
    },

    syncDeleteSets(exerciseId: string) {
      if (supabase && this._userId) {
        supabase.from('sets').delete().eq('exercise_id', exerciseId).then()
      }
    },

    syncDeleteExercise(exerciseId: string) {
      if (supabase && this._userId) {
        Promise.all([
          supabase.from('sets').delete().eq('exercise_id', exerciseId),
          supabase.from('exercises').delete().eq('id', exerciseId)
        ]).then()
      }
    },

    moveExercise(exerciseId: string, direction: number) {
      const idx = this.exercises.findIndex((e: Exercise) => e.id === exerciseId)
      if (idx === -1) return
      const newIdx = idx + direction
      if (newIdx < 0 || newIdx >= this.exercises.length) return
      const [item] = this.exercises.splice(idx, 1)
      this.exercises.splice(newIdx, 0, item)
      this._persist()
    },

    reorderExercise(fromIndex: number, toIndex: number) {
      if (fromIndex === toIndex) return
      if (fromIndex < 0 || toIndex < 0) return
      if (fromIndex >= this.exercises.length || toIndex >= this.exercises.length) return
      const [item] = this.exercises.splice(fromIndex, 1)
      this.exercises.splice(toIndex, 0, item)
      this._persist()
    },

    renameTag(oldName: string, newName: string) {
      const trimmed = newName.trim()
      if (!trimmed || trimmed === oldName) return
      this.exercises.forEach((e: Exercise) => {
        const idx = e.tags.indexOf(oldName)
        if (idx !== -1) {
          // Replace old tag; avoid duplicates if newName already exists on this exercise
          if (e.tags.includes(trimmed)) {
            e.tags.splice(idx, 1)
          } else {
            e.tags[idx] = trimmed
          }
        }
      })
      this._persist()

      if (supabase && this._userId) {
        const sb = supabase
        this.exercises.forEach((e: Exercise) => {
          sb.from('exercises').update({ tags: e.tags }).eq('id', e.id).then()
        })
      }
    },

    deleteTag(tagName: string) {
      this.exercises.forEach((e: Exercise) => {
        const idx = e.tags.indexOf(tagName)
        if (idx !== -1) e.tags.splice(idx, 1)
      })
      this._persist()

      if (supabase && this._userId) {
        const sb = supabase
        this.exercises.forEach((e: Exercise) => {
          sb.from('exercises').update({ tags: e.tags }).eq('id', e.id).then()
        })
      }
    }
  },

  getters: {
    allTags: (state): string[] => {
      const tagSet = new Set<string>()
      state.exercises.forEach((e: Exercise) => (e.tags || []).forEach((t: string) => tagSet.add(t)))
      return [...tagSet].sort()
    },

    getExercisePR: (state) => (exerciseId: string): number => {
      const exercise = state.exercises.find((e: Exercise) => e.id === exerciseId)
      if (!exercise || exercise.sets.length === 0) return 0
      return Math.max(...exercise.sets.map((s: WorkoutSet) => s.estimated1RM))
    },

    getRecentSets: (state) => (exerciseId: string, limit = 5): WorkoutSet[] => {
      const exercise = state.exercises.find((e: Exercise) => e.id === exerciseId)
      if (!exercise) return []
      return [...exercise.sets].reverse().slice(0, limit)
    },

    /**
     * Progressive overload suggestion for an exercise.
     * Analyzes recent sessions to suggest the next weight × reps.
     *
     * Algorithm:
     * 1. Group sets by date into sessions (most recent first)
     * 2. Take the top set (highest weight) from each of the last 3 sessions
     * 3. If user lifted the same weight×reps across 2+ sessions → suggest +5 lbs
     * 4. If user increased reps but not weight recently → suggest weight increase
     * 5. Otherwise suggest +1 rep at same weight
     */
    getOverloadSuggestion: (state) => (exerciseId: string): OverloadSuggestion | null => {
      const exercise = state.exercises.find((e: Exercise) => e.id === exerciseId)
      if (!exercise || exercise.sets.length < 3) return null

      // Group sets by date (YYYY-MM-DD) → sessions
      const sessions = new Map<string, WorkoutSet[]>()
      for (const set of exercise.sets) {
        const day = set.date.slice(0, 10)
        if (!sessions.has(day)) sessions.set(day, [])
        sessions.get(day)!.push(set)
      }

      // Sort sessions by date descending, take last 3
      const sortedDays = [...sessions.keys()].sort().reverse()
      if (sortedDays.length < 2) return null

      const recentSessions = sortedDays.slice(0, 3)

      // Get top set (heaviest weight) from each session
      const topSets = recentSessions.map(day => {
        const sets = sessions.get(day)!
        return sets.reduce((best, s) => s.weight > best.weight || (s.weight === best.weight && s.reps > best.reps) ? s : best)
      })

      const latest = topSets[0]
      const previous = topSets[1]

      // Check if user has been consistent at same weight across recent sessions
      const sameWeight = topSets.filter(s => s.weight === latest.weight)
      const WEIGHT_INCREMENT = 5 // lbs

      if (sameWeight.length >= 2 && latest.reps >= 5) {
        // Consistent at same weight with solid reps → increase weight
        // Suggest same reps (or slightly fewer) at higher weight
        const suggestedReps = Math.max(latest.reps - 2, 3)
        return {
          type: 'increase_weight',
          weight: latest.weight + WEIGHT_INCREMENT,
          reps: suggestedReps,
          reason: `You've hit ${latest.weight} lbs × ${latest.reps} in ${sameWeight.length} recent sessions — time to go heavier`
        }
      }

      if (latest.weight === previous.weight && latest.reps > previous.reps) {
        // Reps increasing at same weight → keep building or bump weight
        if (latest.reps >= 8) {
          return {
            type: 'increase_weight',
            weight: latest.weight + WEIGHT_INCREMENT,
            reps: Math.max(latest.reps - 2, 3),
            reason: `Strong rep progression at ${latest.weight} lbs — ready for a weight increase`
          }
        }
        return {
          type: 'increase_reps',
          weight: latest.weight,
          reps: latest.reps + 1,
          reason: `You went from ${previous.reps} to ${latest.reps} reps — keep building`
        }
      }

      if (latest.weight > previous.weight) {
        // Already increased weight recently → consolidate
        return {
          type: 'increase_reps',
          weight: latest.weight,
          reps: latest.reps + 1,
          reason: `You recently moved up to ${latest.weight} lbs — build reps before adding more weight`
        }
      }

      // Default: suggest adding a rep
      return {
        type: 'increase_reps',
        weight: latest.weight,
        reps: latest.reps + 1,
        reason: `Try adding one more rep at ${latest.weight} lbs`
      }
    }
  }
})
