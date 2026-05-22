/**
 * PR baseline date — the anchor date against which PRs are evaluated.
 *
 * Semantics:
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
 * Storage: prBaselineDate lives in the preferences store, which syncs to
 * Supabase via the user_preferences JSONB column. This ensures the baseline
 * persists across devices.
 */

import { computed, type ComputedRef } from 'vue'
import { usePreferencesStore } from '../stores/preferences'

export interface UsePRBaselineReturn {
  prBaselineDate: ComputedRef<string | null>
  setPRBaseline: (date: string | null) => void
  startNewTrainingBlock: () => void
  clearPRBaseline: () => void
}

export function usePRBaseline(): UsePRBaselineReturn {
  const prefs = usePreferencesStore()

  const prBaselineDate = computed(() => prefs.prBaselineDate)

  function setPRBaseline(date: string | null): void {
    prefs.setPRBaselineDate(date)
  }

  function startNewTrainingBlock(): void {
    prefs.startNewTrainingBlock()
  }

  function clearPRBaseline(): void {
    prefs.clearPRBaseline()
  }

  return {
    prBaselineDate,
    setPRBaseline,
    startNewTrainingBlock,
    clearPRBaseline,
  }
}
