/**
 * Training Report — pure data aggregation for PDF/print reports.
 *
 * Computes period-level stats from workout and bodyweight data.
 * Framework-free: no Vue, no Pinia, no DOM. Consumed by reportRenderer.ts.
 */

import type { Exercise, WorkoutSet } from '../stores/workout'
import type { BodyweightEntry } from '../stores/bodyweight'
import { setDayKey, localDateKey, todayISO } from './dates'
import { effectiveSetWeight } from './bodyweightLoad'

// ── Types ────────────────────────────────────────────────────────

export type ReportPeriod = 'month' | 'quarter' | 'year'

export interface ReportInput {
  exercises: Exercise[]
  bodyweight: BodyweightEntry[]
  period: ReportPeriod
  /** Reference date — report covers the period ending on this date's period boundary. */
  referenceDate?: string // YYYY-MM-DD, defaults to today
  /** Convert stored lbs to display units. Defaults to identity. */
  toDisplayUnits?: (lbs: number) => number
  unitLabel?: string
}

export interface ExerciseE1RMProgression {
  name: string
  tags: string[]
  /** Chronological e1RM entries (one per workout day, the day's best). */
  timeline: { date: string; e1RM: number }[]
  /** Best e1RM in the period. */
  peakE1RM: number
  /** e1RM at the start of the period (first entry). */
  startE1RM: number
  /** Change in e1RM from start to peak. */
  delta: number
  totalSets: number
  totalVolume: number
}

export interface TagVolumeEntry {
  tag: string
  /** Total sets in the period. */
  sets: number
  /** Total volume (effective weight × reps) in the period, in display units. */
  volume: number
}

export interface WeeklyConsistency {
  /** ISO Monday date string. */
  weekStart: string
  /** Number of distinct training days in that week. */
  daysTrained: number
  /** Total sets that week. */
  sets: number
  /** Total volume that week, in display units. */
  volume: number
}

export interface BodyweightProgression {
  timeline: { date: string; weight: number }[]
  startWeight: number | null
  endWeight: number | null
  delta: number | null
}

export interface PREvent {
  date: string
  exerciseName: string
  weight: number
  reps: number
  e1RM: number
}

export interface TrainingReport {
  /** Human-readable period label, e.g. "April 2026" or "Q1 2026". */
  periodLabel: string
  startDate: string
  endDate: string
  unitLabel: string

  // Summary stats
  totalWorkoutDays: number
  totalSets: number
  totalVolume: number
  uniqueExercises: number
  prCount: number

  // Breakdowns
  exerciseProgressions: ExerciseE1RMProgression[]
  tagVolume: TagVolumeEntry[]
  weeklyConsistency: WeeklyConsistency[]
  bodyweight: BodyweightProgression
  prTimeline: PREvent[]
}

// ── Helpers ──────────────────────────────────────────────────────

function periodBounds(period: ReportPeriod, ref: string): { start: string; end: string; label: string } {
  const [y, m] = ref.split('-').map(Number)
  switch (period) {
    case 'month': {
      const start = `${y}-${String(m).padStart(2, '0')}-01`
      const lastDay = new Date(y, m, 0).getDate()
      const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
      return { start, end, label: `${monthNames[m - 1]} ${y}` }
    }
    case 'quarter': {
      const q = Math.ceil(m / 3)
      const startMonth = (q - 1) * 3 + 1
      const endMonth = q * 3
      const start = `${y}-${String(startMonth).padStart(2, '0')}-01`
      const lastDay = new Date(y, endMonth, 0).getDate()
      const end = `${y}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
      return { start, end, label: `Q${q} ${y}` }
    }
    case 'year': {
      return { start: `${y}-01-01`, end: `${y}-12-31`, label: `${y}` }
    }
  }
}

function mondayOfWeek(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const dow = date.getDay()
  const daysSinceMonday = dow === 0 ? 6 : dow - 1
  date.setDate(date.getDate() - daysSinceMonday)
  return localDateKey(date)
}

// ── Main ─────────────────────────────────────────────────────────

export function buildTrainingReport(input: ReportInput): TrainingReport {
  const toDisplay = input.toDisplayUnits ?? ((lb: number) => lb)
  const unitLabel = input.unitLabel ?? 'lbs'

  // `todayISO()`, never `toISOString().slice(0, 10)` — the latter reports
  // NEXT month to anyone generating a report on the evening of the 31st
  // anywhere behind UTC, and the report comes back empty (#1293).
  const today = input.referenceDate ?? todayISO()
  const { start, end, label } = periodBounds(input.period, today)

  // Filter sets within the period.
  //
  // `effectiveWeight` is the bodyweight-inclusive load (LIFT-834) in STORED
  // LBS, resolved here — the one place an exercise is still in scope — so the
  // four volume sums below cannot each forget the fold the way they did until
  // #1333. It is folded before `toDisplay` because `set.bodyweight` is stored
  // in lbs like `set.weight`; converting first and folding after would add a
  // pound count to a kilo count. For every non-bodyweight-loaded exercise it is
  // exactly `set.weight`.
  type SetWithExercise = WorkoutSet & {
    exerciseName: string
    exerciseTags: string[]
    exerciseId: string
    effectiveWeight: number
  }
  const periodSets: SetWithExercise[] = []

  // Every `set.date` / `entry.date` in this file buckets through `setDayKey`
  // (#746): a raw `toLocalDateKey` shifts the dominant endOfDayISO stamp
  // (`…T23:59Z`) forward a day for every user east of UTC, dropping sets on a
  // period boundary out of the report entirely; a raw `slice(0, 10)` breaks
  // the other convention instead. `setDayKey` is the one reconciliation point.
  for (const ex of input.exercises) {
    for (const set of ex.sets) {
      const dateKey = setDayKey(set.date)
      if (dateKey >= start && dateKey <= end) {
        periodSets.push({
          ...set,
          exerciseName: ex.name,
          exerciseTags: ex.tags,
          exerciseId: ex.id,
          effectiveWeight: effectiveSetWeight(set, ex),
        })
      }
    }
  }

  // Summary stats
  const workoutDays = new Set(periodSets.map(s => setDayKey(s.date)))
  const totalSets = periodSets.length
  const totalVolume = Math.round(periodSets.reduce((sum, s) => sum + toDisplay(s.effectiveWeight) * s.reps, 0))
  const exerciseNames = new Set(periodSets.map(s => s.exerciseName))

  // ── Exercise e1RM progressions ──
  const byExercise = new Map<string, { name: string; tags: string[]; sets: SetWithExercise[] }>()
  for (const s of periodSets) {
    if (!byExercise.has(s.exerciseId)) {
      byExercise.set(s.exerciseId, { name: s.exerciseName, tags: s.exerciseTags, sets: [] })
    }
    byExercise.get(s.exerciseId)!.sets.push(s)
  }

  // Also collect ALL sets per exercise (including before the period) for PR detection
  const allSetsByExercise = new Map<string, WorkoutSet[]>()
  for (const ex of input.exercises) {
    allSetsByExercise.set(ex.id, ex.sets)
  }

  const exerciseProgressions: ExerciseE1RMProgression[] = []
  const prTimeline: PREvent[] = []

  for (const [exId, { name, tags, sets }] of byExercise) {
    // Best e1RM per day
    const dayBest = new Map<string, number>()
    for (const s of sets) {
      const dk = setDayKey(s.date)
      const current = dayBest.get(dk) ?? 0
      if (s.estimated1RM > current) dayBest.set(dk, s.estimated1RM)
    }

    const timeline = [...dayBest.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, e1RM]) => ({ date, e1RM: Math.round(toDisplay(e1RM)) }))

    if (timeline.length === 0) continue

    const peakE1RM = Math.max(...timeline.map(t => t.e1RM))
    const startE1RM = timeline[0].e1RM

    const exVolume = Math.round(sets.reduce((sum, s) => sum + toDisplay(s.effectiveWeight) * s.reps, 0))

    exerciseProgressions.push({
      name,
      tags,
      timeline,
      peakE1RM,
      startE1RM,
      delta: peakE1RM - startE1RM,
      totalSets: sets.length,
      totalVolume: exVolume,
    })

    // PR detection: find sets in this period that beat all prior sets for this exercise
    const allSets = allSetsByExercise.get(exId) ?? []
    const priorSets = allSets.filter(s => setDayKey(s.date) < start)
    const priorMaxE1RM = priorSets.length > 0 ? Math.max(...priorSets.map(s => s.estimated1RM)) : 0

    // Track running max within the period too
    let runningMax = priorMaxE1RM
    const periodSetsSorted = [...sets].sort((a, b) => setDayKey(a.date).localeCompare(setDayKey(b.date)))
    for (const s of periodSetsSorted) {
      if (s.estimated1RM > runningMax) {
        runningMax = s.estimated1RM
        prTimeline.push({
          date: setDayKey(s.date),
          exerciseName: name,
          weight: Math.round(toDisplay(s.weight)),
          reps: s.reps,
          e1RM: Math.round(toDisplay(s.estimated1RM)),
        })
      }
    }
  }

  // Sort progressions by total volume descending
  exerciseProgressions.sort((a, b) => b.totalVolume - a.totalVolume)
  prTimeline.sort((a, b) => a.date.localeCompare(b.date))

  // ── Tag volume breakdown ──
  const tagMap = new Map<string, { sets: number; volume: number }>()
  for (const s of periodSets) {
    const vol = toDisplay(s.effectiveWeight) * s.reps
    for (const tag of s.exerciseTags) {
      const entry = tagMap.get(tag) ?? { sets: 0, volume: 0 }
      entry.sets++
      entry.volume += vol
      tagMap.set(tag, entry)
    }
  }
  const tagVolume: TagVolumeEntry[] = [...tagMap.entries()]
    .map(([tag, { sets, volume }]) => ({ tag, sets, volume: Math.round(volume) }))
    .sort((a, b) => b.sets - a.sets)

  // ── Weekly consistency ──
  const weekMap = new Map<string, { days: Set<string>; sets: number; volume: number }>()
  for (const s of periodSets) {
    const dk = setDayKey(s.date)
    const wk = mondayOfWeek(dk)
    const entry = weekMap.get(wk) ?? { days: new Set(), sets: 0, volume: 0 }
    entry.days.add(dk)
    entry.sets++
    entry.volume += toDisplay(s.effectiveWeight) * s.reps
    weekMap.set(wk, entry)
  }

  // Fill in empty weeks
  const allWeeks: string[] = []
  const startMonday = mondayOfWeek(start)
  const endMonday = mondayOfWeek(end)
  let cursor = startMonday
  while (cursor <= endMonday) {
    allWeeks.push(cursor)
    const [cy, cm, cd] = cursor.split('-').map(Number)
    const d = new Date(cy, cm - 1, cd)
    d.setDate(d.getDate() + 7)
    cursor = localDateKey(d)
  }

  const weeklyConsistency: WeeklyConsistency[] = allWeeks.map(wk => {
    const entry = weekMap.get(wk)
    return {
      weekStart: wk,
      daysTrained: entry?.days.size ?? 0,
      sets: entry?.sets ?? 0,
      volume: Math.round(entry?.volume ?? 0),
    }
  })

  // ── Bodyweight progression ──
  // Bodyweight carries the SAME two conventions as sets (`bodyweight.ts` writes
  // an endOfDayISO stamp for a UI-logged entry), so it buckets the same way.
  // The sort keys off the DERIVED day, not the raw stamp: a real-time evening
  // instant sorts after the next day's `…T23:59Z` stamp by raw string, which
  // would emit a non-monotonic timeline and read start/end weights off the
  // wrong rows. Raw date stays as the within-day tiebreaker.
  const bwInPeriod = input.bodyweight
    .map(e => ({ dayKey: setDayKey(e.date), entry: e }))
    .filter(({ dayKey }) => dayKey >= start && dayKey <= end)
    .sort((a, b) => a.dayKey.localeCompare(b.dayKey) || a.entry.date.localeCompare(b.entry.date))

  const bwTimeline = bwInPeriod.map(({ dayKey, entry }) => ({
    date: dayKey,
    weight: Math.round(toDisplay(entry.weight) * 10) / 10,
  }))

  const startWeight = bwTimeline.length > 0 ? bwTimeline[0].weight : null
  const endWeight = bwTimeline.length > 0 ? bwTimeline[bwTimeline.length - 1].weight : null
  const bwDelta = startWeight !== null && endWeight !== null ? Math.round((endWeight - startWeight) * 10) / 10 : null

  return {
    periodLabel: label,
    startDate: start,
    endDate: end,
    unitLabel,
    totalWorkoutDays: workoutDays.size,
    totalSets,
    totalVolume,
    uniqueExercises: exerciseNames.size,
    prCount: prTimeline.length,
    exerciseProgressions,
    tagVolume,
    weeklyConsistency,
    bodyweight: {
      timeline: bwTimeline,
      startWeight,
      endWeight,
      delta: bwDelta,
    },
    prTimeline,
  }
}
