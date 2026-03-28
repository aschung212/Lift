import { defineStore } from 'pinia'
import { supabase } from '../lib/supabase'

const STORAGE_KEY = 'user-preferences'

const DEFAULTS = {
  workouts: true,
  calendar: true,
  weight: true,
}

export const usePreferencesStore = defineStore('preferences', {
  state: () => ({
    features: { ...DEFAULTS },
    _userId: null,
  }),

  actions: {
    _persist() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ features: this.features }))
      if (supabase && this._userId) {
        supabase
          .from('user_preferences')
          .upsert(
            { user_id: this._userId, preferences: { features: this.features }, updated_at: new Date().toISOString() },
            { onConflict: 'user_id' }
          )
          .then()
      }
    },

    async init(userId) {
      this._userId = userId

      // Load from localStorage first (instant)
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        try {
          const parsed = JSON.parse(raw)
          if (parsed.features) this.features = { ...DEFAULTS, ...parsed.features }
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
          if (data?.preferences?.features) {
            this.features = { ...DEFAULTS, ...data.preferences.features }
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ features: this.features }))
          }
        } catch { /* table may not exist yet or no row */ }
      }
    },

    toggleFeature(featureId) {
      this.features[featureId] = !this.features[featureId]
      this._persist()
    },

    setFeature(featureId, enabled) {
      this.features[featureId] = enabled
      this._persist()
    },
  },

  getters: {
    enabledCount: (state) => Object.values(state.features).filter(Boolean).length,
  },
})
