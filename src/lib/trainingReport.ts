/**
 * Training report data computation.
 *
 * Pure functions that aggregate workout-store data into structured report
 * sections: summary stats, per-exercise PR timelines, volume by tag, and
 * bodyweight trends. Framework-free so tests can exercise them directly.
 */

import type { Exercise, WorkoutSet } from '../stores/workout'

// ── Types ─────────────────────────────────────────────────────────

export interface ReportPeriod {
  label: string      // e.g., 'April 2026' or 'Q1 2026'
  startDate: string  // YYYY-MM-DD
  endDate: string    // YYYY-MM-DD
}

export interface ReportSummary {
  period: ReportPeriod
  totalWorkouts: number
  totalSets: number
  totalVolume: number     // sum of weight × reps (in stored units — lbs)
  uniqueExercises: number
  prsHit: number
  activeDays: number
  consistency: number     // percentage of weeks with at least 1 workout
}

export interface ExerciseReport {
  name: string
  tags: string[]
  totalSets: number
  bestE1RM: number
  bestWeight: number
  bestReps: number
  /** e1RM at start vs end of period — null if fewer than 2 sessions */
  e1rmDelta: number | null
  /** Best set per session date within the period, chronological */
  timeline: { date: string; e1rm: number; weight: number; reps: number }[]
}

export interface TagVolumeReport {
  tag: string
  totalSets: number
  totalVolume: number
  exerciseCount: number
}

export interface BodyweightReport {
  entries: { date: string; weight: number }[]
  startWeight: number | null
  endWeight: number | null
  delta: number | null
}

export interface TrainingReport {
  generatedAt: string    // ISO timestamp
  summary: ReportSummary
  exercises: ExerciseReport[]
  tagVolume: TagVolumeReport[]
  bodyweight: BodyweightReport
}

// ── Helpers ───────────────────────────────────────────────────────

function dateKey(iso: string): string {
  return iso.slice(0, 10)
}

/** Get sets within [startDate, endDate] inclusive. */
function setsInPeriod(sets: WorkoutSet[], start: string, end: string): WorkoutSet[] {
  return sets.filter(s => {
    const d = dateKey(s.date)
    return d >= start && d <= end
  })
}

/** Build a ReportPeriod for the last N days ending today. */
export function lastNDaysPeriod(days: number, today?: string): ReportPeriod {
  const endDate = today ?? new Date().toISOString().slice(0, 10)
  const [y, m, d] = endDate.split('-').map(Number)
  const start = new Date(y, m - 1, d)
  start.setDate(start.getDate() - days + 1)
  const startDate = [
    start.getFullYear(),
    String(start.getMonth() + 1).padStart(2, '0'),
    String(start.getDate()).padStart(2, '0'),
  ].join('-')
  return { label: `Last ${days} days`, startDate, endDate }
}

/** Build a ReportPeriod for a specific month. */
export function monthPeriod(year: number, month: number): ReportPeriod {
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December']
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { label: `${MONTHS[month - 1]} ${year}`, startDate, endDate }
}

// ── Core computation ──────────────────────────────────────────────

export function buildTrainingReport(
  period: ReportPeriod,
  exercises: Exercise[],
  bodyweightEntries: { date: string; weight: number }[],
): TrainingReport {
  const { startDate, endDate } = period

  // Filter exercises to those with sets in the period
  const exercisesWithSets: { ex: Exercise; periodSets: WorkoutSet[] }[] = []
  for (const ex of exercises) {
    const periodSets = setsInPeriod(ex.sets, startDate, endDate)
    if (periodSets.length > 0) {
      exercisesWithSets.push({ ex, periodSets })
    }
  }

  // ── Summary ──
  const workoutDates = new Set<string>()
  let totalSets = 0
  let totalVolume = 0
  let prsHit = 0

  for (const { ex, periodSets } of exercisesWithSets) {
    totalSets += periodSets.length
    for (const s of periodSets) {
      workoutDates.add(dateKey(s.date))
      totalVolume += s.weight * s.reps
    }
    // Count PRs: sets in the period whose e1RM exceeds all prior sets
    const priorSets = ex.sets.filter(s => dateKey(s.date) < startDate)
    const priorMax = priorSets.length > 0
      ? Math.max(...priorSets.map(s => s.estimated1RM))
      : 0
    const periodMax = Math.max(...periodSets.map(s => s.estimated1RM))
    if (periodMax > priorMax && priorSets.length > 0) {
      prsHit++
    }
  }

  // Consistency: what percentage of calendar weeks in the period had at least 1 workout
  const totalWeeks = Math.max(1, Math.ceil(
    (new Date(endDate + 'T12:00:00').getTime() - new Date(startDate + 'T12:00:00').getTime())
    / (7 * 24 * 60 * 60 * 1000)
  ))
  const weeksWithWorkout = new Set<string>()
  for (const d of workoutDates) {
    // ISO week approximation: use Monday-based week number
    const dt = new Date(d + 'T12:00:00')
    const yearStart = new Date(dt.getFullYear(), 0, 1)
    const daysSinceYearStart = Math.floor((dt.getTime() - yearStart.getTime()) / 86400000)
    const weekNum = Math.ceil((daysSinceYearStart + yearStart.getDay() + 1) / 7)
    weeksWithWorkout.add(`${dt.getFullYear()}-W${weekNum}`)
  }
  const consistency = Math.round((weeksWithWorkout.size / totalWeeks) * 100)

  const summary: ReportSummary = {
    period,
    totalWorkouts: workoutDates.size,
    totalSets,
    totalVolume,
    uniqueExercises: exercisesWithSets.length,
    prsHit,
    activeDays: workoutDates.size,
    consistency: Math.min(100, consistency),
  }

  // ── Per-exercise reports ──
  const exerciseReports: ExerciseReport[] = exercisesWithSets
    .map(({ ex, periodSets }) => {
      // Best e1RM per date
      const byDate = new Map<string, { e1rm: number; weight: number; reps: number }>()
      for (const s of periodSets) {
        const d = dateKey(s.date)
        const prev = byDate.get(d)
        if (!prev || s.estimated1RM > prev.e1rm) {
          byDate.set(d, { e1rm: s.estimated1RM, weight: s.weight, reps: s.reps })
        }
      }
      const timeline = [...byDate.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, data]) => ({ date, ...data }))

      const bestSet = periodSets.reduce((best, s) =>
        s.estimated1RM > best.estimated1RM ? s : best
      )
      const e1rmDelta = timeline.length >= 2
        ? timeline[timeline.length - 1].e1rm - timeline[0].e1rm
        : null

      return {
        name: ex.name,
        tags: ex.tags,
        totalSets: periodSets.length,
        bestE1RM: bestSet.estimated1RM,
        bestWeight: bestSet.weight,
        bestReps: bestSet.reps,
        e1rmDelta,
        timeline,
      }
    })
    .sort((a, b) => b.totalSets - a.totalSets) // most active first

  // ── Volume by tag ──
  const tagMap = new Map<string, { sets: number; volume: number; exercises: Set<string> }>()
  for (const { ex, periodSets } of exercisesWithSets) {
    const vol = periodSets.reduce((sum, s) => sum + s.weight * s.reps, 0)
    for (const tag of ex.tags) {
      const entry = tagMap.get(tag) ?? { sets: 0, volume: 0, exercises: new Set<string>() }
      entry.sets += periodSets.length
      entry.volume += vol
      entry.exercises.add(ex.name)
      tagMap.set(tag, entry)
    }
  }
  const tagVolume: TagVolumeReport[] = [...tagMap.entries()]
    .map(([tag, data]) => ({
      tag,
      totalSets: data.sets,
      totalVolume: data.volume,
      exerciseCount: data.exercises.size,
    }))
    .sort((a, b) => b.totalSets - a.totalSets)

  // ── Bodyweight ──
  const bwInPeriod = bodyweightEntries
    .filter(e => {
      const d = dateKey(e.date)
      return d >= startDate && d <= endDate
    })
    .sort((a, b) => dateKey(a.date).localeCompare(dateKey(b.date)))
  const bodyweight: BodyweightReport = {
    entries: bwInPeriod.map(e => ({ date: dateKey(e.date), weight: e.weight })),
    startWeight: bwInPeriod.length > 0 ? bwInPeriod[0].weight : null,
    endWeight: bwInPeriod.length > 0 ? bwInPeriod[bwInPeriod.length - 1].weight : null,
    delta: bwInPeriod.length >= 2
      ? bwInPeriod[bwInPeriod.length - 1].weight - bwInPeriod[0].weight
      : null,
  }

  return {
    generatedAt: new Date().toISOString(),
    summary,
    exercises: exerciseReports,
    tagVolume,
    bodyweight,
  }
}
