import { defineStore } from 'pinia'
import { supabase } from '../lib/supabase'
import { syncQueue } from '../lib/syncQueue'
import { logError } from '../lib/logger'
import { backupToIDB } from '../lib/durableStorage'
import { broadcastStoreUpdate } from '../lib/crossTabSync'
import { sanitizeIntensityPresets, DEFAULT_INTENSITY_PRESETS } from '../lib/intensityTable'
import { sanitizeCoachProfile, DEFAULT_COACH_PROFILE, type CoachProfile } from '../lib/coachProfile'
import { localDateKey } from '../lib/dates'
import { classifySyncError, type SyncErrorKind } from '../lib/syncStatus'

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
  /**
   * Master switch for celebration moments: the full-screen PR burst when a set
   * beats the user's e1RM, and the lighter weekly-goal / streak-milestone banner.
   */
  prCelebrations: boolean
  /** Allow haptic feedback on taps, PRs, and timer end. */
  haptics: boolean
  /** Keep the screen awake during rest timer and set logging. */
  screenWakeLock: boolean
  /** Show a browser notification when the rest timer completes while the app is backgrounded. */
  restTimerNotification: boolean
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
  restTimerNotification: true,
}

export interface FilterSettings {
  /** e1RM ratio threshold (0–1) below which a pre-top set is classified as warmup. Default 0.75 */
  warmupThreshold: number
}

const DEFAULT_FILTERS: FilterSettings = {
  warmupThreshold: 0.75,
}

const VALID_DIRECTIONS: ReadonlySet<string> = new Set(['lose', 'gain', 'maintain'])

function _isValidDirection(value: unknown): value is WeightGoalDirection {
  return typeof value === 'string' && VALID_DIRECTIONS.has(value)
}

/**
 * Migrate weight-goal data from any previous schema version to the current shape.
 * Exported for testing only — not part of the public API.
 */
export function _migrateWeightGoal(raw: unknown): WeightGoalConfig {
  // v1: bare string direction ('lose' | 'gain' | 'maintain')
  if (typeof raw === 'string') {
    if (_isValidDirection(raw)) {
      return { ...DEFAULT_WEIGHT_GOAL, direction: raw }
    }
    logError(new Error(`_migrateWeightGoal: unrecognized direction string "${raw}"`), { source: 'preferences.migrate' })
    return { ...DEFAULT_WEIGHT_GOAL }
  }

  // Must be a non-null object for v2/v3 shapes
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    logError(new Error(`_migrateWeightGoal: unexpected type ${raw === null ? 'null' : typeof raw}`), { source: 'preferences.migrate' })
    return { ...DEFAULT_WEIGHT_GOAL }
  }

  const obj = raw as Record<string, unknown>

  // Validate direction if present
  const direction: WeightGoalDirection =
    _isValidDirection(obj.direction) ? obj.direction : DEFAULT_WEIGHT_GOAL.direction

  const goal: WeightGoalConfig = {
    direction,
    loseTarget: typeof obj.loseTarget === 'number' ? obj.loseTarget : DEFAULT_WEIGHT_GOAL.loseTarget,
    gainTarget: typeof obj.gainTarget === 'number' ? obj.gainTarget : DEFAULT_WEIGHT_GOAL.gainTarget,
    maintainMin: typeof obj.maintainMin === 'number' ? obj.maintainMin : DEFAULT_WEIGHT_GOAL.maintainMin,
    maintainMax: typeof obj.maintainMax === 'number' ? obj.maintainMax : DEFAULT_WEIGHT_GOAL.maintainMax,
  }

  // v2: had single targetWeight field — migrate to direction-specific
  if ('targetWeight' in obj && typeof obj.targetWeight === 'number') {
    if (goal.direction === 'gain') goal.gainTarget = obj.targetWeight
    else goal.loseTarget = obj.targetWeight
  }

  return goal
}

export const usePreferencesStore = defineStore('preferences', {
  state: () => ({
    features: { ...DEFAULTS } as FeatureFlags,
    weightGoal: { ...DEFAULT_WEIGHT_GOAL } as WeightGoalConfig,
    experience: { ...DEFAULT_EXPERIENCE } as ExperienceFlags,
    filters: { ...DEFAULT_FILTERS } as FilterSettings,
    prBaselineDate: null as string | null,
    /** Synced appearance/behavior settings (previously standalone localStorage keys). */
    theme: 'eternal' as string,
    colorMode: 'dark' as string,
    weightUnit: 'lbs' as string,
    restTimerEnabled: true,
    restTimerAutoStart: true,
    appIcon: 'default' as string,
    /** Tappable intensity presets (% of max) in the log-set Intensity lens (#776). */
    intensityPresets: [...DEFAULT_INTENSITY_PRESETS] as number[],
    /** AI Coach athlete profile — individualizes the export (#931). Synced in the blob. */
    coachProfile: { ...DEFAULT_COACH_PROFILE, competition: { ...DEFAULT_COACH_PROFILE.competition } } as CoachProfile,
    _userId: null as string | null,
    // Uniform sync-status contract (LIFT-820): observable by the UI.
    syncing: false,
    lastSyncError: null as SyncErrorKind | null,
  }),

  actions: {
    _persist() {
      const payload = {
        features: this.features,
        weightGoal: this.weightGoal,
        experience: this.experience,
        filters: this.filters,
        prBaselineDate: this.prBaselineDate,
        theme: this.theme,
        colorMode: this.colorMode,
        weightUnit: this.weightUnit,
        restTimerEnabled: this.restTimerEnabled,
        restTimerAutoStart: this.restTimerAutoStart,
        appIcon: this.appIcon,
        intensityPresets: this.intensityPresets,
        coachProfile: this.coachProfile,
      }
      const data = JSON.stringify(payload)
      try {
        localStorage.setItem(STORAGE_KEY, data)
        // Write individual keys so initTheme() can read them before Pinia
        // for FOUC prevention on the next page load.
        localStorage.setItem('app-theme', this.theme)
        localStorage.setItem('app-mode', this.colorMode)
        localStorage.setItem('weight-unit', this.weightUnit)
        localStorage.setItem('rest-timer', this.restTimerEnabled ? 'on' : 'off')
        localStorage.setItem('rest-timer-autostart', this.restTimerAutoStart ? 'on' : 'off')
      } catch (e) {
        logError(e, { source: 'preferences._persist' })
      }
      backupToIDB(STORAGE_KEY, data)
      broadcastStoreUpdate('preferences')
      if (supabase && this._userId) {
        const userId = this._userId
        syncQueue.enqueue(`preferences:${userId}`, () =>
          supabase!
            .from('user_preferences')
            .upsert(
              { user_id: userId, preferences: { ...payload }, updated_at: new Date().toISOString() },
              { onConflict: 'user_id' }
            )
        )
      }
    },

    /** Re-read state from localStorage (called by cross-tab sync listener). */
    _reloadFromStorage() {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      try {
        const parsed = JSON.parse(raw)
        if (parsed.features) this.features = { ...DEFAULTS, ...parsed.features }
        if (parsed.weightGoal) this.weightGoal = _migrateWeightGoal(parsed.weightGoal)
        if (parsed.experience) this.experience = { ...DEFAULT_EXPERIENCE, ...parsed.experience }
        if (parsed.filters) this.filters = { ...DEFAULT_FILTERS, ...parsed.filters }
        if (typeof parsed.theme === 'string') this.theme = parsed.theme
        if (typeof parsed.colorMode === 'string') this.colorMode = parsed.colorMode
        if (typeof parsed.weightUnit === 'string') this.weightUnit = parsed.weightUnit
        if (typeof parsed.restTimerEnabled === 'boolean') this.restTimerEnabled = parsed.restTimerEnabled
        if (typeof parsed.restTimerAutoStart === 'boolean') this.restTimerAutoStart = parsed.restTimerAutoStart
        if (typeof parsed.appIcon === 'string') this.appIcon = parsed.appIcon
        if (parsed.intensityPresets) this.intensityPresets = sanitizeIntensityPresets(parsed.intensityPresets)
        if (parsed.coachProfile) this.coachProfile = sanitizeCoachProfile(parsed.coachProfile)
      } catch { /* ignore corrupt data */ }
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
          if (parsed.filters) {
            this.filters = { ...DEFAULT_FILTERS, ...parsed.filters }
          }
          if (typeof parsed.prBaselineDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.prBaselineDate)) {
            this.prBaselineDate = parsed.prBaselineDate
          }
          // Load synced settings from JSON blob
          if (typeof parsed.theme === 'string') this.theme = parsed.theme
          if (typeof parsed.colorMode === 'string') this.colorMode = parsed.colorMode
          if (typeof parsed.weightUnit === 'string') this.weightUnit = parsed.weightUnit
          if (typeof parsed.restTimerEnabled === 'boolean') this.restTimerEnabled = parsed.restTimerEnabled
          if (typeof parsed.restTimerAutoStart === 'boolean') this.restTimerAutoStart = parsed.restTimerAutoStart
          if (typeof parsed.appIcon === 'string') this.appIcon = parsed.appIcon
          if (parsed.intensityPresets) this.intensityPresets = sanitizeIntensityPresets(parsed.intensityPresets)
          if (parsed.coachProfile) this.coachProfile = sanitizeCoachProfile(parsed.coachProfile)
        } catch { /* ignore corrupt data */ }
      }

      // Migrate standalone localStorage keys into the synced payload.
      // These keys predate the preferences store — read them as fallbacks
      // when the JSON blob doesn't contain them yet.
      try {
        if (this.theme === 'eternal') {
          const legacy = localStorage.getItem('app-theme')
          if (legacy && legacy !== 'eternal') this.theme = legacy
        }
        if (this.colorMode === 'dark') {
          const legacy = localStorage.getItem('app-mode')
          if (legacy && legacy !== 'dark') this.colorMode = legacy
        }
        if (this.weightUnit === 'lbs') {
          const legacy = localStorage.getItem('weight-unit')
          if (legacy && legacy !== 'lbs') this.weightUnit = legacy
        }
        const legacyTimer = localStorage.getItem('rest-timer')
        if (legacyTimer === 'off') this.restTimerEnabled = false
        const legacyAutoStart = localStorage.getItem('rest-timer-autostart')
        if (legacyAutoStart === 'off') this.restTimerAutoStart = false
      } catch { /* ignore */ }

      // Migrate from old standalone localStorage key (pre-sync era)
      if (this.prBaselineDate === null) {
        try {
          const legacy = localStorage.getItem('pr-baseline-date')
          if (legacy && /^\d{4}-\d{2}-\d{2}$/.test(legacy)) {
            this.prBaselineDate = legacy
            localStorage.removeItem('pr-baseline-date')
            this._persist()
          }
        } catch { /* ignore */ }
      }

      // Then try Supabase (overrides local if exists)
      if (supabase) {
        this.syncing = true
        try {
          const { data, error } = await supabase
            .from('user_preferences')
            .select('preferences')
            .eq('user_id', userId)
            .single()
          // PGRST116 (no row yet) is not a sync failure — only a real error is.
          if (error && error.code !== 'PGRST116') {
            this.lastSyncError = classifySyncError(error)
          } else {
            this.lastSyncError = null
          }
          const prefs = data?.preferences as Record<string, unknown> | null
          if (prefs?.features) {
            this.features = { ...DEFAULTS, ...prefs.features as Record<string, boolean> }
            if (prefs.weightGoal) {
              this.weightGoal = _migrateWeightGoal(prefs.weightGoal)
            }
            if (prefs.experience) {
              this.experience = { ...DEFAULT_EXPERIENCE, ...(prefs.experience as Partial<ExperienceFlags>) }
            }
            if (prefs.filters) {
              this.filters = { ...DEFAULT_FILTERS, ...(prefs.filters as Partial<FilterSettings>) }
            }
            if (typeof prefs.prBaselineDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(prefs.prBaselineDate as string)) {
              this.prBaselineDate = prefs.prBaselineDate as string
            } else if ('prBaselineDate' in prefs && prefs.prBaselineDate === null) {
              this.prBaselineDate = null
            }
            // Sync appearance/behavior settings from Supabase
            if (typeof prefs.theme === 'string') this.theme = prefs.theme as string
            if (typeof prefs.colorMode === 'string') this.colorMode = prefs.colorMode as string
            if (typeof prefs.weightUnit === 'string') this.weightUnit = prefs.weightUnit as string
            if (typeof prefs.restTimerEnabled === 'boolean') this.restTimerEnabled = prefs.restTimerEnabled as boolean
            if (typeof prefs.restTimerAutoStart === 'boolean') this.restTimerAutoStart = prefs.restTimerAutoStart as boolean
            if (typeof prefs.appIcon === 'string') this.appIcon = prefs.appIcon as string
            if (prefs.intensityPresets) this.intensityPresets = sanitizeIntensityPresets(prefs.intensityPresets)
            if (prefs.coachProfile) this.coachProfile = sanitizeCoachProfile(prefs.coachProfile)
            const synced = JSON.stringify({
              features: this.features, weightGoal: this.weightGoal,
              experience: this.experience, filters: this.filters,
              prBaselineDate: this.prBaselineDate,
              theme: this.theme, colorMode: this.colorMode,
              weightUnit: this.weightUnit, restTimerEnabled: this.restTimerEnabled,
              restTimerAutoStart: this.restTimerAutoStart, appIcon: this.appIcon,
              intensityPresets: this.intensityPresets,
              coachProfile: this.coachProfile,
            })
            localStorage.setItem(STORAGE_KEY, synced)
            backupToIDB(STORAGE_KEY, synced)
          }
        } catch (err) {
          // Network-layer throw — local-first state stands; record it so the UI
          // can surface a sync-failure indicator instead of degrading silently.
          this.lastSyncError = classifySyncError(err)
        } finally {
          this.syncing = false
        }
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

    setWarmupThreshold(threshold: number) {
      this.filters.warmupThreshold = Math.max(0.5, Math.min(0.95, threshold))
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

    setPRBaselineDate(date: string | null) {
      if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return
      this.prBaselineDate = date
      this._persist()
    },

    startNewTrainingBlock() {
      this.prBaselineDate = localDateKey(new Date())
      this._persist()
    },

    clearPRBaseline() {
      this.prBaselineDate = null
      this._persist()
    },

    setTheme(id: string) {
      this.theme = id
      this._persist()
    },

    setColorMode(mode: string) {
      this.colorMode = mode
      this._persist()
    },

    setWeightUnit(unit: string) {
      this.weightUnit = unit
      this._persist()
    },

    setRestTimer(enabled: boolean) {
      this.restTimerEnabled = enabled
      this._persist()
    },

    setRestTimerAutoStart(autoStart: boolean) {
      this.restTimerAutoStart = autoStart
      this._persist()
    },

    setAppIcon(id: string) {
      this.appIcon = id
      this._persist()
    },

    /** Replace the tappable intensity presets (sanitized: int, [1,100], deduped, sorted, capped). */
    setIntensityPresets(presets: number[]) {
      this.intensityPresets = sanitizeIntensityPresets(presets)
      this._persist()
    },

    /** Replace the AI Coach athlete profile (sanitized + versioned). Syncs in the blob (#931). */
    setCoachProfile(profile: Partial<CoachProfile>) {
      this.coachProfile = sanitizeCoachProfile({ ...this.coachProfile, ...profile })
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
