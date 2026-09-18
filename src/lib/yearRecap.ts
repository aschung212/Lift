/**
 * Year-in-Review recap aggregation (#1018).
 *
 * Every share card until now consumed a single-session `SessionSummary` — one
 * day's work. This is the aggregate counterpart: one calendar year of the
 * workout store folded into the handful of numbers a "wrapped" card brags
 * about (total volume, training days, biggest lift, most-trained muscle,
 * longest streak, month-by-month shape).
 *
 * Pure and **clock-free** — `year` is a parameter, never `new Date()` — so the
 * same rule `buildSessionPlan` follows applies here: a test pins the year it
 * asks about instead of asserting against the calendar (#1254).
 *
 * Three invariants this module inherits rather than reinvents:
 *  - days are bucketed with `setDayKey`, the single reconciliation point for
 *    the two stored date conventions (#746) — never `slice(0, 10)`;
 *  - volume folds bodyweight through `effectiveSetWeight` (#1333), so a
 *    pure-bodyweight pull-up year is not a zero-volume year;
 *  - the best lift's load is named through `formatSetLoad` (LIFT-1373) at
 *    aggregation time, so the card renders a decided phrase ("Bodyweight",
 *    "+25 lbs", "225 lbs") rather than re-deriving the ADDED portion itself
 *    beside a folded e1RM.
 */

import type { Exercise, WorkoutSet } from '../stores/workout'
import { setDayKey, localDateKey } from './dates'
import { effectiveSetWeight, formatSetLoad, type SetLoadFormat } from './bodyweightLoad'

/** The year's heaviest single lift, already formatted for display. */
export interface YearRecapLift {
  exerciseId: string
  name: string
  /**
   * The load in ADDED-space words — `'225 lbs'`, `'+25 lbs'`, `'Bodyweight'`.
   * Decided here via `formatSetLoad` so the phrase and the `e1RM` beside it
   * describe the same load (LIFT-1373).
   */
  loadLabel: string
  reps: number
  /** Estimated 1RM in display units, bodyweight already folded in. */
  e1RM: number
  /** Local day key (YYYY-MM-DD) the lift landed on. */
  dateKey: string
}

/** Most-trained tag over the year, by set count. */
export interface YearRecapTag {
  tag: string
  sets: number
}

export interface YearRecap {
  year: number
  /** Σ effective weight × reps over the year, in display units. */
  totalVolume: number
  /** Distinct local days carrying at least one set. */
  workouts: number
  /** Total sets logged in the year. */
  sets: number
  /** Distinct exercises trained in the year. */
  exercises: number
  /**
   * Exercise-days on which a new all-time best e1RM was set, summed over the
   * year. At most one per exercise per day, matching how `buildSessionSummary`
   * counts a session's PRs — three ascending sets in one workout are one PR,
   * not three.
   */
  prs: number
  /** Heaviest lift of the year by estimated 1RM, or null for an empty year. */
  bestLift: YearRecapLift | null
  /** Most-trained tag by set count, or null when nothing trained is tagged. */
  topTag: YearRecapTag | null
  /** Longest run of consecutive Mon–Sun weeks trained, within the year. */
  longestStreakWeeks: number
  /** 12 entries, Jan→Dec, in display units. */
  monthlyVolume: number[]
  /** 0-11 index of the highest-volume month, or null for an empty year. */
  busiestMonth: number | null
  /** Display unit label for any weight field — 'lbs' or 'kg'. */
  unitLabel: string
}

export interface YearRecapInput {
  /** Calendar year to recap. Passed in — this module never reads the clock. */
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

export const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'] as const
export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** Is this recap worth showing? An untrained year has nothing to celebrate. */
export function hasYearRecapData(recap: YearRecap): boolean {
  return recap.sets > 0
}

/**
 * Monday of the Mon–Sun week containing a local `YYYY-MM-DD` day key.
 *
 * Built on a local `Date` (not a UTC parse) and `localDateKey`, mirroring
 * `sessionSummary.weekRange` — a `new Date(key)` parse is UTC-midnight and
 * rolls the week back a day for every user west of Greenwich.
 */
function weekStartKey(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number)
  const local = new Date(y, m - 1, d)
  // JS: 0=Sun … 6=Sat. Shift so Monday=0.
  local.setDate(local.getDate() - ((local.getDay() + 6) % 7))
  return localDateKey(local)
}

/** Whole weeks between two Monday keys (positive when `b` is later). */
function weeksBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  const days = Math.round((new Date(by, bm - 1, bd).getTime() - new Date(ay, am - 1, ad).getTime()) / 86_400_000)
  return Math.round(days / 7)
}

/**
 * Longest run of consecutive Mon–Sun weeks containing at least one training
 * day, over the supplied day keys.
 *
 * A streak straddling New Year is deliberately truncated at the boundary: the
 * caller only hands us days inside the recap year, and "your longest streak in
 * 2026" is the honest claim for a 2026 card.
 */
function longestWeekStreak(dayKeys: Iterable<string>): number {
  const weeks = [...new Set([...dayKeys].map(weekStartKey))].sort()
  if (weeks.length === 0) return 0
  let longest = 1
  let current = 1
  for (let i = 1; i < weeks.length; i++) {
    if (weeksBetween(weeks[i - 1], weeks[i]) === 1) {
      current++
      if (current > longest) longest = current
    } else {
      current = 1
    }
  }
  return longest
}

/**
 * Exercise-days inside `year` on which this exercise's best e1RM beat every
 * earlier day's.
 *
 * Derived from e1RM history rather than read off the progression store's
 * `xpPerSet` flags (which `buildSessionSummary` prefers for a single day). Over
 * a whole year those flags only exist for sets logged while progression was
 * enabled, so mixing the two sources would make the count depend on when a
 * setting was toggled. One consistent derivation across the year is the claim
 * the card can defend.
 *
 * **An exercise's first day is never a PR**, matching the rule the rest of the
 * app scores by: `scoreSet` suppresses PR detection until an exercise is
 * established (`best1RM === null` → zone `new_exercise`), and
 * `buildSessionSummary`'s derived branch requires a non-null `priorMaxE1RM`.
 * Counting it would hand a lifter who tried thirty new movements thirty free
 * PRs — the number on the card has to mean what the PR badge in the app means.
 */
function prDaysInYear(ex: Exercise, year: number): number {
  const bestByDay = new Map<string, number>()
  for (const s of ex.sets) {
    const k = setDayKey(s.date)
    const prev = bestByDay.get(k)
    if (prev === undefined || s.estimated1RM > prev) bestByDay.set(k, s.estimated1RM)
  }
  const prefix = `${year}-`
  let running: number | null = null
  let count = 0
  for (const k of [...bestByDay.keys()].sort()) {
    const best = bestByDay.get(k)!
    if (running !== null && best > running && k.startsWith(prefix)) count++
    if (running === null || best > running) running = best
  }
  return count
}

/** Pure: aggregate one calendar year of training into a shareable recap. */
export function buildYearRecap(input: YearRecapInput): YearRecap {
  const { year, exercises } = input
  const toDisplay = input.toDisplayUnits ?? ((lb: number) => lb)
  const unitLabel = input.unitLabel ?? 'lbs'
  const loadFormat: SetLoadFormat = { displayWeight: toDisplay, unit: unitLabel }
  /** Convert to display units, keeping at most one decimal. */
  const cv = (lb: number) => {
    const v = toDisplay(lb)
    return Number.isInteger(v) ? v : Math.round(v * 10) / 10
  }

  const prefix = `${year}-`
  const trainingDays = new Set<string>()
  const tagSets = new Map<string, number>()
  const monthlyVolumeLb: number[] = new Array(12).fill(0)

  let totalVolumeLb = 0
  let sets = 0
  let trainedExercises = 0
  let prs = 0

  let bestLift: YearRecapLift | null = null
  let bestE1RM = -Infinity

  for (const ex of exercises) {
    let exerciseSets = 0
    let topSet: WorkoutSet | null = null
    let topE1RM = -Infinity

    for (const s of ex.sets) {
      const dayKey = setDayKey(s.date)
      if (!dayKey.startsWith(prefix)) continue

      exerciseSets++
      sets++
      trainingDays.add(dayKey)

      const volume = effectiveSetWeight(s, ex) * s.reps
      totalVolumeLb += volume
      const monthIdx = Number(dayKey.slice(5, 7)) - 1
      if (monthIdx >= 0 && monthIdx < 12) monthlyVolumeLb[monthIdx] += volume

      if (s.estimated1RM > topE1RM) {
        topE1RM = s.estimated1RM
        topSet = s
      }
    }

    if (exerciseSets === 0) continue
    trainedExercises++
    prs += prDaysInYear(ex, year)

    for (const tag of ex.tags ?? []) {
      tagSets.set(tag, (tagSets.get(tag) ?? 0) + exerciseSets)
    }

    if (topSet && topE1RM > bestE1RM) {
      bestE1RM = topE1RM
      bestLift = {
        exerciseId: ex.id,
        name: ex.name,
        loadLabel: formatSetLoad(topSet, ex, loadFormat),
        reps: topSet.reps,
        e1RM: cv(topSet.estimated1RM),
        dateKey: setDayKey(topSet.date),
      }
    }
  }

  // Ties break on the tag name so the card is deterministic run to run.
  const rankedTags = [...tagSets.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const topTag: YearRecapTag | null = rankedTags.length > 0
    ? { tag: rankedTags[0][0], sets: rankedTags[0][1] }
    : null

  const monthlyVolume = monthlyVolumeLb.map(cv)
  let busiestMonth: number | null = null
  for (let i = 0; i < 12; i++) {
    if (monthlyVolumeLb[i] > 0 && (busiestMonth === null || monthlyVolumeLb[i] > monthlyVolumeLb[busiestMonth])) {
      busiestMonth = i
    }
  }

  return {
    year,
    totalVolume: cv(totalVolumeLb),
    workouts: trainingDays.size,
    sets,
    exercises: trainedExercises,
    prs,
    bestLift,
    topTag,
    longestStreakWeeks: longestWeekStreak(trainingDays),
    monthlyVolume,
    busiestMonth,
    unitLabel,
  }
}

// ── Card-facing derivations ──────────────────────────────────────────
//
// The square and story recap cards render the same five things off the same
// `YearRecap`, so those derivations live here rather than twice in the two
// `.vue` files. The existing session-card pairs do each keep their own copies,
// but theirs genuinely differ (`WeekChartStory` headlines the day's volume
// where `WeekChartCard` headlines the week's); these were character-identical,
// and two of them are *decisions* rather than formatting — the volume
// step-down thresholds and the chart's `aria-label` sentence. A screen reader
// must not be told a different busiest month depending on which format the
// lifter exported.

export type RecapVolumeSize = 'lg' | 'md' | 'sm'

/** One headline stat cell: a big number over a small caption. */
export interface RecapStat {
  label: string
  value: string
}

/** One month column of the twelve-month volume chart. */
export interface RecapMonthBar {
  /** Single-letter month initial for the axis. */
  initial: string
  /** Bar height as a CSS percentage of the peak month. */
  height: string
}

/** The year's total volume, thousands-separated. */
export function recapVolumeLabel(recap: YearRecap): string {
  return recap.totalVolume.toLocaleString('en-US')
}

/**
 * Which type size the volume brag renders at.
 *
 * A year's volume spans four orders of magnitude (a first month vs. a full
 * year), and the number IS the brag — so it steps down in size rather than
 * being abbreviated away to "1.2M". Measured off the rendered label, not the
 * raw number, because what has to fit on the card is the drawn string.
 */
export function recapVolumeSize(recap: YearRecap): RecapVolumeSize {
  const digits = recapVolumeLabel(recap).replace(/\D/g, '').length
  if (digits >= 7) return 'sm'
  if (digits >= 6) return 'md'
  return 'lg'
}

/** The four headline stats, pluralized for a count of one. */
export function recapHeadlineStats(recap: YearRecap): RecapStat[] {
  return [
    { label: recap.workouts === 1 ? 'workout' : 'workouts', value: String(recap.workouts) },
    { label: recap.sets === 1 ? 'set' : 'sets', value: String(recap.sets) },
    { label: recap.prs === 1 ? 'PR' : 'PRs', value: String(recap.prs) },
    { label: 'week streak', value: String(recap.longestStreakWeeks) },
  ]
}

/**
 * Twelve month columns, heights as a share of the peak month.
 *
 * An untrained month keeps a 2% stub so the axis still reads as a year rather
 * than collapsing to whichever months were trained — and a year with no volume
 * at all renders twelve stubs rather than dividing by zero.
 */
export function recapMonthBars(recap: YearRecap): RecapMonthBar[] {
  const peak = Math.max(0, ...recap.monthlyVolume)
  return recap.monthlyVolume.map((v, i) => ({
    initial: MONTH_INITIALS[i],
    height: peak > 0 ? `${Math.max(2, (v / peak) * 100)}%` : '2%',
  }))
}

/** Accessible name for the month chart — the one sentence AT reads for it. */
export function recapChartLabel(recap: YearRecap): string {
  const peak = recap.busiestMonth
  return peak === null
    ? `Monthly training volume for ${recap.year}`
    : `Monthly training volume for ${recap.year}, busiest month ${MONTH_SHORT[peak]}`
}
