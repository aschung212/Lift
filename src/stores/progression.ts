import { reactive } from 'vue'
import { defineStore } from 'pinia'
import { supabase } from '../lib/supabase'
import { syncQueue } from '../lib/syncQueue'
import { logWeeklySnapshot } from '../lib/xpInstrumentation'
import type { ThemeId } from '../composables/useTheme'
import type { StreakHistoryEntry } from '../lib/xp'
import type { WorkoutSet } from './workout'
import { XP_CONFIG } from '../lib/xp'

const STORAGE_KEY = 'user-progression'

// --- Types ---

export interface StreakWeekEntry extends StreakHistoryEntry {
  combinedMultiplier: number
}

// Transient toast state (not persisted, reactive for template binding)
export const xpToast = reactive({
  visible: false,
  text: '',
  progressPercent: 0,
  totalXP: 0,
  nextThresholdXP: null as number | null,
  _timer: null as ReturnType<typeof setTimeout> | null,
})

export function showXPToast(text: string, progressPercent: number, totalXP: number, nextThresholdXP: number | null) {
  xpToast.text = text
  xpToast.progressPercent = progressPercent
  xpToast.totalXP = totalXP
  xpToast.nextThresholdXP = nextThresholdXP
  xpToast.visible = true
  if (xpToast._timer) clearTimeout(xpToast._timer)
  xpToast._timer = setTimeout(() => { xpToast.visible = false }, 4000)
}

export interface ProgressionState {
  totalXP: number
  streakWeeks: number
  weeklyTarget: number                // 1-7, user-set
  pendingTargetChange: number | null   // staged change, takes effect next Monday
  showProgression: boolean             // verbose vs quiet mode
  progressionEnabled: boolean          // explicit flag: has user activated progression?
  unlockedThemes: ThemeId[]
  starterTheme: ThemeId | null
  streakHistory: StreakWeekEntry[]     // append-only
  xpPerSet: Record<string, number>    // setId → XP earned
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
  { level: 5, xpRequired: 150_000, themeId: 'love' },
  { level: 6, xpRequired: 300_000, themeId: 'earth' },
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
    unlockedThemes: ['pearl'],
    starterTheme: null,
    streakHistory: [],
    xpPerSet: {},
    bodyweightXPDates: [],
  }
}

function load(): ProgressionState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultState()
    return { ...defaultState(), ...JSON.parse(raw) }
  } catch {
    return defaultState()
  }
}

// --- Store ---

export const useProgressionStore = defineStore('progression', {
  state: (): ProgressionState & { _userId: string | null } => ({
    ...load(),
    _userId: null,
  }),

  actions: {
    _persist() {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { _userId: _omit, ...state } = this.$state
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    },

    async init(userId: string) {
      this._userId = userId
      await this._fetchFromSupabase()
    },

    async _fetchFromSupabase() {
      if (!supabase || !this._userId) return

      const { data } = await supabase
        .from('user_progression')
        .select('*')
        .eq('user_id', this._userId)
        .single()

      if (!data) return

      // Merge remote state — remote wins for simple fields
      this.totalXP = (data.total_xp as number) ?? this.totalXP
      this.streakWeeks = (data.streak_weeks as number) ?? this.streakWeeks
      this.weeklyTarget = (data.weekly_target as number) ?? this.weeklyTarget
      this.pendingTargetChange = (data.pending_target_change as number | null) ?? this.pendingTargetChange
      this.showProgression = (data.show_progression as boolean) ?? this.showProgression
      this.unlockedThemes = (data.unlocked_themes as ThemeId[]) ?? this.unlockedThemes
      this.starterTheme = (data.starter_theme as ThemeId | null) ?? this.starterTheme
      this.streakHistory = (data.streak_history as StreakWeekEntry[]) ?? this.streakHistory
      this.xpPerSet = (data.xp_per_set as Record<string, number>) ?? this.xpPerSet
      this.bodyweightXPDates = (data.bodyweight_xp_dates as string[]) ?? this.bodyweightXPDates
      this._persist()
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
        unlocked_themes: this.unlockedThemes,
        starter_theme: this.starterTheme,
        streak_history: this.streakHistory,
        xp_per_set: this.xpPerSet,
        bodyweight_xp_dates: this.bodyweightXPDates,
      }
      syncQueue.enqueue('progression-sync', () =>
        supabase!.from('user_progression').upsert(payload)
      )
    },

    // --- XP Actions ---

    logSetXP(setId: string, xp: number) {
      this.xpPerSet[setId] = xp
      this.totalXP += xp
      this._persist()
      this._syncToSupabase()
    },

    removeSetXP(setId: string) {
      // XP is permanent — total doesn't decrease.
      // We just remove tracking so recalc doesn't double-count.
      delete this.xpPerSet[setId]
      this._persist()
      this._syncToSupabase()
    },

    recalcSetXP(setId: string, newXP: number) {
      const oldXP = this.xpPerSet[setId] ?? 0
      const diff = newXP - oldXP
      // XP is permanent: only increase, never decrease total
      if (diff > 0) {
        this.totalXP += diff
      }
      this.xpPerSet[setId] = newXP
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
      if (clamped === this.weeklyTarget) return

      // Stage the change — takes effect next Monday
      this.pendingTargetChange = clamped
      this._persist()
      this._syncToSupabase()
    },

    revertTargetChange() {
      this.pendingTargetChange = null
      this._persist()
      this._syncToSupabase()
    },

    /**
     * Evaluate the completed week. Called at week boundary (Monday).
     * @param daysTrainedThisWeek - number of unique training days in the completed week
     * @param weekStart - ISO date string of the Monday being evaluated
     */
    evaluateWeek(daysTrainedThisWeek: number, weekStart: string) {
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
        this.weeklyTarget = this.pendingTargetChange
        this.pendingTargetChange = null
        // Target change resets streak
        this.streakWeeks = metTarget ? 1 : 0
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
        weekXP: 0, // TODO: compute from xpPerSet entries in this week
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
     * @param allSets - flat array of all workout sets across all exercises
     * @param now - current date (injectable for testing)
     */
    evaluatePendingWeeks(allSets: WorkoutSet[], now: Date = new Date()) {
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
        const earliest = allSets.reduce<string | null>((min, s) => {
          return min === null || s.date < min ? s.date : min
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

        const days = getTrainingDaysInWeek(allSets, weekStart, weekEnd)
        this.evaluateWeek(days, weekStart)

        evalMonday.setUTCDate(evalMonday.getUTCDate() + 7)
      }
    },

    // --- Theme Actions ---

    checkUnlocks() {
      const STARTER_IDS: ThemeId[] = ['fire', 'water', 'luck']
      let newUnlocks = false

      for (const tier of UNLOCK_TIERS) {
        if (this.totalXP < tier.xpRequired) break

        if (tier.themeId) {
          // Named theme tier
          if (!this.unlockedThemes.includes(tier.themeId)) {
            this.unlockedThemes.push(tier.themeId)
            newUnlocks = true
          }
        } else if (tier.level === 1) {
          // Starter pick slot
          if (this.starterTheme && !this.unlockedThemes.includes(this.starterTheme)) {
            this.unlockedThemes.push(this.starterTheme)
            newUnlocks = true
          }
        } else {
          // Unchosen starter slot (level 7) — unlock all starters not yet unlocked
          for (const sid of STARTER_IDS) {
            if (!this.unlockedThemes.includes(sid)) {
              this.unlockedThemes.push(sid)
              newUnlocks = true
            }
          }
        }
      }

      if (newUnlocks) {
        this._persist()
        this._syncToSupabase()
      }

      return newUnlocks
    },

    setStarterTheme(themeId: ThemeId) {
      if (this.starterTheme !== null) return // one-time only
      this.starterTheme = themeId
      this.progressionEnabled = true
      if (!this.unlockedThemes.includes(themeId)) {
        this.unlockedThemes.push(themeId)
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
  },
})

// --- Module-level helpers ---

/**
 * Count unique training days in a Mon-Sun week.
 * Exported for testing; used by evaluatePendingWeeks.
 */
export function getTrainingDaysInWeek(
  sets: WorkoutSet[],
  weekStartDate: string,  // YYYY-MM-DD (Monday)
  weekEndDate: string,    // YYYY-MM-DD (Sunday)
): number {
  const days = new Set<string>()
  for (const set of sets) {
    const dateKey = set.date.slice(0, 10)
    if (dateKey >= weekStartDate && dateKey <= weekEndDate) {
      days.add(dateKey)
    }
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
