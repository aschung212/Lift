/**
 * Retroactive XP Migration
 *
 * One-time computation of XP for all existing sets.
 * Processes sets chronologically per exercise so the rolling
 * 6-month best 1RM builds naturally forward through time.
 *
 * Issue #123
 */

import type { Exercise } from '../stores/workout'
import type { BodyweightEntry } from '../stores/bodyweight'
import { calculateSetXP, XP_CONFIG } from './xp'

const MIGRATION_KEY = 'progression_migrated'

export interface MigrationResult {
  totalXP: number
  xpPerSet: Record<string, number>
  bodyweightXPDates: string[]
  bodyweightXP: number
}

/** Check if migration has already run. */
export function isMigrated(): boolean {
  return localStorage.getItem(MIGRATION_KEY) === 'true'
}

/** Mark migration as complete. */
export function markMigrated(): void {
  localStorage.setItem(MIGRATION_KEY, 'true')
}

/** Clear migration flag (for re-running). */
export function clearMigrationFlag(): void {
  localStorage.removeItem(MIGRATION_KEY)
}

/**
 * Compute XP for all historical sets and bodyweight entries.
 * Pure function — does not mutate any store.
 */
export function computeRetroactiveXP(
  exercises: Exercise[],
  bodyweightEntries: BodyweightEntry[]
): MigrationResult {
  const xpPerSet: Record<string, number> = {}
  let totalXP = 0

  for (const exercise of exercises) {
    // Sort sets chronologically (oldest first)
    const sortedSets = [...exercise.sets].sort((a, b) => a.date.localeCompare(b.date))

    for (let i = 0; i < sortedSets.length; i++) {
      const set = sortedSets[i]

      // Baseline 1RM isn't established until 3 sets are logged
      const priorSets = sortedSets.slice(0, i)
      const best1RM = i < 3 ? null : calculateBest1RMAtDate(priorSets, set.date)

      const xp = calculateSetXP({
        setEstimated1RM: set.estimated1RM,
        exerciseBest1RM: best1RM,
        setIndex: i,
      })
      // No streak multiplier for pre-migration sets (1.0x)

      xpPerSet[set.id] = xp
      totalXP += xp
    }
  }

  // Bodyweight XP: 100 per unique calendar date
  const bodyweightXPDates: string[] = []
  const seenDates = new Set<string>()

  for (const entry of bodyweightEntries) {
    const dateKey = entry.date.slice(0, 10)
    if (!seenDates.has(dateKey)) {
      seenDates.add(dateKey)
      bodyweightXPDates.push(dateKey)
    }
  }

  const bodyweightXP = bodyweightXPDates.length * XP_CONFIG.bodyweightXP
  totalXP += bodyweightXP

  return { totalXP, xpPerSet, bodyweightXPDates, bodyweightXP }
}

/**
 * Calculate best 1RM from sets that fall within a 6-month window
 * ending at the given reference date (not using Date.now()).
 */
function calculateBest1RMAtDate(
  sets: { date: string; estimated1RM: number }[],
  referenceDate: string
): number | null {
  if (sets.length === 0) return null

  const refTime = new Date(referenceDate).getTime()
  const windowMs = XP_CONFIG.best1RMWindowMonths * 30 * 24 * 60 * 60 * 1000
  const cutoff = refTime - windowMs

  let best: number | null = null

  for (const set of sets) {
    const setTime = new Date(set.date).getTime()
    if (setTime < cutoff) continue
    if (best === null || set.estimated1RM > best) {
      best = set.estimated1RM
    }
  }

  return best
}
