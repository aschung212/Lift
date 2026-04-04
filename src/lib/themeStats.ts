/**
 * Per-theme stats computation.
 *
 * Pure functions that aggregate xpPerSet entries + workout store data
 * to produce per-theme usage statistics.
 *
 * Issue #141
 */

import type { Exercise } from '../stores/workout'
import type { SetXPEntry } from '../stores/progression'

export interface ThemeStats {
  themeId: string
  totalSets: number
  totalReps: number
  totalVolume: number       // weight × reps summed
  totalXP: number
  avgXPPerSet: number
  prCount: number
  repPRCount: number
  daysUsed: number          // unique training dates
  firstSetDate: string | null
  lastSetDate: string | null
  favoriteExercise: { name: string; sets: number } | null
  zoneBreakdown: {
    warmup: number
    working: number
    pr: number
    tie: number
    newExercise: number
  }
}

/**
 * Compute stats for a single theme from xpPerSet entries + workout data.
 */
export function computeThemeStats(
  themeId: string,
  xpPerSet: Record<string, SetXPEntry | number>,
  exercises: Exercise[]
): ThemeStats {
  // Build a lookup of setId → exercise info
  const setLookup = new Map<string, { weight: number; reps: number; date: string; exerciseName: string }>()
  for (const ex of exercises) {
    for (const set of ex.sets) {
      setLookup.set(set.id, {
        weight: set.weight,
        reps: set.reps,
        date: set.date,
        exerciseName: ex.name,
      })
    }
  }

  const stats: ThemeStats = {
    themeId,
    totalSets: 0,
    totalReps: 0,
    totalVolume: 0,
    totalXP: 0,
    avgXPPerSet: 0,
    prCount: 0,
    repPRCount: 0,
    daysUsed: 0,
    firstSetDate: null,
    lastSetDate: null,
    favoriteExercise: null,
    zoneBreakdown: { warmup: 0, working: 0, pr: 0, tie: 0, newExercise: 0 },
  }

  const dates = new Set<string>()
  const exerciseCounts = new Map<string, number>()

  for (const [setId, entry] of Object.entries(xpPerSet)) {
    // Only count enriched entries that match this theme
    if (typeof entry === 'number') continue
    if (entry.theme !== themeId) continue

    stats.totalSets++
    stats.totalXP += entry.xp

    if (entry.isPR) stats.prCount++
    if (entry.isRepPR) stats.repPRCount++

    // Zone breakdown
    switch (entry.zone) {
      case 'warmup': stats.zoneBreakdown.warmup++; break
      case 'working': stats.zoneBreakdown.working++; break
      case 'pr': stats.zoneBreakdown.pr++; break
      case 'tie': stats.zoneBreakdown.tie++; break
      case 'new_exercise': stats.zoneBreakdown.newExercise++; break
    }

    // Cross-reference with workout store for reps, volume, date, exercise
    const setInfo = setLookup.get(setId)
    if (setInfo) {
      stats.totalReps += setInfo.reps
      stats.totalVolume += setInfo.weight * setInfo.reps
      dates.add(setInfo.date.slice(0, 10))

      if (!stats.firstSetDate || setInfo.date < stats.firstSetDate) {
        stats.firstSetDate = setInfo.date
      }
      if (!stats.lastSetDate || setInfo.date > stats.lastSetDate) {
        stats.lastSetDate = setInfo.date
      }

      const count = (exerciseCounts.get(setInfo.exerciseName) || 0) + 1
      exerciseCounts.set(setInfo.exerciseName, count)
    }
  }

  stats.daysUsed = dates.size
  stats.avgXPPerSet = stats.totalSets > 0 ? Math.round(stats.totalXP / stats.totalSets) : 0

  // Find favorite exercise
  if (exerciseCounts.size > 0) {
    let maxName = ''
    let maxCount = 0
    for (const [name, count] of exerciseCounts) {
      if (count > maxCount) { maxName = name; maxCount = count }
    }
    stats.favoriteExercise = { name: maxName, sets: maxCount }
  }

  return stats
}

/**
 * Compute stats for all themes that have data.
 */
export function computeAllThemeStats(
  xpPerSet: Record<string, SetXPEntry | number>,
  exercises: Exercise[]
): ThemeStats[] {
  // Collect unique theme IDs from enriched entries
  const themeIds = new Set<string>()
  for (const entry of Object.values(xpPerSet)) {
    if (typeof entry !== 'number' && entry.theme) {
      themeIds.add(entry.theme)
    }
  }

  return [...themeIds]
    .map(id => computeThemeStats(id, xpPerSet, exercises))
    .sort((a, b) => b.totalSets - a.totalSets) // most used first
}
