import { defineStore } from 'pinia'
import { supabase } from '../lib/supabase'
import { syncQueue } from '../lib/syncQueue'
import type { Tables, Json } from '../lib/database.types'
import { logWeeklySnapshot } from '../lib/xpInstrumentation'
import type { ThemeId } from '../lib/themes'
import type { StreakHistoryEntry } from '../lib/xp'
import { XP_CONFIG } from '../lib/xp'
import { isPlainObject } from '../lib/storage'
import { persistStoreData, loadStoreData } from '../lib/storePersistence'
import { reportFetchError } from '../lib/fetchErrorClassifier'
import { isAuthError, ensureFreshSession } from '../lib/sessionHealth'
import { classifySyncError, type SyncErrorKind } from '../lib/syncStatus'
import {
  themeUnlocksToJson,
  streakHistoryToJson,
  xpPerSetToJson,
  bodyweightDatesToJson,
  parseStreakHistory,
  parseUnlockedThemes,
  parseXpPerSet,
  parseBodyweightDates,
} from '../lib/jsonColumns'

const STORAGE_KEY = 'user-progression'

// --- Types ---

export interface StreakWeekEntry extends StreakHistoryEntry {
  combinedMultiplier: number
}

export interface ThemeUnlock {
  id: ThemeId
  unlockedAt: string            // ISO timestamp
  totalXPAtUnlock?: number      // snapshot for share cards
  totalSetsAtUnlock?: number    // snapshot for share cards
}

export interface SetXPEntry {
  xp: number
  theme: string
  epoch: number
  zone: string
  isPR: boolean
  isRepPR: boolean
}

export interface ProgressionState {
  totalXP: number
  streakWeeks: number
  weeklyTarget: number                // 1-7, user-set
  pendingTargetChange: number | null   // staged change, takes effect next Monday
  showProgression: boolean             // verbose vs quiet mode
  progressionEnabled: boolean          // explicit flag: has user activated progression?
  epoch: number                        // progression epoch (increments on reset, enables prestige)
  unlockedThemes: ThemeUnlock[]        // themes with unlock timestamps
  starterTheme: ThemeId | null
  starterConfirmed: boolean            // false = trial period, all starters unlocked
  streakHistory: StreakWeekEntry[]     // append-only
  xpPerSet: Record<string, SetXPEntry | number>  // setId → XP data (number = legacy format)
  bodyweightXPDates: string[]         // dates that earned bodyweight XP
}

// --- Unlock Thresholds (placeholder — tune with real data) ---

export interface UnlockTier {
  level: number
  xpRequired: number
  themeId: ThemeId | null  // null = starter pick slot
}

export const UNLOCK_TIERS: UnlockTier[] = [
  { level: 0, xpRequired: 0, themeId: 'pearl' },
  { level: 1, xpRequired: 5_000, themeId: null },     // starter pick fills this
  { level: 2, xpRequired: 15_000, themeId: 'air' },
  { level: 3, xpRequired: 40_000, themeId: 'amethyst' },
  { level: 4, xpRequired: 80_000, themeId: 'midnight' },
  { level: 5, xpRequired: 150_000, themeId: 'earth' },
  { level: 6, xpRequired: 300_000, themeId: 'love' },
  { level: 7, xpRequired: 500_000, themeId: null },    // remaining starter themes fill these
  { level: 8, xpRequired: 1_000_000, themeId: 'eternal' },
]

// --- Helpers ---

function defaultState(): ProgressionState {
  return {
    totalXP: 0,
    streakWeeks: 0,
    weeklyTarget: 3,
    pendingTargetChange: null,
    showProgression: true,
    progressionEnabled: false,
    epoch: 1,
    unlockedThemes: [{ id: 'pearl', unlockedAt: new Date().toISOString() }],
    starterTheme: null,
    starterConfirmed: false,
    streakHistory: [],
    xpPerSet: {},
    bodyweightXPDates: [],
  }
}

/** Get the XP value from a set entry (handles legacy number format). */
export function getSetXP(entry: SetXPEntry | number): number {
  return typeof entry === 'number' ? entry : entry.xp
}

/** Check if a theme is in the unlocked list. */
function hasTheme(themes: ThemeUnlock[], id: ThemeId): boolean {
  return themes.some(t => t.id === id)
}

/** Add a theme to the unlocked list with current timestamp and stats snapshot. */
function addTheme(themes: ThemeUnlock[], id: ThemeId, totalXP = 0, totalSets = 0): void {
  if (!hasTheme(themes, id)) {
    themes.push({ id, unlockedAt: new Date().toISOString(), totalXPAtUnlock: totalXP, totalSetsAtUnlock: totalSets })
  }
}

/** Get just the theme IDs from the unlock list. */
export function getUnlockedThemeIds(themes: ThemeUnlock[]): ThemeId[] {
  return themes.map(t => t.id)
}

/** Merge two xpPerSet maps: union of keys, higher XP wins on conflict. */
export function mergeXpPerSet(
  local: Record<string, SetXPEntry | number>,
  remote: Record<string, SetXPEntry | number>,
): Record<string, SetXPEntry | number> {
  const merged = { ...local }
  for (const [id, remoteEntry] of Object.entries(remote)) {
    const localEntry = merged[id]
    if (!localEntry) {
      merged[id] = remoteEntry
    } else if (getSetXP(remoteEntry) > getSetXP(localEntry)) {
      merged[id] = remoteEntry
    }
  }
  return merged
}

/** Merge two unlocked theme lists: union by theme ID, keep earliest unlock. */
export function mergeUnlockedThemes(local: ThemeUnlock[], remote: ThemeUnlock[]): ThemeUnlock[] {
  const byId = new Map<string, ThemeUnlock>()
  for (const t of local) byId.set(t.id, t)
  for (const t of remote) {
    const existing = byId.get(t.id)
    if (!existing || (t.unlockedAt && (!existing.unlockedAt || t.unlockedAt < existing.unlockedAt))) {
      byId.set(t.id, t)
    }
  }
  return Array.from(byId.values())
}

/** Merge two bodyweight XP date lists: union of unique dates. */
export function mergeBodyweightDates(local: string[], remote: string[]): string[] {
  return [...new Set([...local, ...remote])].sort()
}

/** Recalculate totalXP from xpPerSet + bodyweight dates. */
function recalcTotalXP(xpPerSet: Record<string, SetXPEntry | number>, bodyweightDates: string[], bodyweightXPPerDay: number): number {
  let total = 0
  for (const entry of Object.values(xpPerSet)) {
    total += getSetXP(entry)
  }
  total += bodyweightDates.length * bodyweightXPPerDay
  return total
}

/**
 * Migration: convert old ThemeId[] format to ThemeUnlock[] (LIFT-946).
 *
 * Delegates element-level validation to `parseUnlockedThemes` (the same guard
 * the Supabase-JSON path uses) so the localStorage boundary doesn't invent a
 * weaker second check — it validates every entry's id/unlockedAt, not just the
 * first, and still handles the legacy string[] format. Falls back to the default
 * starter (pearl) when the value is absent, empty, or fully malformed.
 */
function migrateUnlockedThemes(themes: unknown): ThemeUnlock[] {
  return parseUnlockedThemes(themes as Json) ?? [{ id: 'pearl', unlockedAt: new Date().toISOString() }]
}

function load(): ProgressionState {
  // The shared helper owns the read/parse/corrupt-fallback plumbing; the
  // merge-with-defaults and migration logic below is store-specific.
  const stored = loadStoreData<Record<string, unknown>>(
    'progression',
    STORAGE_KEY,
    () => ({}),
    isPlainObject,
  )
  const parsed = { ...defaultState(), ...stored } as ProgressionState
  parsed.unlockedThemes = migrateUnlockedThemes(parsed.unlockedThemes)
  // Validate the JSON-blob fields through the same guards the Supabase-JSON path
  // uses (LIFT-946) so a corrupt localStorage entry — a non-numeric xp, a string
  // date — is dropped at the boundary rather than casting straight into XP math.
  parsed.xpPerSet = parseXpPerSet(stored.xpPerSet as Json, {})
  parsed.streakHistory = parseStreakHistory(stored.streakHistory as Json, defaultState().streakHistory)
  parsed.bodyweightXPDates = parseBodyweightDates(stored.bodyweightXPDates as Json, [])
  if (!parsed.epoch) parsed.epoch = 1
  // Defensive: if starter was picked and XP earned, the trial is over.
  // Only infer starterConfirmed — do NOT force progressionEnabled, as the
  // user may have intentionally disabled progression while keeping their data.
  if (parsed.starterTheme && parsed.totalXP > 0) {
    parsed.starterConfirmed = true
  }
  return parsed
}

// --- Store ---

export const useProgressionStore = defineStore('progression', {
  state: (): ProgressionState & { _userId: string | null; syncing: boolean; lastSyncError: SyncErrorKind | null } => ({
    ...load(),
    _userId: null,
    // Uniform sync-status contract (LIFT-820): observable by the UI.
    syncing: false,
    lastSyncError: null,
  }),

  actions: {
    _persist() {
      // Strip tab-local / transient fields — `_userId` is per-tab and the
      // sync-status fields (LIFT-820) must never be persisted or synced.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { _userId: _omit, syncing: _s, lastSyncError: _e, ...state } = this.$state
      persistStoreData('progression', STORAGE_KEY, JSON.stringify(state))
    },

    /** Re-read state from localStorage (called by cross-tab sync listener). */
    _reloadFromStorage() {
      const fresh = load()
      // Preserve _userId — it's tab-local, not persisted
      this.$patch({ ...fresh })
    },

    async init(userId: string) {
      this._userId = userId
      await this._fetchFromSupabase()
    },

    async _fetchFromSupabase() {
      if (!supabase || !this._userId) return

      this.syncing = true
      let data: Tables<'user_progression'> | null
      try {
        // A network-layer failure rejects rather than resolving `{ error }`, so
        // the awaited call must be guarded — an unguarded throw here would
        // propagate through init() and reject the whole Promise.allSettled in
        // initStores, leaving the app half-hydrated (LIFT-820).
        const result = await supabase
          .from('user_progression')
          .select('*')
          .eq('user_id', this._userId)
          .single()
        const error = result.error
        if (error) {
          if (error.code === 'PGRST116') {
            // Row genuinely doesn't exist — push local state to create it.
            // This is not a sync failure; clear any prior error.
            this.lastSyncError = null
            this._syncToSupabase()
          } else {
            // Network/auth/RLS error — route through reportFetchError so an
            // RLS/auth regression is observable instead of silently swallowed
            // (LIFT-786), and record the per-store sync indicator (LIFT-820).
            reportFetchError('progression', error)
            this.lastSyncError = classifySyncError(error)
            // A 401 means an expired token, not offline — refresh once so the
            // next fetch recovers rather than staying local-only (LIFT-784).
            if (isAuthError(error)) void ensureFreshSession()
          }
          return
        }
        data = result.data
      } catch (err) {
        reportFetchError('progression', err)
        this.lastSyncError = classifySyncError(err)
        if (isAuthError(err)) void ensureFreshSession()
        return
      } finally {
        this.syncing = false
      }

      if (!data) return
      this.lastSyncError = null

      // Merge remote state — remote wins for simple scalar fields
      this.streakWeeks = data.streak_weeks ?? this.streakWeeks
      this.weeklyTarget = data.weekly_target ?? this.weeklyTarget
      this.pendingTargetChange = data.pending_target_change ?? this.pendingTargetChange
      this.showProgression = data.show_progression ?? this.showProgression
      this.progressionEnabled = data.progression_enabled ?? this.progressionEnabled
      this.starterTheme = (data.starter_theme as ThemeId | null) ?? this.starterTheme
      this.starterConfirmed = (data.starter_confirmed as boolean) ?? this.starterConfirmed
      this.epoch = (data.epoch as number) ?? this.epoch
      this.streakHistory = parseStreakHistory(data.streak_history, this.streakHistory)

      // Merge collection fields — union strategy, no data loss
      const remoteThemes = parseUnlockedThemes(data.unlocked_themes) ?? migrateUnlockedThemes([])
      this.unlockedThemes = mergeUnlockedThemes(this.unlockedThemes, remoteThemes)

      const remoteXpPerSet = parseXpPerSet(data.xp_per_set, {})
      this.xpPerSet = mergeXpPerSet(this.xpPerSet, remoteXpPerSet)

      const remoteBodyweightDates = parseBodyweightDates(data.bodyweight_xp_dates, [])
      this.bodyweightXPDates = mergeBodyweightDates(this.bodyweightXPDates, remoteBodyweightDates)

      // Recalculate totalXP from merged data — eliminates drift from stale overwrites
      this.totalXP = recalcTotalXP(this.xpPerSet, this.bodyweightXPDates, XP_CONFIG.bodyweightXP)
      // Defensive: if we have a starter theme and XP, the trial is over.
      // Handles rows written before starter_confirmed column existed.
      // Do NOT infer progressionEnabled — user may have disabled it intentionally.
      if (this.starterTheme && this.totalXP > 0) {
        this.starterConfirmed = true
      }
      // Ensure theme unlocks are consistent with merged XP
      this.checkUnlocks()
      this._persist()
      this._syncToSupabase()
    },

    _syncToSupabase() {
      if (!supabase || !this._userId) return
      const userId = this._userId
      const payload = {
        user_id: userId,
        total_xp: this.totalXP,
        streak_weeks: this.streakWeeks,
        weekly_target: this.weeklyTarget,
        pending_target_change: this.pendingTargetChange,
        show_progression: this.showProgression,
        progression_enabled: this.progressionEnabled,
        unlocked_themes: themeUnlocksToJson(this.unlockedThemes),
        starter_theme: this.starterTheme,
        starter_confirmed: this.starterConfirmed,
        epoch: this.epoch,
        streak_history: streakHistoryToJson(this.streakHistory),
        xp_per_set: xpPerSetToJson(this.xpPerSet),
        bodyweight_xp_dates: bodyweightDatesToJson(this.bodyweightXPDates),
      }
      syncQueue.enqueue('progression-sync', () =>
        supabase!.from('user_progression').upsert(payload)
      )
    },

    // --- XP Actions ---

    /** Record XP metadata for a set (always — even without progression). */
    recordSetXP(setId: string, xp: number, meta: { theme: string; epoch: number; zone: string; isPR: boolean; isRepPR: boolean }) {
      this.xpPerSet[setId] = { xp, theme: meta.theme, epoch: meta.epoch, zone: meta.zone, isPR: meta.isPR, isRepPR: meta.isRepPR }
      this._persist()
    },

    /** Credit XP to totalXP and trigger progression effects (only when enabled). */
    creditSetXP(_setId: string, xp: number) {
      this.totalXP += xp
      // Confirm starter on first set logged
      if (!this.starterConfirmed && this.starterTheme) {
        this.starterConfirmed = true
      }
      this._persist()
      this._syncToSupabase()
    },

    /** Legacy compat — record + credit in one call. */
    logSetXP(setId: string, xp: number, meta?: { theme: string; epoch: number; zone: string; isPR: boolean; isRepPR: boolean }) {
      if (meta) {
        this.recordSetXP(setId, xp, meta)
      } else {
        this.xpPerSet[setId] = xp
      }
      this.totalXP += xp
      if (!this.starterConfirmed && this.starterTheme) {
        this.starterConfirmed = true
      }
      this._persist()
      this._syncToSupabase()
    },

    removeSetXP(setId: string) {
      const entry = this.xpPerSet[setId]
      if (entry) {
        const xp = getSetXP(entry)
        this.totalXP = Math.max(0, this.totalXP - xp)
      }
      delete this.xpPerSet[setId]
      this._persist()
      this._syncToSupabase()
    },

    recalcSetXP(setId: string, newXP: number, meta?: { theme: string; epoch: number; zone: string; isPR: boolean; isRepPR: boolean }) {
      const oldEntry = this.xpPerSet[setId]
      const oldXP = oldEntry ? getSetXP(oldEntry) : 0
      const diff = newXP - oldXP
      // XP is permanent: only increase, never decrease total
      if (diff > 0) {
        this.totalXP += diff
      }
      this.xpPerSet[setId] = meta
        ? { xp: newXP, theme: meta.theme, epoch: meta.epoch, zone: meta.zone, isPR: meta.isPR, isRepPR: meta.isRepPR }
        : newXP
      this._persist()
      this._syncToSupabase()
    },

    logBodyweightXP(date: string) {
      const dateKey = date.slice(0, 10)
      if (this.bodyweightXPDates.includes(dateKey)) return
      this.bodyweightXPDates.push(dateKey)
      this.totalXP += XP_CONFIG.bodyweightXP
      this._persist()
      this._syncToSupabase()
    },

    // --- Streak & Target Actions ---

    setWeeklyTarget(days: number) {
      const clamped = Math.max(1, Math.min(7, Math.round(days)))

      // If setting back to the current active target, clear the pending change
      if (clamped === this.weeklyTarget) {
        if (this.pendingTargetChange !== null) {
          this.pendingTargetChange = null
          this._persist()
          this._syncToSupabase()
        }
        return
      }

      // Stage the change — takes effect next Monday
      this.pendingTargetChange = clamped
      this._persist()
      this._syncToSupabase()
    },

    /**
     * Evaluate the completed week. Called at week boundary (Monday).
     * @param daysTrainedThisWeek - number of unique training days in the completed week
     * @param weekStart - ISO date string of the Monday being evaluated
     * @param weekXP - total XP earned from sets in this week (0 if unknown)
     */
    evaluateWeek(daysTrainedThisWeek: number, weekStart: string, weekXP = 0) {
      // Determine the effective target for this week
      // Anti-gaming: if there's a pending change, evaluate against the HIGHER target
      const effectiveTarget = this.pendingTargetChange !== null
        ? Math.max(this.weeklyTarget, this.pendingTargetChange)
        : this.weeklyTarget

      const metTarget = daysTrainedThisWeek >= effectiveTarget

      if (metTarget) {
        this.streakWeeks += 1
      } else {
        this.streakWeeks = 0
      }

      // Apply pending target change (it takes effect this Monday)
      if (this.pendingTargetChange !== null) {
        const isDecrease = this.pendingTargetChange < this.weeklyTarget
        this.weeklyTarget = this.pendingTargetChange
        this.pendingTargetChange = null
        // Only decreasing resets streak — increasing is more ambitious, not gaming
        if (isDecrease) {
          this.streakWeeks = metTarget ? 1 : 0
        }
      }

      // Record streak history entry
      const durationMult = lookupTier(XP_CONFIG.streakDurationTiers, this.streakWeeks)
      const targetMult = lookupTier(XP_CONFIG.streakTargetTiers, this.weeklyTarget)
      const combined = Math.round(durationMult * targetMult * 1000) / 1000

      this.streakHistory.push({
        weekStart: weekStart.slice(0, 10),
        streakCount: this.streakWeeks,
        weeklyTarget: this.weeklyTarget,
        combinedMultiplier: combined,
      })

      // Trim history to ~6 months (26 weeks)
      if (this.streakHistory.length > 26) {
        this.streakHistory = this.streakHistory.slice(-26)
      }

      this._persist()
      this._syncToSupabase()

      // Log weekly snapshot for analytics
      logWeeklySnapshot({
        userId: this._userId,
        weekStart: weekStart.slice(0, 10),
        totalXP: this.totalXP,
        weekXP,
        streakWeeks: this.streakWeeks,
        trainingDays: daysTrainedThisWeek,
        weeklyTarget: this.weeklyTarget,
        themesUnlocked: this.unlockedThemes.length,
      })
    },

    // --- Streak Catch-up ---

    /**
     * Evaluate all weeks that haven't been evaluated since the last recorded week.
     * Called on app startup to catch up if the user hasn't opened the app.
     *
     * @param setDates - flat array of date strings (YYYY-MM-DD) from all workout sets
     * @param now - current date (injectable for testing)
     * @param setIdToDate - optional map of setId → YYYY-MM-DD for computing weekly XP
     */
    evaluatePendingWeeks(setDates: string[], now: Date = new Date(), setIdToDate?: Record<string, string>) {
      const currentMonday = getMonday(now)
      const lastEvaluated = this.streakHistory.length > 0
        ? this.streakHistory[this.streakHistory.length - 1].weekStart
        : null

      // Determine the first Monday we need to evaluate
      let evalMonday: Date
      if (lastEvaluated) {
        // Start from the Monday after the last evaluated week
        evalMonday = new Date(lastEvaluated + 'T00:00:00Z')
        evalMonday.setUTCDate(evalMonday.getUTCDate() + 7)
      } else {
        // No history — find the earliest set's week, or skip if no sets
        const earliest = setDates.reduce<string | null>((min, d) => {
          return min === null || d < min ? d : min
        }, null)
        if (!earliest) return
        evalMonday = getMonday(new Date(earliest))
      }

      // Evaluate each complete week up to (but not including) the current week
      while (evalMonday.getTime() < currentMonday.getTime()) {
        const weekStart = toDateKey(evalMonday)
        const sunday = new Date(evalMonday)
        sunday.setUTCDate(sunday.getUTCDate() + 6)
        const weekEnd = toDateKey(sunday)

        const days = getTrainingDaysInWeek(setDates, weekStart, weekEnd)
        const weekXP = setIdToDate
          ? computeWeekXP(this.xpPerSet, this.bodyweightXPDates, setIdToDate, weekStart, weekEnd)
          : 0
        this.evaluateWeek(days, weekStart, weekXP)

        evalMonday.setUTCDate(evalMonday.getUTCDate() + 7)
      }
    },

    /**
     * Re-evaluate all streak history from scratch using the current weeklyTarget.
     * Use when the target was corrupted (e.g., Supabase restored a stale default).
     */
    reEvaluateStreaks(setDates: string[], now: Date = new Date(), setIdToDate?: Record<string, string>) {
      this.streakHistory = []
      this.streakWeeks = 0
      this.pendingTargetChange = null
      this.evaluatePendingWeeks(setDates, now, setIdToDate)
    },

    // --- Theme Actions ---

    checkUnlocks(): ThemeId[] {
      const STARTER_IDS: ThemeId[] = ['fire', 'water', 'luck']
      const newlyUnlocked: ThemeId[] = []
      const setCount = Object.keys(this.xpPerSet).length

      for (const tier of UNLOCK_TIERS) {
        if (this.totalXP < tier.xpRequired) break

        if (tier.themeId) {
          if (!hasTheme(this.unlockedThemes, tier.themeId)) {
            addTheme(this.unlockedThemes, tier.themeId, this.totalXP, setCount)
            newlyUnlocked.push(tier.themeId)
          }
        } else if (tier.level === 1) {
          if (this.starterTheme && !hasTheme(this.unlockedThemes, this.starterTheme)) {
            addTheme(this.unlockedThemes, this.starterTheme, this.totalXP, setCount)
            newlyUnlocked.push(this.starterTheme)
          }
        } else {
          for (const sid of STARTER_IDS) {
            if (!hasTheme(this.unlockedThemes, sid)) {
              addTheme(this.unlockedThemes, sid, this.totalXP, setCount)
              newlyUnlocked.push(sid)
            }
          }
        }
      }

      if (newlyUnlocked.length > 0) {
        this._persist()
        this._syncToSupabase()
      }

      return newlyUnlocked
    },

    setStarterTheme(themeId: ThemeId, weeklyTarget?: number) {
      if (this.starterTheme !== null) return // one-time only
      this.starterTheme = themeId
      this.progressionEnabled = true
      if (weeklyTarget !== undefined) {
        this.weeklyTarget = weeklyTarget
      }
      if (!hasTheme(this.unlockedThemes, themeId)) {
        addTheme(this.unlockedThemes, themeId)
      }
      this._persist()
      this._syncToSupabase()
    },

    setShowProgression(value: boolean) {
      this.showProgression = value
      this._persist()
      this._syncToSupabase()
    },
  },

  getters: {
    currentLevel: (state): number => {
      let level = 0
      for (const tier of UNLOCK_TIERS) {
        if (state.totalXP >= tier.xpRequired) level = tier.level
        else break
      }
      return level
    },

    nextUnlockThreshold: (state): number | null => {
      for (const tier of UNLOCK_TIERS) {
        if (state.totalXP < tier.xpRequired) return tier.xpRequired
      }
      return null // all unlocked
    },

    xpToNextUnlock: (state): number => {
      let threshold: number | null = null
      for (const tier of UNLOCK_TIERS) {
        if (state.totalXP < tier.xpRequired) { threshold = tier.xpRequired; break }
      }
      if (threshold === null) return 0
      return threshold - state.totalXP
    },

    progressPercent: (state): number => {
      let threshold: number | null = null
      for (const tier of UNLOCK_TIERS) {
        if (state.totalXP < tier.xpRequired) { threshold = tier.xpRequired; break }
      }
      if (threshold === null) return 100

      let prevXP = 0
      for (const tier of UNLOCK_TIERS) {
        if (tier.xpRequired >= threshold) break
        prevXP = tier.xpRequired
      }

      const range = threshold - prevXP
      if (range <= 0) return 100
      const progress = state.totalXP - prevXP
      return Math.min(100, Math.round((progress / range) * 100))
    },

    currentMultiplier: (state): number => {
      if (state.streakWeeks < 1) return 1.0
      const durationMult = lookupTier(XP_CONFIG.streakDurationTiers, state.streakWeeks)
      const targetMult = lookupTier(XP_CONFIG.streakTargetTiers, state.weeklyTarget)
      return Math.round(durationMult * targetMult * 1000) / 1000
    },

    effectiveTarget: (state): number => {
      // During grace period, the pending change hasn't taken effect yet
      return state.weeklyTarget
    },

    /** Count of sets that were PRs (used for first-PR detection). */
    totalPRCount: (state): number => {
      let count = 0
      for (const entry of Object.values(state.xpPerSet)) {
        if (typeof entry === 'object' && entry.isPR) count++
      }
      return count
    },
  },
})

// --- Module-level helpers ---

/**
 * Compute total XP earned in a Mon-Sun week from set XP entries and bodyweight XP.
 * Exported for testing.
 */
export function computeWeekXP(
  xpPerSet: Record<string, SetXPEntry | number>,
  bodyweightXPDates: string[],
  setIdToDate: Record<string, string>,
  weekStart: string,
  weekEnd: string,
): number {
  let total = 0

  // Sum XP from workout sets in this week
  for (const [setId, entry] of Object.entries(xpPerSet)) {
    const date = setIdToDate[setId]
    if (date && date >= weekStart && date <= weekEnd) {
      total += getSetXP(entry)
    }
  }

  // Sum bodyweight XP for dates in this week
  for (const date of bodyweightXPDates) {
    const d = date.slice(0, 10)
    if (d >= weekStart && d <= weekEnd) {
      total += XP_CONFIG.bodyweightXP
    }
  }

  return total
}

/**
 * Count unique training days in a Mon-Sun week.
 * Uses binary search on sorted dates for O(log n + k) instead of O(n).
 * Exported for testing; used by evaluatePendingWeeks.
 *
 * @param sortedDates - YYYY-MM-DD date strings, must be sorted ascending
 */
export function getTrainingDaysInWeek(
  sortedDates: string[],
  weekStartDate: string,  // YYYY-MM-DD (Monday)
  weekEndDate: string,    // YYYY-MM-DD (Sunday)
): number {
  if (sortedDates.length === 0) return 0

  // Binary search for the first date >= weekStartDate
  let lo = 0, hi = sortedDates.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (sortedDates[mid].slice(0, 10) < weekStartDate) lo = mid + 1
    else hi = mid
  }

  // Walk forward counting unique days until we pass weekEndDate
  const days = new Set<string>()
  for (let i = lo; i < sortedDates.length; i++) {
    const dateKey = sortedDates[i].slice(0, 10)
    if (dateKey > weekEndDate) break
    days.add(dateKey)
  }
  return days.size
}

/** Get the Monday of the week containing the given date (UTC). */
function getMonday(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = d.getUTCDay()
  const diff = (day + 6) % 7
  d.setUTCDate(d.getUTCDate() - diff)
  return d
}

/** Format a Date as YYYY-MM-DD (UTC). */
function toDateKey(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function lookupTier(tiers: [number, number][], value: number): number {
  for (const [threshold, multiplier] of tiers) {
    if (value >= threshold) return multiplier
  }
  return 1.0
}
