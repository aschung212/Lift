import { toLocalDateKey } from './sessionSummary'
import type { Exercise } from '../stores/workout'

export interface WeeklyGoalInfo {
  trained: number
  target: number
  met: boolean
  atRisk: boolean
}

/**
 * Compute the weekly goal status for a Mon–Sun week.
 *
 * @param exercises - all exercises with their sets
 * @param target - user's weekly training days goal (1–7)
 * @param now - current date (injectable for testing)
 * @returns goal info or null if target is 0
 */
export function computeWeeklyGoal(
  exercises: Exercise[],
  target: number,
  now: Date = new Date(),
): WeeklyGoalInfo {
  const dow = now.getDay() // 0=Sun, 1=Mon, ...
  // Monday-based week: days since Monday (Sun=6, Mon=0, Tue=1, ...)
  const daysSinceMonday = dow === 0 ? 6 : dow - 1
  const monday = new Date(now)
  monday.setDate(now.getDate() - daysSinceMonday)
  monday.setHours(0, 0, 0, 0)

  const endOfToday = new Date(now)
  endOfToday.setHours(23, 59, 59, 999)

  const daysTrainedSet = new Set<string>()
  for (const ex of exercises) {
    for (const s of ex.sets) {
      const d = toLocalDateKey(s.date)
      const setDate = new Date(d + 'T00:00:00')
      if (setDate >= monday && setDate <= endOfToday) {
        daysTrainedSet.add(d)
      }
    }
  }

  const trained = daysTrainedSet.size
  // Days remaining after today (including today if they haven't trained yet today)
  const daysRemainingIncludingToday = 7 - daysSinceMonday
  const needed = target - trained
  const met = trained >= target

  // Streak at risk: not yet met, and not enough days remaining to catch up
  const atRisk = !met && needed > daysRemainingIncludingToday

  return { trained, target, met, atRisk }
}
