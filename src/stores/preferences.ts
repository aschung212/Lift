import { defineStore } from 'pinia'
import { supabase } from '../lib/supabase'
import { syncQueue } from '../lib/syncQueue'
import { logError } from '../lib/logger'
import { broadcastStoreUpdate } from '../lib/broadcastSync'

const STORAGE_KEY = 'user-preferences'

export interface FeatureFlags {
  workouts: boolean
  calendar: boolean
  weight: boolean
  [key: string]: boolean
}

export type WeightGoalDirection = 'lose' | 'gain' | 'maintain'

export interface WeightGoalConfig {
  direction: WeightGoalDirection
  loseTarget: number | null     // remembered target for lose mode
  gainTarget: number | null     // remembered target for gain mode
  maintainMin: number | null    // optional floor for maintain
  maintainMax: number | null    // optional ceiling for maintain
}

export interface ExperienceFlags {
  /** Fire the full-screen PR burst when a set beats the user's e1RM for an exercise. */
  prCelebrations: boolean
  /** Allow haptic feedback on taps, PRs, and timer end. */
  haptics: boolean
  /** Keep the screen awake during rest timer and set logging. */
  screenWakeLock: boolean
}

const DEFAULT_WEIGHT_GOAL: WeightGoalConfig = {
  direction: 'lose',
  loseTarget: null,
  gainTarget: null,
  maintainMin: null,
  maintainMax: null,
}

const DEFAULTS: FeatureFlags = {
  workouts: true,
  calendar: true,
  weight: true,
}

const DEFAULT_EXPERIENCE: ExperienceFlags = {
  prCelebrations: true,
  haptics: true,
  screenWakeLock: true,
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _migrateWeightGoal(raw: any): WeightGoalConfig {
  // v1: string ('lose' | 'gain' | 'maintain')
  if (typeof raw === 'string') {
    return { ...DEFAULT_WEIGHT_GOAL, direction: raw as WeightGoalDirection }
  }
  const goal = { ...DEFAULT_WEIGHT_GOAL, ...raw }
  // v2: had single targetWeight field — migrate to direction-specific
  if ('targetWeight' in raw && raw.targetWeight != null) {
    if (goal.direction === 'gain') goal.gainTarget = raw.targetWeight
    else goal.loseTarget = raw.targetWeight
    delete (goal as Record<string, unknown>).targetWeight
  }
  return goal
}

export const usePreferencesStore = defineStore('preferences', {
  state: () => ({
    features: { ...DEFAULTS } as FeatureFlags,
    weightGoal: { ...DEFAULT_WEIGHT_GOAL } as WeightGoalConfig,
    experience: { ...DEFAULT_EXPERIENCE } as ExperienceFlags,
    _userId: null as string | null,
  }),

  actions: {
    _persist() {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ features: this.features, weightGoal: this.weightGoal, experience: this.experience }),
        )
      } catch (e) {
        logError(e, { source: 'preferences._persist' })
      }
      broadcastStoreUpdate('preferences')
      if (supabase && this._userId) {
        const features = { ...this.features }
        const weightGoal = this.weightGoal
        const experience = { ...this.experience }
        const userId = this._userId
        syncQueue.enqueue(`preferences:${userId}`, () =>
          supabase!
            .from('user_preferences')
            .upsert(
              { user_id: userId, preferences: { features, weightGoal, experience }, updated_at: new Date().toISOString() },
              { onConflict: 'user_id' }
            )
        )
      }
    },

    async init(userId: string) {
      this._userId = userId

      // Load from localStorage first (instant)
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        try {
          const parsed = JSON.parse(raw)
          if (parsed.features) this.features = { ...DEFAULTS, ...parsed.features }
          if (parsed.weightGoal) {
            this.weightGoal = _migrateWeightGoal(parsed.weightGoal)
          }
          if (parsed.experience) {
            this.experience = { ...DEFAULT_EXPERIENCE, ...parsed.experience }
          }
        } catch { /* ignore corrupt data */ }
      }

      // Then try Supabase (overrides local if exists)
      if (supabase) {
        try {
          const { data } = await supabase
            .from('user_preferences')
            .select('preferences')
            .eq('user_id', userId)
            .single()
          const prefs = data?.preferences as Record<string, unknown> | null
          if (prefs?.features) {
            this.features = { ...DEFAULTS, ...prefs.features as Record<string, boolean> }
            if (prefs.weightGoal) {
              this.weightGoal = _migrateWeightGoal(prefs.weightGoal as { target?: number; unit?: string })
            }
            if (prefs.experience) {
              this.experience = { ...DEFAULT_EXPERIENCE, ...(prefs.experience as Partial<ExperienceFlags>) }
            }
            localStorage.setItem(
              STORAGE_KEY,
              JSON.stringify({ features: this.features, weightGoal: this.weightGoal, experience: this.experience }),
            )
          }
        } catch { /* table may not exist yet or no row */ }
      }
    },

    toggleFeature(featureId: string) {
      // Prevent disabling the last enabled tab
      if (this.features[featureId] && this.enabledCount <= 1) return
      this.features[featureId] = !this.features[featureId]
      this._persist()
    },

    setExperienceFlag<K extends keyof ExperienceFlags>(key: K, value: ExperienceFlags[K]) {
      this.experience[key] = value
      this._persist()
    },

    setWeightGoalDirection(direction: WeightGoalDirection) {
      this.weightGoal.direction = direction
      this._persist()
    },

    setTargetForDirection(target: number | null) {
      const dir = this.weightGoal.direction
      if (dir === 'lose') this.weightGoal.loseTarget = target
      else if (dir === 'gain') this.weightGoal.gainTarget = target
      this._persist()
    },

    setMaintainRange(min: number | null, max: number | null) {
      this.weightGoal.maintainMin = min
      this.weightGoal.maintainMax = max
      this._persist()
    },

    clearAllGoalValues() {
      this.weightGoal.loseTarget = null
      this.weightGoal.gainTarget = null
      this.weightGoal.maintainMin = null
      this.weightGoal.maintainMax = null
      this._persist()
    },
  },

  getters: {
    enabledCount: (state): number => Object.values(state.features).filter(Boolean).length,
    currentTarget: (state): number | null => {
      const dir = state.weightGoal.direction
      if (dir === 'lose') return state.weightGoal.loseTarget
      if (dir === 'gain') return state.weightGoal.gainTarget
      return null
    },
    hasAnyGoalValue: (state): boolean =>
      state.weightGoal.loseTarget != null ||
      state.weightGoal.gainTarget != null ||
      state.weightGoal.maintainMin != null ||
      state.weightGoal.maintainMax != null,
  },
})
