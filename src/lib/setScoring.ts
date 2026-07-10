/**
 * Set scoring — the shared PR/zone/XP derivation for a single logged (or
 * previewed) set.
 *
 * WorkoutTracker had two copies of this logic: one on the real log path
 * (`computeAndLogXP`) and one on the live-preview path (`_computeXPPreview`).
 * Both derived the same values (established best 1RM, PR/tie/rep-PR flags,
 * zone classification, base XP) from the exercise's prior sets — a drift
 * hazard where a tweak to one copy would silently miss the other. This module
 * is the single pure owner of that derivation; the component now formats the
 * result for each surface (machine zone for storage, display string for the
 * live preview) rather than re-deriving it.
 */

import type { WorkoutSet } from '../stores/workout'
import { setDayKey } from './dates'
import {
  calculateSetXP,
  calculateBest1RM,
  checkRepPR,
  isExerciseEstablished,
  XP_CONFIG,
} from './xp'

/** Canonical machine zone for storage, instrumentation, and display. */
export type SetZone = 'warmup' | 'working' | 'pr' | 'tie' | 'new_exercise'

export interface SetScore {
  /** Established best 1RM (null when the exercise is immature / not established). */
  best1RM: number | null
  /** Whether the exercise has prior-day sets, so PR detection is unlocked. */
  isEstablished: boolean
  /** estimated1RM >= best1RM (PR or tie). */
  isPRZone: boolean
  /** estimated1RM > best1RM. */
  isPR: boolean
  /** estimated1RM === best1RM. */
  isTie: boolean
  /** More reps than ever before at this exact weight (and not already in PR zone). */
  isRepPR: boolean
  /** Not a PR, not a rep PR, and no prior set at this weight (still an improvement). */
  isNewWeight: boolean
  /** estimated1RM / best1RM, or null on a new/immature exercise. */
  ratio: number | null
  /** Canonical machine zone. */
  zone: SetZone
  /** Base XP for the set (before streak multipliers). */
  baseXP: number
}

/**
 * Filter sets to those on/after the user-set PR baseline day-key.
 * When no baseline is set, returns the sets unchanged (legacy all-time behavior).
 *
 * Bucketed via `setDayKey` (not `slice`/`toLocalDateKey`) so both storage
 * conventions — end-of-day day-keys and real-time UTC stamps — compare correctly.
 */
export function filterSetsSinceBaseline<T extends { date: string }>(
  sets: T[],
  baseline: string | null,
): T[] {
  if (!baseline) return sets
  return sets.filter(s => setDayKey(s.date) >= baseline)
}

/**
 * Score a single set against the exercise's prior sets.
 *
 * @param priorSets  All sets for the exercise EXCLUDING the one being scored.
 * @param estimated1RM  The candidate set's estimated 1RM.
 * @param weightLbs  The candidate set's weight, in lbs (matches stored `WorkoutSet.weight`).
 * @param reps  The candidate set's reps.
 * @param dateKey  The candidate set's date (used to gate exercise establishment).
 * @param baseline  The user's PR baseline day-key, or null for all-time.
 */
export function scoreSet(params: {
  priorSets: WorkoutSet[]
  estimated1RM: number
  weightLbs: number
  reps: number
  dateKey: string
  baseline: string | null
}): SetScore {
  const { priorSets, estimated1RM, weightLbs, reps, dateKey, baseline } = params

  // Best 1RM from prior sets, honoring the user-set PR baseline (falls back to
  // the rolling window when unset).
  const rawBest1RM = calculateBest1RM(priorSets, { sinceDate: baseline })

  // Suppress PR detection for immature exercises (all sets from the same day).
  const isEstablished = isExerciseEstablished(priorSets, dateKey)
  const best1RM = isEstablished ? rawBest1RM : null

  // Rep PR only counts when NOT already in PR/tie zone, and is evaluated
  // against the baseline-relative prior sets.
  const repPRPriorSets = filterSetsSinceBaseline(priorSets, baseline)
  const isPRZone = best1RM !== null && estimated1RM >= best1RM
  const isRepPR = isEstablished && !isPRZone && checkRepPR(weightLbs, reps, repPRPriorSets)
  const hasSetAtWeight = repPRPriorSets.some(s => s.weight === weightLbs)
  const isNewWeight = !isPRZone && !isRepPR && !hasSetAtWeight && best1RM !== null

  const baseXP = calculateSetXP({
    setEstimated1RM: estimated1RM,
    exerciseBest1RM: best1RM,
    isRepPR,
  })

  const isPR = best1RM !== null && estimated1RM > best1RM
  const isTie = best1RM !== null && estimated1RM === best1RM
  const ratio = best1RM !== null && best1RM > 0 ? estimated1RM / best1RM : null

  let zone: SetZone
  if (best1RM === null) zone = 'new_exercise'
  else if (isPR) zone = 'pr'
  else if (isTie) zone = 'tie'
  else if (ratio !== null && ratio < XP_CONFIG.warmupThreshold) zone = 'warmup'
  else zone = 'working'

  return { best1RM, isEstablished, isPRZone, isPR, isTie, isRepPR, isNewWeight, ratio, zone, baseXP }
}
