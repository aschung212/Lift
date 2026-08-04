/**
 * Per-day session summary computation.
 *
 * Pure functions that aggregate workout-store data into the shape consumed
 * by `WorkoutCompleteView` and the share cards (issue #305).
 *
 * Framework-free so the share-card pipeline and tests can use it directly.
 */

import type { Exercise, WorkoutSet } from '../stores/workout'
import type { SetXPEntry } from '../stores/progression'
import { toLocalDateKey, localDateKey } from './dates'
import { effectiveSetWeight } from './bodyweightLoad'

export interface SessionHighlight {
  exerciseId: string
  name: string
  weight: number
  reps: number
  e1RM: number
  badge: 'PR' | 'rep PR' | ''
  volume: number
}

export interface SessionBestSet {
  exerciseId: string
  name: string
  weight: number
  reps: number
  e1RM: number
  isPR: boolean
}

export interface SessionSummary {
  rawDate: string             // YYYY-MM-DD (key used everywhere internally)
  date: string                // 'Tue, Apr 22' formatted for display
  duration: string            // 'Xh Ym' / 'Ym' / '—' when the span is unknowable
  totalVolume: number         // Σ weight × reps, in display units
  setsCompleted: number
  exercises: number           // distinct exercise count for the date
  prs: number                 // weight/e1RM PRs (one per exercise, deduped)
  repPRs: number              // rep-at-weight PRs (one per exercise, deduped)
  bestSet: SessionBestSet | null
  highlights: SessionHighlight[]
  weekVolume: number[]        // 7 entries, Mon→Sun, in display units
  /** Sum of the previous Mon→Sun week, in display units. Used for the % delta on the WeekChart card. */
  priorWeekVolume: number
  streak: number              // weeks
  /** Display unit label for any weight field — 'lbs' or 'kg'. */
  unitLabel: string
}

export interface SessionSummaryInput {
  rawDate: string
  exercises: Exercise[]
  /** When provided, PR/repPR flags are read from here for consistency with the XP system. */
  xpPerSet?: Record<string, SetXPEntry | number>
  /** Weekly streak count from the progression store. */
  streakWeeks?: number
  /**
   * Convert the stored weight (always pounds) to the user's display units.
   * Defaults to identity (no conversion). Pass `useTheme().displayWeight`
   * when called from a Vue context so cards render the correct numbers.
   */
  toDisplayUnits?: (lbValue: number) => number
  /** Label to surface alongside weight values. Defaults to 'lbs'. */
  unitLabel?: string
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** Format YYYY-MM-DD as 'Tue, Apr 22' in local time. */
export function formatSessionDate(rawDate: string): string {
  const [y, m, d] = rawDate.split('-').map(Number)
  if (!y || !m || !d) return rawDate
  const local = new Date(y, m - 1, d)
  return `${WEEKDAY_SHORT[local.getDay()]}, ${MONTH_SHORT[local.getMonth()]} ${local.getDate()}`
}

/** Return Monday→Sunday array of YYYY-MM-DD for the week containing rawDate. */
export function weekRange(rawDate: string): string[] {
  const [y, m, d] = rawDate.split('-').map(Number)
  const local = new Date(y, m - 1, d)
  // JS: 0=Sun, 1=Mon, ... 6=Sat. Shift so Monday=0.
  const dayIdx = (local.getDay() + 6) % 7
  const monday = new Date(local)
  monday.setDate(local.getDate() - dayIdx)
  const out: string[] = []
  for (let i = 0; i < 7; i++) {
    const day = new Date(monday)
    day.setDate(monday.getDate() + i)
    out.push(localDateKey(day))
  }
  return out
}

/** Format a millisecond duration as 'Xh Ym' / 'Ym' / '<1m'. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 60_000) return '<1m'
  const totalMin = Math.round(ms / 60_000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

/**
 * `endOfDayISO` lands sets between 23:59:00.000Z and 23:59:59.999Z — bulk-add
 * and legacy paths look like a sub-minute span. Treat anything in that window as
 * "duration unknown" rather than misleading the user with a fake "<1m".
 *
 * Detection is string-based (UTC) because the underlying timestamps are produced
 * via `endOfDayISO()` and `Date.toISOString()` — both always Z-suffixed.
 */
function isEndOfDayJitter(iso: string): boolean {
  return iso.slice(11, 16) === '23:59'
}

/** Pure: compute per-day session summary. */
export function buildSessionSummary(input: SessionSummaryInput): SessionSummary {
  const { rawDate, exercises, xpPerSet, streakWeeks = 0 } = input
  const toDisplay = input.toDisplayUnits ?? ((lb: number) => lb)
  const unitLabel = input.unitLabel ?? 'lbs'
  /** Round small per-set values nicely; volume gets the same treatment then string-formatted. */
  const cv = (lb: number) => {
    const v = toDisplay(lb)
    return Number.isInteger(v) ? v : Math.round(v * 10) / 10
  }

  const dayKey = rawDate
  const todaysByExercise = new Map<string, { ex: Exercise; sets: WorkoutSet[] }>()
  for (const ex of exercises) {
    const todays = ex.sets.filter((s) => toLocalDateKey(s.date) === dayKey)
    if (todays.length > 0) todaysByExercise.set(ex.id, { ex, sets: todays })
  }

  let totalVolume = 0
  let setsCompleted = 0
  let bestSet: SessionBestSet | null = null
  const highlights: SessionHighlight[] = []
  let prCount = 0
  let repPRCount = 0

  for (const { ex, sets } of todaysByExercise.values()) {
    let exVolume = 0
    let topSet: WorkoutSet | null = null
    let bestE1RM = -1
    let exerciseHasPR = false
    let exerciseHasRepPR = false

    // Prior sets (everything strictly before today). Used both for derived
    // PR detection AND for rep-PR-at-weight comparison.
    const priorSets = ex.sets.filter((s) => toLocalDateKey(s.date) < dayKey)
    const priorMaxE1RM = priorSets.length === 0 ? null : Math.max(...priorSets.map((s) => s.estimated1RM))
    const priorRepsByWeight = new Map<number, number>()
    for (const s of priorSets) {
      const cur = priorRepsByWeight.get(s.weight) ?? 0
      if (s.reps > cur) priorRepsByWeight.set(s.weight, s.reps)
    }

    for (const s of sets) {
      setsCompleted++
      const vol = effectiveSetWeight(s, ex) * s.reps
      totalVolume += vol
      exVolume += vol
      if (s.estimated1RM > bestE1RM) {
        bestE1RM = s.estimated1RM
        topSet = s
      }

      // Prefer the XP system's flags when available so the card matches
      // what was awarded at log time.
      const xpEntry = xpPerSet?.[s.id]
      const xpFlags = xpEntry && typeof xpEntry !== 'number' ? xpEntry : null
      if (xpFlags) {
        if (xpFlags.isPR) exerciseHasPR = true
        if (xpFlags.isRepPR) exerciseHasRepPR = true
      } else {
        // Derived: e1RM beats prior best, OR no prior data and this is the best so far.
        if (priorMaxE1RM !== null && s.estimated1RM > priorMaxE1RM) exerciseHasPR = true
        const priorReps = priorRepsByWeight.get(s.weight) ?? 0
        if (priorReps > 0 && s.reps > priorReps) exerciseHasRepPR = true
      }
    }

    if (exerciseHasPR) prCount++
    if (exerciseHasRepPR) repPRCount++

    if (topSet) {
      const badge: SessionHighlight['badge'] = exerciseHasPR ? 'PR' : exerciseHasRepPR ? 'rep PR' : ''
      highlights.push({
        exerciseId: ex.id,
        name: ex.name,
        weight: cv(topSet.weight),
        reps: topSet.reps,
        e1RM: cv(topSet.estimated1RM),
        badge,
        volume: cv(exVolume),
      })
      if (!bestSet || topSet.estimated1RM > bestSet.e1RM) {
        bestSet = {
          exerciseId: ex.id,
          name: ex.name,
          weight: cv(topSet.weight),
          reps: topSet.reps,
          e1RM: cv(topSet.estimated1RM),
          isPR: exerciseHasPR,
        }
      }
    }
  }

  highlights.sort((a, b) => b.volume - a.volume)

  // Duration: span between earliest and latest *real-time* timestamps on the date.
  // End-of-day jitter timestamps (bulk-add / legacy) are excluded entirely —
  // including them in the max would inflate duration to ~all day when a user
  // mixes a real-time session with a bulk-added set on the same date.
  let duration = '—'
  const realTimestamps: number[] = []
  for (const { sets } of todaysByExercise.values()) {
    for (const s of sets) {
      if (isEndOfDayJitter(s.date)) continue
      const t = Date.parse(s.date)
      if (!Number.isNaN(t)) realTimestamps.push(t)
    }
  }
  if (realTimestamps.length > 1) {
    const span = Math.max(...realTimestamps) - Math.min(...realTimestamps)
    duration = formatDuration(span)
  } else if (realTimestamps.length === 1) {
    duration = '<1m'
  }

  // Week volume — Mon→Sun for current week + sum for prior week (used by
  // the WeekChart card's % delta). Both built in a single pass.
  const week = weekRange(rawDate)
  const priorWeek = weekRange(shiftDateByDays(rawDate, -7))
  const priorWeekSet = new Set(priorWeek)
  const weekVolumeMap = new Map<string, number>(week.map((d) => [d, 0]))
  let priorWeekTotal = 0
  for (const ex of exercises) {
    for (const s of ex.sets) {
      const k = toLocalDateKey(s.date)
      const vol = effectiveSetWeight(s, ex) * s.reps
      if (weekVolumeMap.has(k)) {
        weekVolumeMap.set(k, weekVolumeMap.get(k)! + vol)
      } else if (priorWeekSet.has(k)) {
        priorWeekTotal += vol
      }
    }
  }
  const weekVolume = week.map((d) => cv(weekVolumeMap.get(d) ?? 0))
  const priorWeekVolume = cv(priorWeekTotal)

  return {
    rawDate,
    date: formatSessionDate(rawDate),
    duration,
    totalVolume: cv(totalVolume),
    setsCompleted,
    exercises: todaysByExercise.size,
    prs: prCount,
    repPRs: repPRCount,
    bestSet,
    highlights,
    weekVolume,
    priorWeekVolume,
    streak: streakWeeks,
    unitLabel,
  }
}

/** Helper: add (or subtract) days to a YYYY-MM-DD, returning YYYY-MM-DD. */
function shiftDateByDays(rawDate: string, days: number): string {
  const [y, m, d] = rawDate.split('-').map(Number)
  const base = new Date(y, m - 1, d)
  base.setDate(base.getDate() + days)
  return localDateKey(base)
}
