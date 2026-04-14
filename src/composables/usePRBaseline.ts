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
 */

import { ref, watch, type Ref } from 'vue'

const STORAGE_KEY = 'pr-baseline-date'

function loadStored(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    // Validate shape (YYYY-MM-DD). Reject anything else to avoid propagating bad state.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
    return raw
  } catch {
    return null
  }
}

const prBaselineDate: Ref<string | null> = ref(loadStored())

watch(prBaselineDate, (v) => {
  try {
    if (v === null) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, v)
  } catch {
    /* quota / private mode — silent */
  }
})

function todayISO(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Set the PR baseline. Pass null to revert to legacy (all-time) behavior.
 * Pass a YYYY-MM-DD string to anchor PR evaluation.
 */
function setPRBaseline(date: string | null): void {
  if (date === null) {
    prBaselineDate.value = null
    return
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return
  prBaselineDate.value = date
}

/** Anchor the PR baseline to today — typical "starting a new training block" action. */
function startNewTrainingBlock(): void {
  prBaselineDate.value = todayISO()
}

/** Revert to all-time PR evaluation. */
function clearPRBaseline(): void {
  prBaselineDate.value = null
}

export function usePRBaseline() {
  return {
    prBaselineDate,
    setPRBaseline,
    startNewTrainingBlock,
    clearPRBaseline,
  }
}
