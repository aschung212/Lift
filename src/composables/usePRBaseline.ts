/**
 * PR baseline — the anchor date against which PRs are evaluated.
 *
 * `prBaselineDate` is the EFFECTIVE baseline day key and the only value PR/XP
 * consumers should read. It is resolved from two stored preferences (#1272):
 *
 *  - `prBaselineAnchor` — the manual date the user picks in Settings, or that
 *    "Start new training block" stamps with today.
 *  - `strengthBaselineMode` — `lifetime` (the anchor as-is) or `recent`
 *    (a rolling `recentBaselineWeeks` window, so a cut is measured against
 *    recent work instead of an out-of-reach peak).
 *
 * See `src/lib/strengthBaseline.ts` for why the modes collapse to one day key
 * rather than a second lookup path. Consumers destructure `prBaselineDate` and
 * get both modes for free; only Settings needs `prBaselineAnchor`.
 *
 * Semantics of the resolved value:
 * - `null` (default) → preserve legacy behavior: display PRs use all-time max,
 *   XP system uses the rolling XP_CONFIG.best1RMWindowMonths window.
 * - ISO date (YYYY-MM-DD) → PRs are evaluated only against sets on or after
 *   that date. Applies to both display badges and future XP evaluation.
 *
 * Ledger invariant: historical `isPR`/`isRepPR` flags stored in the
 * progression store are NEVER rewritten when the baseline changes. XP already
 * awarded stays awarded. The baseline only affects:
 *   1. Future set evaluations (XP + zone detection at log time).
 *   2. Display badges computed on-the-fly (timeline, calendar, graph).
 *
 * Storage: all three fields live in the preferences store, which syncs to
 * Supabase via the user_preferences JSONB column. This ensures the baseline
 * persists across devices.
 */

import { computed, type ComputedRef } from 'vue'
import { usePreferencesStore } from '../stores/preferences'
import { todayISO } from '../lib/dates'
import {
  resolveStrengthBaseline,
  type StrengthBaselineMode,
} from '../lib/strengthBaseline'

export interface UsePRBaselineReturn {
  /**
   * The effective baseline day key — mode-resolved. Every PR/XP consumer
   * (`getExercisePR`, `scoreSet`, the intensity anchor, PR badges) reads this.
   */
  prBaselineDate: ComputedRef<string | null>
  /** The raw stored anchor date, for the Settings date input only. */
  prBaselineAnchor: ComputedRef<string | null>
  strengthBaselineMode: ComputedRef<StrengthBaselineMode>
  recentBaselineWeeks: ComputedRef<number>
  setPRBaseline: (date: string | null) => void
  startNewTrainingBlock: () => void
  clearPRBaseline: () => void
  setStrengthBaselineMode: (mode: StrengthBaselineMode) => void
  setRecentBaselineWeeks: (weeks: number) => void
}

export function usePRBaseline(): UsePRBaselineReturn {
  const prefs = usePreferencesStore()

  const prBaselineAnchor = computed(() => prefs.prBaselineDate)
  const strengthBaselineMode = computed(() => prefs.strengthBaselineMode)
  const recentBaselineWeeks = computed(() => prefs.recentBaselineWeeks)

  // Recomputes when any stored input changes. `todayISO()` is read inside, so a
  // session left open across midnight keeps yesterday's window start until the
  // next preference change — an off-by-one-day boundary on a multi-week window,
  // which is the same staleness every other `todayISO()` call site accepts.
  const prBaselineDate = computed(() =>
    resolveStrengthBaseline({
      mode: prefs.strengthBaselineMode,
      anchor: prefs.prBaselineDate,
      weeks: prefs.recentBaselineWeeks,
      todayKey: todayISO(),
    }),
  )

  function setPRBaseline(date: string | null): void {
    prefs.setPRBaselineDate(date)
  }

  function startNewTrainingBlock(): void {
    prefs.startNewTrainingBlock()
  }

  function clearPRBaseline(): void {
    prefs.clearPRBaseline()
  }

  function setStrengthBaselineMode(mode: StrengthBaselineMode): void {
    prefs.setStrengthBaselineMode(mode)
  }

  function setRecentBaselineWeeks(weeks: number): void {
    prefs.setRecentBaselineWeeks(weeks)
  }

  return {
    prBaselineDate,
    prBaselineAnchor,
    strengthBaselineMode,
    recentBaselineWeeks,
    setPRBaseline,
    startNewTrainingBlock,
    clearPRBaseline,
    setStrengthBaselineMode,
    setRecentBaselineWeeks,
  }
}
