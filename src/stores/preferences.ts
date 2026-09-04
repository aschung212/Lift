import { defineStore } from 'pinia'
import { supabase } from '../lib/supabase'
import type { Json } from '../lib/database.types'
import { syncQueue } from '../lib/syncQueue'
import { logError } from '../lib/logger'
import { reportFetchError } from '../lib/fetchErrorClassifier'
import { persistStoreData, loadStoreData } from '../lib/storePersistence'
import { isPlainObject } from '../lib/storage'
import { sanitizeIntensityPresets, DEFAULT_INTENSITY_PRESETS } from '../lib/intensityTable'
import {
  sanitizeStrengthBaselineMode,
  sanitizeRecentBaselineWeeks,
  DEFAULT_STRENGTH_BASELINE_MODE,
  DEFAULT_RECENT_BASELINE_WEEKS,
  type StrengthBaselineMode,
} from '../lib/strengthBaseline'
import { sanitizeCoachProfile, DEFAULT_COACH_PROFILE, type CoachProfile } from '../lib/coachProfile'
import { sanitizeGymList, sanitizeGymName, MAX_GYMS } from '../lib/gyms'
import { localDateKey } from '../lib/dates'
import { classifySyncError, markSynced, type SyncErrorKind } from '../lib/syncStatus'
import { useWorkoutStore } from './workout'

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

/**
 * Pure-defaults state factory, shared by the store definition and $reset so
 * the sign-out wipe can't drift from the initial shape when a field is added.
 */
function initialPreferencesState() {
  return {
    features: { ...DEFAULTS } as FeatureFlags,
    weightGoal: { ...DEFAULT_WEIGHT_GOAL } as WeightGoalConfig,
    experience: { ...DEFAULT_EXPERIENCE } as ExperienceFlags,
    filters: { ...DEFAULT_FILTERS } as FilterSettings,
    prBaselineDate: null as string | null,
    /**
     * What "your best" is measured against (#1272): the lifetime peak (plus any
     * manual `prBaselineDate` anchor) or a rolling recent window. Resolved into
     * a single day key by `resolveStrengthBaseline`.
     */
    strengthBaselineMode: DEFAULT_STRENGTH_BASELINE_MODE as StrengthBaselineMode,
    /** Length of the recent-mode trailing window, in weeks. */
    recentBaselineWeeks: DEFAULT_RECENT_BASELINE_WEEKS,
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
    /** Gym names for per-gym exercise filtering (#961). Synced in the blob. */
    gyms: [] as string[],
    _userId: null as string | null,
    // Uniform sync-status contract (LIFT-820): observable by the UI.
    syncing: false,
    lastSyncError: null as SyncErrorKind | null,
  }
}

type PreferencesState = ReturnType<typeof initialPreferencesState>

/**
 * Parse the persisted local settings blob (plus the legacy standalone keys)
 * into a partial state overlay applied at store INSTANTIATION (LIFT-1177).
 *
 * The store is the single source of truth for appearance/behavior settings —
 * `useTheme`/`useWeightUnit`/`useRestTimer` read it via computeds — so it must
 * hold the user's real values the instant it is first touched, for EVERY path:
 * a signed-in user (before init() resolves), a local-only guest (who never
 * calls init()), and the pre-login auth screen. Mirrors bodyweight/workout,
 * which likewise hydrate in their state factory. Fails safe to defaults on
 * corrupt/unavailable storage — never throws into store construction.
 */
function loadLocalSettings(): Partial<PreferencesState> {
  const out: Partial<PreferencesState> = {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed.features) out.features = { ...DEFAULTS, ...parsed.features }
      if (parsed.weightGoal) out.weightGoal = _migrateWeightGoal(parsed.weightGoal)
      if (parsed.experience) out.experience = { ...DEFAULT_EXPERIENCE, ...parsed.experience }
      if (parsed.filters) out.filters = { ...DEFAULT_FILTERS, ...parsed.filters }
      if (typeof parsed.prBaselineDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.prBaselineDate)) out.prBaselineDate = parsed.prBaselineDate
      if (parsed.strengthBaselineMode !== undefined) out.strengthBaselineMode = sanitizeStrengthBaselineMode(parsed.strengthBaselineMode)
      if (parsed.recentBaselineWeeks !== undefined) out.recentBaselineWeeks = sanitizeRecentBaselineWeeks(parsed.recentBaselineWeeks)
      if (typeof parsed.theme === 'string') out.theme = parsed.theme
      if (typeof parsed.colorMode === 'string') out.colorMode = parsed.colorMode
      if (typeof parsed.weightUnit === 'string') out.weightUnit = parsed.weightUnit
      if (typeof parsed.restTimerEnabled === 'boolean') out.restTimerEnabled = parsed.restTimerEnabled
      if (typeof parsed.restTimerAutoStart === 'boolean') out.restTimerAutoStart = parsed.restTimerAutoStart
      if (typeof parsed.appIcon === 'string') out.appIcon = parsed.appIcon
      if (parsed.intensityPresets) out.intensityPresets = sanitizeIntensityPresets(parsed.intensityPresets)
      if (parsed.coachProfile) out.coachProfile = sanitizeCoachProfile(parsed.coachProfile)
      if (parsed.gyms) out.gyms = sanitizeGymList(parsed.gyms)
    }
    // Legacy standalone keys (pre-preferences-store) as a fallback when the blob
    // lacks them — so a guest who never logs in still gets their persisted
    // appearance settings. init() performs the same fallback with a write-back;
    // here we only read (no migration side effects in the state factory).
    if (out.theme === undefined) {
      const legacy = localStorage.getItem('app-theme')
      if (legacy && legacy !== 'eternal') out.theme = legacy
    }
    if (out.colorMode === undefined) {
      const legacy = localStorage.getItem('app-mode')
      if (legacy && legacy !== 'dark') out.colorMode = legacy
    }
    if (out.weightUnit === undefined) {
      const legacy = localStorage.getItem('weight-unit')
      if (legacy && legacy !== 'lbs') out.weightUnit = legacy
    }
    if (out.restTimerEnabled === undefined && localStorage.getItem('rest-timer') === 'off') out.restTimerEnabled = false
    if (out.restTimerAutoStart === undefined && localStorage.getItem('rest-timer-autostart') === 'off') out.restTimerAutoStart = false
  } catch { /* corrupt / unavailable storage → defaults */ }
  return out
}

export const usePreferencesStore = defineStore('preferences', {
  state: (): PreferencesState => ({ ...initialPreferencesState(), ...loadLocalSettings() }),

  actions: {
    /**
     * The one definition of the persisted preferences payload (LIFT-1243).
     *
     * localStorage, the IndexedDB mirror and the Supabase `preferences` JSONB
     * column all carry this exact shape, and `init()` re-persists it after
     * adopting a remote row — so the literal must exist once. It previously
     * existed twice (here and inline in `init()`); the copies were byte-identical
     * by luck, and adding a synced preference meant remembering both. Forgetting
     * the `init()` copy silently dropped the field from localStorage on any
     * launch where the remote row was adopted, invisible until the next cold
     * start read it back as its default. This is the write-side twin of
     * `_applyPreferences`, the single read-side reconciliation point (LIFT-1178).
     */
    _buildPayload() {
      return {
        features: this.features,
        weightGoal: this.weightGoal,
        experience: this.experience,
        filters: this.filters,
        prBaselineDate: this.prBaselineDate,
        strengthBaselineMode: this.strengthBaselineMode,
        recentBaselineWeeks: this.recentBaselineWeeks,
        theme: this.theme,
        colorMode: this.colorMode,
        weightUnit: this.weightUnit,
        restTimerEnabled: this.restTimerEnabled,
        restTimerAutoStart: this.restTimerAutoStart,
        appIcon: this.appIcon,
        intensityPresets: this.intensityPresets,
        coachProfile: this.coachProfile,
        gyms: this.gyms,
      }
    },

    /**
     * Write the current payload to every LOCAL sink — the primary localStorage
     * key, the IndexedDB mirror, the cross-tab broadcast, and the standalone FOUC
     * mirror keys — without enqueueing a remote upsert.
     *
     * Split out of `_persist` so `init()` can re-persist an adopted remote row
     * locally without writing the just-fetched value straight back to the server
     * (a launch-time upsert would also open a window to clobber a change another
     * device made between our fetch and our flush). Returns the serialized
     * payload so `_persist` can reuse it for the upsert.
     */
    _persistLocal() {
      const payload = this._buildPayload()
      persistStoreData('preferences', STORAGE_KEY, JSON.stringify(payload))
      // Write individual keys so initTheme() can read them before Pinia for
      // FOUC prevention on the next page load. These are preferences-specific
      // mirror keys, not part of the shared primary-payload plumbing.
      try {
        localStorage.setItem('app-theme', this.theme)
        localStorage.setItem('app-mode', this.colorMode)
        localStorage.setItem('weight-unit', this.weightUnit)
        localStorage.setItem('rest-timer', this.restTimerEnabled ? 'on' : 'off')
        localStorage.setItem('rest-timer-autostart', this.restTimerAutoStart ? 'on' : 'off')
      } catch (e) {
        logError(e, { source: 'preferences._persist:fouc' })
      }
      return payload
    },

    _persist() {
      const payload = this._persistLocal()
      if (supabase && this._userId) {
        const userId = this._userId
        // Journaled to IndexedDB alongside the closure (LIFT-1239) so a settings
        // change made offline is replayed on the next launch instead of being
        // dropped when the tab closes before the flush. Preferences are a
        // last-write-wins blob with NO reconciliation pass, so the queue was the
        // only thing standing between an unflushed change and permanent loss.
        //
        // Replay keeps this exact key, so any write made after the relaunch
        // supersedes it. It is NOT superseded by init()'s remote adoption,
        // which writes localStorage directly rather than going through
        // _persist(): a user who changes a setting offline therefore sees it
        // revert once (init lets the remote row win) and return on the launch
        // after, once the replayed write has reached the server. That flap is
        // the price of the store's remote-wins-on-init rule, and it converges
        // on the user's most recent intent — which is the outcome the old
        // in-memory-only behavior discarded outright.
        const row = {
          user_id: userId,
          // The payload is a closed object of app-owned settings; `Json` is the
          // generated column type and can't express that shape structurally.
          preferences: { ...payload } as unknown as Json,
          updated_at: new Date().toISOString(),
        }
        syncQueue.enqueue(
          `preferences:${userId}`,
          () => supabase!
            .from('user_preferences')
            .upsert(row, { onConflict: 'user_id' }),
          { op: 'upsert', table: 'user_preferences', row },
        )
      }
    },

    /**
     * Apply a parsed preferences payload (from localStorage or Supabase) onto
     * state. Every field is independently conditional, so a partial payload
     * only overrides the keys it actually carries. Extracted (LIFT-1178) as the
     * single reconciliation point for all three read paths — the localStorage
     * hydrate (`init`), the cross-tab reload (`_reloadFromStorage`), and the
     * Supabase override (`init`) — so they can't drift field-by-field. That
     * drift had already happened: `_reloadFromStorage` silently dropped
     * `prBaselineDate`, so a baseline-date change made in one tab never reached
     * the others.
     */
    _applyPreferences(parsed: Record<string, unknown>) {
      if (parsed.features) this.features = { ...DEFAULTS, ...(parsed.features as Record<string, boolean>) }
      if (parsed.weightGoal) this.weightGoal = _migrateWeightGoal(parsed.weightGoal)
      if (parsed.experience) this.experience = { ...DEFAULT_EXPERIENCE, ...(parsed.experience as Partial<ExperienceFlags>) }
      if (parsed.filters) this.filters = { ...DEFAULT_FILTERS, ...(parsed.filters as Partial<FilterSettings>) }
      if (typeof parsed.prBaselineDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.prBaselineDate)) {
        this.prBaselineDate = parsed.prBaselineDate
      } else if ('prBaselineDate' in parsed && parsed.prBaselineDate === null) {
        this.prBaselineDate = null
      }
      if (parsed.strengthBaselineMode !== undefined) this.strengthBaselineMode = sanitizeStrengthBaselineMode(parsed.strengthBaselineMode)
      if (parsed.recentBaselineWeeks !== undefined) this.recentBaselineWeeks = sanitizeRecentBaselineWeeks(parsed.recentBaselineWeeks)
      if (typeof parsed.theme === 'string') this.theme = parsed.theme
      if (typeof parsed.colorMode === 'string') this.colorMode = parsed.colorMode
      if (typeof parsed.weightUnit === 'string') this.weightUnit = parsed.weightUnit
      if (typeof parsed.restTimerEnabled === 'boolean') this.restTimerEnabled = parsed.restTimerEnabled
      if (typeof parsed.restTimerAutoStart === 'boolean') this.restTimerAutoStart = parsed.restTimerAutoStart
      if (typeof parsed.appIcon === 'string') this.appIcon = parsed.appIcon
      if (parsed.intensityPresets) this.intensityPresets = sanitizeIntensityPresets(parsed.intensityPresets)
      if (parsed.coachProfile) this.coachProfile = sanitizeCoachProfile(parsed.coachProfile)
      if (parsed.gyms) this.gyms = sanitizeGymList(parsed.gyms)
    },

    /** Re-read state from localStorage (called by cross-tab sync listener). */
    _reloadFromStorage() {
      const parsed = loadStoreData<Record<string, unknown> | null>(
        'preferences', STORAGE_KEY, () => null, isPlainObject,
      )
      if (parsed) this._applyPreferences(parsed)
    },

    /**
     * Sign-out wipe (called by useAuth.resetStores). The state() factory is
     * already pure defaults, but Pinia's built-in $reset leaves the persisted
     * `user-preferences` payload behind — and init() "loads from localStorage
     * first", so the NEXT account to sign in on this device would inherit the
     * previous user's coach profile (sex/age/injuries), gyms, and settings,
     * then sync them into its own row on the first _persist(). Reset to
     * defaults AND persist the cleared payload. The assign nulls `_userId`
     * before _persist runs, so no upsert is enqueued against the just-ended
     * session (the FOUC mirror keys are rewritten to defaults by the same
     * _persist call).
     */
    $reset() {
      this.$patch(($state) => {
        Object.assign($state, initialPreferencesState())
      })
      this._persist()
    },

    async init(userId: string) {
      this._userId = userId

      // Load from localStorage first (instant), through the same guarded read
      // + single apply point as the cross-tab reload path.
      const local = loadStoreData<Record<string, unknown> | null>(
        'preferences', STORAGE_KEY, () => null, isPlainObject,
      )
      if (local) this._applyPreferences(local)

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
      await this._fetchFromSupabase()
    },

    /**
     * Read this user's synced preferences and apply them over local state.
     *
     * Extracted from `init()` (LIFT-1226) so a recovered connection / session
     * can re-run JUST the remote read without repeating the one-time
     * localStorage migrations above. Mirrors the other three stores' method of
     * the same name — swallows its own failures into `lastSyncError` so a
     * caller's Promise.allSettled can never be aborted by it.
     */
    async _fetchFromSupabase() {
      if (supabase && this._userId) {
        const userId = this._userId
        this.syncing = true
        try {
          const { data, error } = await supabase
            .from('user_preferences')
            .select('preferences')
            .eq('user_id', userId)
            .single()
          // PGRST116 = no row yet (new user / table empty): expected, stay quiet.
          // A real error (network/auth/RLS) is classified for the per-store sync
          // indicator (LIFT-820) and routed through reportFetchError so an RLS or
          // auth regression is observable instead of silently swallowed (LIFT-786).
          if (error && error.code !== 'PGRST116') {
            reportFetchError('preferences', error)
            this.lastSyncError = classifySyncError(error)
          } else {
            this.lastSyncError = null
            // Includes PGRST116 (no row yet): the server answered, which is
            // exactly what "last synced" reports (LIFT-1323).
            markSynced()
          }
          const prefs = data?.preferences as Record<string, unknown> | null
          if (prefs?.features) {
            this._applyPreferences(prefs)
            // Route the local write through the single persist path (LIFT-1243)
            // rather than hand-building a second copy of the payload. Besides
            // removing the drift hazard this restores three side effects the
            // inline write skipped: the FOUC mirror keys (so a remote theme
            // adopted here no longer flashes the *previous* theme on every
            // subsequent cold start, since main.ts's pre-Pinia bootstrap reads
            // `app-theme`), the cross-tab broadcast, and the guarded
            // localStorage write — an unguarded quota failure here would have
            // been caught below and misreported as a preferences FETCH error.
            this._persistLocal()
          }
        } catch (err) {
          // Thrown (vs returned) error — typically a network failure. Route
          // through reportFetchError so offline stays quiet but auth/server
          // failures are observable (LIFT-786), and record the per-store sync
          // indicator so the UI can degrade visibly instead of silently (LIFT-820).
          reportFetchError('preferences', err)
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

    /**
     * Switch what "your best" is measured against (#1272). Only future set
     * evaluations and on-the-fly badges change — awarded XP is never recomputed.
     */
    setStrengthBaselineMode(mode: StrengthBaselineMode) {
      this.strengthBaselineMode = sanitizeStrengthBaselineMode(mode)
      this._persist()
    },

    /** Set the recent-mode trailing window length, in weeks (clamped). */
    setRecentBaselineWeeks(weeks: number) {
      this.recentBaselineWeeks = sanitizeRecentBaselineWeeks(weeks)
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
      const previous = this.weightUnit
      this.weightUnit = unit
      this._persist()
      // Stored per-exercise bar weights are kept in the display unit (LIFT-1223),
      // so a real unit toggle must convert them or the raw number is silently
      // reinterpreted (a 20 kg bar becomes 20 lbs) and corrupts the plate math.
      if (
        previous !== unit &&
        (previous === 'lbs' || previous === 'kg') &&
        (unit === 'lbs' || unit === 'kg')
      ) {
        useWorkoutStore().convertBarWeightsForUnitChange(previous, unit)
      }
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

    /** Replace the gym list (sanitized: trimmed, deduped, capped at MAX_GYMS) (#961). */
    setGyms(gyms: string[]) {
      this.gyms = sanitizeGymList(gyms)
      this._persist()
    },

    /** Add a gym; returns the stored name, or null when invalid/duplicate/over cap. */
    addGym(name: string): string | null {
      const gym = sanitizeGymName(name)
      if (!gym || this.gyms.includes(gym) || this.gyms.length >= MAX_GYMS) return null
      this.gyms = [...this.gyms, gym]
      this._persist()
      return gym
    },

    /**
     * Rename a gym in the list; returns the stored name, or null when the
     * source is missing or the target invalid/taken. Exercise membership is
     * rewritten by the workout store (useGymActions orchestrates both).
     */
    renameGym(oldName: string, newName: string): string | null {
      const gym = sanitizeGymName(newName)
      const idx = this.gyms.indexOf(oldName)
      if (!gym || idx === -1) return null
      if (gym === oldName) return gym
      if (this.gyms.includes(gym)) return null
      const next = [...this.gyms]
      next[idx] = gym
      this.gyms = next
      this._persist()
      return gym
    },

    /** Remove a gym from the list. Exercise membership cleanup is the caller's job. */
    removeGym(name: string) {
      if (!this.gyms.includes(name)) return
      this.gyms = this.gyms.filter(g => g !== name)
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
