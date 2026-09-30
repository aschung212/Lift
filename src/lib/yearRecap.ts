/**
 * Year-in-review recap aggregation (#1018).
 *
 * Every share card until now consumed a single-session `SessionSummary` — one
 * day's work. This is the other axis: one calendar year of it, reduced to the
 * handful of numbers a "wrapped" card can carry.
 *
 * Pure and CLOCK-FREE: the year is a parameter, never `new Date().getFullYear()`
 * (the same rule `buildSessionPlan` follows for `todayKey`). The calendar view's
 * year nav is what picks it, so a lifter can recap 2025 from 2026 and a test can
 * assert a fixed year without pinning the system clock.
 *
 * Three house rules this module is bound by, each of which has already shipped
 * broken somewhere else in the app:
 *
 *  - Days are bucketed through `setDayKey` (#746), never `slice(0, 10)` or a raw
 *    `toLocalDateKey`. The year a set belongs to is the first four characters of
 *    its LOCAL day key, so a New Year's Eve evening set in Los Angeles stays in
 *    the year the lifter trained it and a UI-logged `…T23:59Z` stamp in Tokyo
 *    does not slide into the next one.
 *  - Volume folds bodyweight in via `effectiveSetWeight` (LIFT-834/#1333), so a
 *    pure-bodyweight pull-up year is not reported as zero volume.
 *  - The top lift's load is worded by `formatSetLoad` (LIFT-1373) rather than
 *    interpolated bare, so "Bodyweight × 12" never reads "0 lbs × 12" beside an
 *    e1RM computed off the folded load.
 */

import type { Exercise, WorkoutSet } from '../stores/workout'
import { setDayKey, daysBetweenISO } from './dates'
import { effectiveSetWeight, formatSetLoad } from './bodyweightLoad'
import { weekRange } from './sessionSummary'

/** The single heaviest set of the year, by estimated 1RM. */
export interface YearRecapLift {
  exerciseId: string
  name: string
  /**
   * The load in ADDED-space words — `'225 lbs'`, `'+25 lbs'`, or the whole
   * phrase `'Bodyweight'`. Pre-formatted here (rather than as a number a card
   * re-words) because `e1RM` beside it carries the folded load: the two halves
   * have to be decided together or the row contradicts itself (LIFT-1373).
   */
  load: string
  reps: number
  /** Estimated 1RM in display units — bodyweight already folded in. */
  e1RM: number
}

/**
 * What the lifter trained most this year. A TAG when they tag their exercises
 * (that is the app's muscle-group model), else the most-logged exercise — so a
 * lifter who never tagged anything still gets an answer rather than a blank.
 */
export interface YearRecapTally {
  kind: 'tag' | 'exercise'
  name: string
  sets: number
}

export interface YearRecap {
  year: number
  /** Distinct local days with at least one logged set. */
  workouts: number
  sets: number
  reps: number
  /** Σ effective weight × reps for the year, in display units. */
  totalVolume: number
  /** Distinct exercises trained. */
  exercises: number
  /**
   * Days on which an exercise's best estimated 1RM beat every day before it —
   * counted once per exercise per day, and never on an exercise's first-ever
   * day (that is the `new_exercise` zone, not a PR, matching `scoreSet` and the
   * session summary's derived path).
   */
  prs: number
  /** Longest run of consecutive Mon–Sun weeks IN THIS YEAR holding a session. */
  longestStreakWeeks: number
  topLift: YearRecapLift | null
  mostTrained: YearRecapTally | null
  /** Display unit label for any weight field — 'lbs' or 'kg'. */
  unitLabel: string
}

export interface YearRecapInput {
  /** Calendar year to aggregate, e.g. 2026. */
  year: number
  exercises: Exercise[]
  /**
   * Convert a stored weight (always pounds) to the user's display units.
   * Defaults to identity. Pass `useWeightUnit().displayWeight` from a Vue
   * context so the card renders the numbers the rest of the app shows.
   */
  toDisplayUnits?: (lbValue: number) => number
  /** Label to surface alongside weight values. Defaults to 'lbs'. */
  unitLabel?: string
}

/**
 * Longest run of consecutive weeks among the given local day keys.
 *
 * Weeks are Mon–Sun, resolved through `weekRange` (the session summary's
 * existing week helper) so this does not become yet another hand-rolled
 * "shift back to Monday" copy. Scoped to the day keys handed in, which for a
 * recap means the year: a streak that began in December of the previous year
 * counts from January here, and the card says "in 2026" for exactly that
 * reason.
 */
function longestWeekRun(dayKeys: Iterable<string>): number {
  const weeks = [...new Set([...dayKeys].map((k) => weekRange(k)[0]))].sort()
  if (weeks.length === 0) return 0
  let longest = 1
  let current = 1
  for (let i = 1; i < weeks.length; i++) {
    current = daysBetweenISO(weeks[i - 1], weeks[i]) === 7 ? current + 1 : 1
    if (current > longest) longest = current
  }
  return longest
}

/**
 * Days on which this exercise set a new best estimated 1RM, keyed by day.
 *
 * Day-level rather than set-level so intra-day set order cannot change the
 * answer, and so a session that beats the old best three times still counts
 * once — the same "one PR per exercise per day" shape `buildSessionSummary`
 * reports. The exercise's first recorded day is deliberately excluded: there is
 * no prior best to beat, which is the `new_exercise` zone rather than a PR.
 */
function prDays(sets: WorkoutSet[]): Set<string> {
  const bestByDay = new Map<string, number>()
  for (const s of sets) {
    const k = setDayKey(s.date)
    const prev = bestByDay.get(k)
    if (prev === undefined || s.estimated1RM > prev) bestByDay.set(k, s.estimated1RM)
  }
  const days = [...bestByDay.keys()].sort()
  const out = new Set<string>()
  let priorBest = -Infinity
  for (let i = 0; i < days.length; i++) {
    const best = bestByDay.get(days[i])!
    if (i > 0 && best > priorBest) out.add(days[i])
    if (best > priorBest) priorBest = best
  }
  return out
}

/**
 * Pure: aggregate one calendar year of training into a shareable recap.
 *
 * Returns `null` when the year holds no logged sets at all — there is nothing
 * to recap, and every surface gates its entry point on that rather than
 * offering a card full of zeroes. Every other threshold is deliberately absent:
 * the button lives beside a heatmap that already shows exactly how much the
 * lifter trained, so a small year is an honest one, not a hidden one.
 */
export function buildYearRecap(input: YearRecapInput): YearRecap | null {
  const { year, exercises } = input
  const toDisplay = input.toDisplayUnits ?? ((lb: number) => lb)
  const unitLabel = input.unitLabel ?? 'lbs'
  /** Round a converted weight the way the session summary does. */
  const cv = (lb: number) => {
    const v = toDisplay(lb)
    return Number.isInteger(v) ? v : Math.round(v * 10) / 10
  }
  const loadFormat = { displayWeight: cv, unit: unitLabel }
  const yearPrefix = String(year)

  const trainingDays = new Set<string>()
  const tagSets = new Map<string, number>()
  const exerciseSets = new Map<string, number>()
  let sets = 0
  let reps = 0
  let volumeLb = 0
  let trainedExercises = 0
  let prs = 0
  let topLift: YearRecapLift | null = null
  let topLiftE1RM = -Infinity

  for (const ex of exercises) {
    let exerciseSetCount = 0

    for (const s of ex.sets) {
      const dayKey = setDayKey(s.date)
      if (dayKey.slice(0, 4) !== yearPrefix) continue

      exerciseSetCount++
      sets++
      reps += s.reps
      volumeLb += effectiveSetWeight(s, ex) * s.reps
      trainingDays.add(dayKey)

      if (s.estimated1RM > topLiftE1RM) {
        topLiftE1RM = s.estimated1RM
        topLift = {
          exerciseId: ex.id,
          name: ex.name,
          load: formatSetLoad(s, ex, loadFormat),
          reps: s.reps,
          e1RM: cv(s.estimated1RM),
        }
      }
    }

    if (exerciseSetCount === 0) continue
    trainedExercises++
    exerciseSets.set(ex.name, (exerciseSets.get(ex.name) ?? 0) + exerciseSetCount)
    for (const tag of ex.tags ?? []) {
      tagSets.set(tag, (tagSets.get(tag) ?? 0) + exerciseSetCount)
    }

    // PR days are derived from the exercise's WHOLE history — a 2026 PR is one
    // that beat everything before it, including 2025 — then narrowed to the
    // year being recapped.
    for (const day of prDays(ex.sets)) {
      if (day.slice(0, 4) === yearPrefix) prs++
    }
  }

  if (sets === 0) return null

  return {
    year,
    workouts: trainingDays.size,
    sets,
    reps,
    totalVolume: cv(volumeLb),
    exercises: trainedExercises,
    prs,
    longestStreakWeeks: longestWeekRun(trainingDays),
    topLift,
    mostTrained: topTally(tagSets, 'tag') ?? topTally(exerciseSets, 'exercise'),
    unitLabel,
  }
}

/**
 * Highest-count entry of a name→sets map. Ties break alphabetically so the same
 * data always produces the same card (a `Map` preserves insertion order, which
 * is store order, which a rename or a sync can reshuffle).
 */
function topTally(counts: Map<string, number>, kind: YearRecapTally['kind']): YearRecapTally | null {
  let best: YearRecapTally | null = null
  for (const [name, setCount] of counts) {
    if (!best || setCount > best.sets || (setCount === best.sets && name < best.name)) {
      best = { kind, name, sets: setCount }
    }
  }
  return best
}
