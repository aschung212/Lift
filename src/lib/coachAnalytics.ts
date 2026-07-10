/**
 * AI Coach — derived analytics (PURE) (#931 phase B).
 *
 * The BYO export (and later the server) is a single LLM call with no compute:
 * making the model do arithmetic over hundreds of sets drifts on exactly the
 * numbers users care about. So the app pre-computes the analyses here and ships
 * them as the payload's `derived` block; the prompt tells the model to trust
 * these over its own math and synthesize instead of calculating.
 *
 * Mirrors `coachDigest.ts` conventions:
 *  - Pure: plain data in, typed block out; `import type` only from stores.
 *  - Set dates bucketed via `setDayKey` (#746) — never `slice(0, 10)`.
 *  - Stored weights are POUNDS; converted via `toDisplayUnits` so derived numbers
 *    match the rest of the payload.
 *
 * Honesty constraints baked in:
 *  - e1RM-based claims carry reliability flags: a window-best set at >10 reps is
 *    an inflated estimate; machine/bodyweight lifts aren't comparable to external
 *    strength standards. Classification is a NAME HEURISTIC (`classifyExercise`)
 *    — deliberately conservative, `unknown` when unsure; upgradeable to a real
 *    per-exercise equipment field later without changing this contract.
 *  - `exerciseOrder` computes ONLY from sets with a real `createdAt` timestamp.
 *    For untimestamped sets, within-day order across exercises is array-iteration
 *    order, not performed order — feeding that to the model would fabricate data.
 */

import type { Exercise, WorkoutSet } from '../stores/workout'
import { setDayKey, localDateKey, daysBetweenISO } from './dates'
import {
  MAX_PROGRESSION_ITEMS,
  MAX_RELIABLE_1RM_ITEMS,
  MAX_RAMP_ITEMS,
  MAX_MUSCLE_STAT_ITEMS,
  MAX_ORDER_ITEMS,
  type DerivedAnalytics,
  type ProgressionItem,
  type Reliable1RMItem,
  type WarmupRampItem,
  type MuscleVolumeItem,
  type MuscleFrequencyItem,
  type ExerciseOrderItem,
  type ReliabilityFlag,
} from './aiCoach'

// ---- Exercise classification (name heuristic) ----

export type ExerciseKind = 'free_weight' | 'machine' | 'bodyweight' | 'unknown'

/** Substrings that mark a lift as machine/cable-loaded (not standards-comparable). */
const MACHINE_MARKERS = [
  'machine', 'cable', 'smith', 'pulldown', 'pull-down', 'pushdown', 'push-down',
  'leg press', 'leg extension', 'leg curl', 'hack squat', 'pec deck', 'pec fly',
  'chest press', 'shoulder press machine', 'seated row', 'face pull', 'lat raise cable',
  'hip abduction', 'hip adduction', 'calf raise machine', 'assisted',
]

/** Substrings that mark a bodyweight movement (load = the athlete, not the bar). */
const BODYWEIGHT_MARKERS = [
  'pull-up', 'pull up', 'pullup', 'chin-up', 'chin up', 'chinup',
  'push-up', 'push up', 'pushup', 'dip', 'muscle-up', 'muscle up',
  'plank', 'sit-up', 'sit up', 'crunch', 'leg raise', 'bodyweight',
]

/** Substrings that mark a barbell/dumbbell lift (standards-comparable). */
const FREE_WEIGHT_MARKERS = [
  'barbell', 'dumbbell', 'db ', ' bb ', 'bench press', 'incline press', 'overhead press',
  'ohp', 'squat', 'deadlift', 'rdl', 'romanian', 'row', 'curl', 'press', 'lunge',
  'shrug', 'snatch', 'clean', 'jerk', 'good morning', 'hip thrust', 'skullcrusher',
  'skull crusher', 'lateral raise', 'front raise', 'fly', 'pullover', 'kettlebell',
]

/**
 * Classify by name. Order matters: machine markers win (a "seated row" is a cable
 * stack even though "row" is a free-weight marker), then bodyweight, then free
 * weight. Anything else is `unknown` — conservatively excluded from
 * standards-comparable outputs rather than guessed.
 */
export function classifyExercise(name: string): ExerciseKind {
  const n = ` ${name.toLowerCase().trim()} `
  if (MACHINE_MARKERS.some((m) => n.includes(m))) return 'machine'
  if (BODYWEIGHT_MARKERS.some((m) => n.includes(m))) return 'bodyweight'
  if (FREE_WEIGHT_MARKERS.some((m) => n.includes(m))) return 'free_weight'
  return 'unknown'
}

// ---- Small numeric helpers ----

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// ---- Input ----

export interface DerivedAnalyticsInput {
  exercises: Exercise[]
  /** Latest bodyweight in POUNDS within the window, or null (opt-out / no data). */
  bodyweightLb?: number | null
  /** Convert a stored pound value to the display unit. Defaults to identity (lbs). */
  toDisplayUnits?: (lb: number) => number
  now?: Date
  windowDays?: number
}

/** Per-exercise sets within the window, grouped by training day (day keys sorted asc). */
interface ExerciseWindow {
  exercise: Exercise
  kind: ExerciseKind
  /** dayKey → sets in array (≈ logged) order. */
  days: Map<string, WorkoutSet[]>
  dayKeys: string[]
  all: WorkoutSet[]
}

/**
 * Build the `derived` block. Pure and deterministic given `now`. Every list is
 * capped to the contract limits so the result always passes `validateCoachPayload`.
 */
export function buildDerivedAnalytics(input: DerivedAnalyticsInput): DerivedAnalytics {
  const {
    exercises,
    bodyweightLb = null,
    toDisplayUnits = (lb) => lb,
    now = new Date(),
    windowDays = 112,
  } = input
  const conv = (lb: number) => round1(toDisplayUnits(lb))

  const windowStart = new Date(now)
  windowStart.setDate(now.getDate() - windowDays)
  const windowStartKey = localDateKey(windowStart)
  const nowKey = localDateKey(now)

  // ---- window + group ----
  const windows: ExerciseWindow[] = []
  for (const ex of exercises) {
    const days = new Map<string, WorkoutSet[]>()
    for (const s of ex.sets) {
      const key = setDayKey(s.date)
      if (key < windowStartKey || key > nowKey) continue
      const bucket = days.get(key)
      if (bucket) bucket.push(s)
      else days.set(key, [s])
    }
    if (days.size === 0) continue
    windows.push({
      exercise: ex,
      kind: classifyExercise(ex.name),
      days,
      dayKeys: Array.from(days.keys()).sort(),
      all: Array.from(days.values()).flat(),
    })
  }

  // Distinct training weeks across ALL exercises — the denominator for weekly
  // averages (weeks actually trained, not calendar weeks in the window).
  const allDayKeys = new Set<string>()
  for (const w of windows) for (const k of w.dayKeys) allDayKeys.add(k)
  const weeksTrained = countIsoWeeks(allDayKeys)

  // ---- per-exercise progression (needs ≥2 training days) ----
  const progression: ProgressionItem[] = []
  for (const w of windows) {
    if (w.dayKeys.length < 2) continue
    const firstDay = w.days.get(w.dayKeys[0])!
    const lastDay = w.days.get(w.dayKeys[w.dayKeys.length - 1])!
    const bestOf = (sets: WorkoutSet[]) => sets.reduce((m, s) => Math.max(m, s.estimated1RM), 0)
    const firstE1rm = bestOf(firstDay)
    const recentE1rm = bestOf(lastDay)
    const windowBestSet = w.all.reduce((b, s) => (s.estimated1RM > b.estimated1RM ? s : b), w.all[0])
    const spanDays = daysBetweenISO(w.dayKeys[0], w.dayKeys[w.dayKeys.length - 1])
    const gainLb = recentE1rm - firstE1rm

    const flags: ReliabilityFlag[] = []
    if (windowBestSet.reps > 10) flags.push('high_rep_estimate')
    if (w.kind === 'machine') flags.push('machine')
    if (w.kind === 'bodyweight') flags.push('bodyweight')

    const entry: ProgressionItem = {
      exerciseName: w.exercise.name,
      sessions: w.dayKeys.length,
      spanDays,
      firstE1rm: conv(firstE1rm),
      bestE1rm: conv(bestOf(w.all)),
      recentE1rm: conv(recentE1rm),
      gain: conv(gainLb),
      gainPct: firstE1rm > 0 ? round1((gainLb / firstE1rm) * 100) : null,
      gainPerWeek: spanDays > 0 ? conv(gainLb / (spanDays / 7)) : 0,
    }
    if (flags.length > 0) entry.flags = flags
    progression.push(entry)
  }
  // Most-trained lifts first — those are the ones a review should cover.
  progression.sort((a, b) => b.sessions - a.sessions)
  const perExerciseProgression = progression.slice(0, MAX_PROGRESSION_ITEMS)

  // ---- reliable 1RM (free-weight lifts, best set at ≤6 reps) ----
  const reliable: Reliable1RMItem[] = []
  const bodyweightDisplay = bodyweightLb !== null && bodyweightLb > 0 ? toDisplayUnits(bodyweightLb) : null
  for (const w of windows) {
    if (w.kind !== 'free_weight') continue
    const lowRep = w.all.filter((s) => s.reps >= 1 && s.reps <= 6)
    if (lowRep.length === 0) continue
    const best = lowRep.reduce((b, s) => (s.estimated1RM > b.estimated1RM ? s : b), lowRep[0])
    const entry: Reliable1RMItem = {
      exerciseName: w.exercise.name,
      e1rm: conv(best.estimated1RM),
      weight: conv(best.weight),
      reps: best.reps,
    }
    if (bodyweightDisplay !== null) {
      entry.bwRatio = round2(toDisplayUnits(best.estimated1RM) / bodyweightDisplay)
    }
    reliable.push(entry)
  }
  reliable.sort((a, b) => b.e1rm - a.e1rm)
  const reliable1RM = reliable.slice(0, MAX_RELIABLE_1RM_ITEMS)

  // ---- warm-up ramp (days with ≥2 sets; top set = heaviest of the day) ----
  const ramps: WarmupRampItem[] = []
  for (const w of windows) {
    const rampCounts: number[] = []
    const firstPcts: number[] = []
    for (const key of w.dayKeys) {
      const daySets = w.days.get(key)!
      if (daySets.length < 2) continue
      let topIdx = 0
      for (let i = 1; i < daySets.length; i++) {
        if (daySets[i].weight > daySets[topIdx].weight) topIdx = i
      }
      const topWeight = daySets[topIdx].weight
      if (topWeight <= 0) continue
      rampCounts.push(topIdx) // sets logged before the day's top set
      firstPcts.push((daySets[0].weight / topWeight) * 100)
    }
    if (rampCounts.length < 3) continue // need a few sessions for a stable median
    ramps.push({
      exerciseName: w.exercise.name,
      sessions: rampCounts.length,
      medianRampSets: round1(median(rampCounts)),
      medianFirstPctOfTop: Math.round(median(firstPcts)),
    })
  }
  ramps.sort((a, b) => b.sessions - a.sessions)
  const warmupRamp = ramps.slice(0, MAX_RAMP_ITEMS)

  // ---- session shape (medians across training days) ----
  const perDaySets = new Map<string, number>()
  const perDayExercises = new Map<string, Set<string>>()
  const perExerciseDaySets: number[] = []
  for (const w of windows) {
    for (const key of w.dayKeys) {
      const daySets = w.days.get(key)!
      perDaySets.set(key, (perDaySets.get(key) ?? 0) + daySets.length)
      let names = perDayExercises.get(key)
      if (!names) {
        names = new Set<string>()
        perDayExercises.set(key, names)
      }
      names.add(w.exercise.name)
      perExerciseDaySets.push(daySets.length)
    }
  }
  const sessionShape = perDaySets.size > 0
    ? {
        setsPerSessionMedian: round1(median(Array.from(perDaySets.values()))),
        exercisesPerSessionMedian: round1(median(Array.from(perDayExercises.values()).map((s) => s.size))),
        setsPerExerciseMedian: round1(median(perExerciseDaySets)),
      }
    : null

  // ---- weekly volume + frequency per muscle tag ----
  const tagSets = new Map<string, number>()
  const tagDays = new Map<string, Set<string>>()
  for (const w of windows) {
    const tags = w.exercise.tags ?? []
    if (tags.length === 0) continue
    for (const key of w.dayKeys) {
      const count = w.days.get(key)!.length
      for (const tag of tags) {
        tagSets.set(tag, (tagSets.get(tag) ?? 0) + count)
        let days = tagDays.get(tag)
        if (!days) {
          days = new Set<string>()
          tagDays.set(tag, days)
        }
        days.add(key)
      }
    }
  }
  const weeklyVolumeByMuscle: MuscleVolumeItem[] = Array.from(tagSets.entries())
    .map(([tagName, total]) => ({
      tagName,
      avgWeeklySets: weeksTrained > 0 ? round1(total / weeksTrained) : 0,
    }))
    .sort((a, b) => b.avgWeeklySets - a.avgWeeklySets)
    .slice(0, MAX_MUSCLE_STAT_ITEMS)

  const weeklyFrequencyByMuscle: MuscleFrequencyItem[] = Array.from(tagDays.entries())
    .map(([tagName, days]) => {
      const sorted = Array.from(days).sort()
      const gaps: number[] = []
      for (let i = 1; i < sorted.length; i++) gaps.push(daysBetweenISO(sorted[i - 1], sorted[i]))
      return {
        tagName,
        avgDaysPerWeek: weeksTrained > 0 ? round1(sorted.length / weeksTrained) : 0,
        medianGapDays: gaps.length > 0 ? round1(median(gaps)) : null,
      }
    })
    .sort((a, b) => b.avgDaysPerWeek - a.avgDaysPerWeek)
    .slice(0, MAX_MUSCLE_STAT_ITEMS)

  // ---- intensity + rep-range distributions (set counts) ----
  // Intensity uses the same at-the-time denominator as the payload's per-set
  // intensityPct: the best e1RM achieved up to AND including that set.
  let below60 = 0
  let from60to85 = 0
  let above85 = 0
  let anyIntensity = false
  for (const w of windows) {
    const ordered = [...w.exercise.sets].sort((a, b) => a.date.localeCompare(b.date))
    let runningMax = 0
    const bestThenById = new Map<string, number>()
    for (const s of ordered) {
      if (s.estimated1RM > runningMax) runningMax = s.estimated1RM
      bestThenById.set(s.id, runningMax)
    }
    for (const s of w.all) {
      const bestThen = bestThenById.get(s.id) ?? 0
      if (bestThen <= 0) continue
      const pct = (s.weight / bestThen) * 100
      anyIntensity = true
      if (pct < 60) below60++
      else if (pct <= 85) from60to85++
      else above85++
    }
  }
  const intensityDistribution = anyIntensity ? { below60, from60to85, above85 } : null

  let low = 0
  let mid = 0
  let high = 0
  let anySets = false
  for (const w of windows) {
    for (const s of w.all) {
      anySets = true
      if (s.reps <= 6) low++
      else if (s.reps <= 12) mid++
      else high++
    }
  }
  const repRangeDistribution = anySets ? { low, mid, high } : null

  // ---- exercise order (timestamped sets ONLY — see module doc) ----
  // Per day: order exercises by their earliest real createdAt; a day counts only
  // when ≥2 exercises have timestamps (otherwise "position" is meaningless).
  const firstTimeByDayExercise = new Map<string, Map<string, string>>()
  for (const w of windows) {
    for (const key of w.dayKeys) {
      for (const s of w.days.get(key)!) {
        if (!s.createdAt) continue
        let byExercise = firstTimeByDayExercise.get(key)
        if (!byExercise) {
          byExercise = new Map<string, string>()
          firstTimeByDayExercise.set(key, byExercise)
        }
        const prev = byExercise.get(w.exercise.name)
        if (!prev || s.createdAt < prev) byExercise.set(w.exercise.name, s.createdAt)
      }
    }
  }
  const positions = new Map<string, number[]>()
  for (const byExercise of firstTimeByDayExercise.values()) {
    if (byExercise.size < 2) continue
    const orderedNames = Array.from(byExercise.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([name]) => name)
    orderedNames.forEach((name, i) => {
      const list = positions.get(name)
      if (list) list.push(i + 1)
      else positions.set(name, [i + 1])
    })
  }
  const exerciseOrder: ExerciseOrderItem[] = Array.from(positions.entries())
    .filter(([, list]) => list.length >= 2)
    .map(([exerciseName, list]) => ({
      exerciseName,
      medianPosition: round1(median(list)),
      sessions: list.length,
    }))
    .sort((a, b) => a.medianPosition - b.medianPosition)
    .slice(0, MAX_ORDER_ITEMS)

  return {
    perExerciseProgression,
    reliable1RM,
    warmupRamp,
    sessionShape,
    weeklyVolumeByMuscle,
    weeklyFrequencyByMuscle,
    intensityDistribution,
    repRangeDistribution,
    exerciseOrder,
  }
}

/** Count distinct ISO weeks (Mon-anchored) covered by a set of local day keys. */
function countIsoWeeks(dayKeys: Set<string>): number {
  const weeks = new Set<string>()
  for (const key of dayKeys) {
    const [y, m, d] = key.split('-').map(Number)
    const date = new Date(y, (m || 1) - 1, d || 1)
    const day = date.getDay() || 7
    date.setDate(date.getDate() + 4 - day)
    const yearStart = new Date(date.getFullYear(), 0, 1)
    const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
    weeks.add(`${date.getFullYear()}-W${week}`)
  }
  return weeks.size
}
