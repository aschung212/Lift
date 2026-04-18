/**
 * Warmup set classification — session-relative, no manual tagging.
 *
 * For each (exercise, local-date) group:
 *   1. Sort sets chronologically by full timestamp.
 *   2. Find the top-e1RM set (first occurrence of the max within the day).
 *   3. Sets chronologically BEFORE the top set whose e1RM / topE1RM <= threshold
 *      are classified as warmups.
 *   4. Everything else — the top set itself, anything logged after it (back-off /
 *      drop sets), and single-set days — is a working set.
 *
 * The output is a Set of set IDs that are classified as warmups, intended to be
 * used as a client-side filter (sets are never mutated or deleted).
 */

import type { WorkoutSet } from '../stores/workout'

/** Allowed range for the warmup threshold, in ratio-of-top-e1RM space. */
export const WARMUP_THRESHOLD_MIN = 0.5
export const WARMUP_THRESHOLD_MAX = 0.95
export const WARMUP_THRESHOLD_DEFAULT = 0.75
/** Increment for the Settings stepper. */
export const WARMUP_THRESHOLD_STEP = 0.05

function toLocalDateKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Classify warmup set IDs for a list of sets belonging to a SINGLE exercise.
 * Sets for different exercises must be classified separately — otherwise a
 * heavy squat day would incorrectly re-classify a bench warmup.
 */
export function classifyExerciseWarmups(
  sets: WorkoutSet[],
  threshold: number = WARMUP_THRESHOLD_DEFAULT,
): Set<string> {
  const warmupIds = new Set<string>()
  if (sets.length === 0) return warmupIds

  const byDay = new Map<string, WorkoutSet[]>()
  for (const s of sets) {
    const key = toLocalDateKey(s.date)
    const list = byDay.get(key)
    if (list) list.push(s)
    else byDay.set(key, [s])
  }

  for (const daySets of byDay.values()) {
    if (daySets.length < 2) continue

    const sorted = [...daySets].sort((a, b) => a.date.localeCompare(b.date))
    let topIdx = 0
    let topE1RM = sorted[0].estimated1RM
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].estimated1RM > topE1RM) {
        topIdx = i
        topE1RM = sorted[i].estimated1RM
      }
    }

    if (topE1RM <= 0) continue

    for (let i = 0; i < topIdx; i++) {
      if (sorted[i].estimated1RM / topE1RM <= threshold) {
        warmupIds.add(sorted[i].id)
      }
    }
  }

  return warmupIds
}

/**
 * Classify warmup set IDs across many exercises at once.
 * Groups by exercise first, then delegates to `classifyExerciseWarmups`.
 */
export function classifyWarmupsByExercise(
  exercises: Array<{ id: string; sets: WorkoutSet[] }>,
  threshold: number = WARMUP_THRESHOLD_DEFAULT,
): Set<string> {
  const all = new Set<string>()
  for (const ex of exercises) {
    for (const id of classifyExerciseWarmups(ex.sets, threshold)) {
      all.add(id)
    }
  }
  return all
}

/**
 * Clamp a threshold value to the allowed range and snap to the nearest step.
 * Useful when loading from persisted storage or user input.
 */
export function normalizeWarmupThreshold(value: number): number {
  if (!Number.isFinite(value)) return WARMUP_THRESHOLD_DEFAULT
  const clamped = Math.max(WARMUP_THRESHOLD_MIN, Math.min(WARMUP_THRESHOLD_MAX, value))
  const steps = Math.round((clamped - WARMUP_THRESHOLD_MIN) / WARMUP_THRESHOLD_STEP)
  const snapped = WARMUP_THRESHOLD_MIN + steps * WARMUP_THRESHOLD_STEP
  return Math.round(snapped * 100) / 100
}
