/**
 * AI Coach — payload builder (PURE).
 *
 * Mirrors the pure style of `buildSessionSummary` (src/lib/sessionSummary.ts):
 * takes plain data in, returns a typed `CoachPayload`, with NO Pinia/store/browser
 * dependencies (only `import type` from the stores, which is erased at compile).
 * The store-backed view passes raw data in; this module does all the analysis the
 * model needs — the full per-set log, lifetime PRs, per-set relative intensities,
 * weekly volume, consistency, and bodyweight trend.
 *
 * Two correctness notes that bit prior code:
 *  - Set/bodyweight dates MUST be bucketed via `setDayKey` (#746) — it handles both
 *    the endOfDayISO and real-time storage conventions. Never `slice(0, 10)` here.
 *  - Stored weights are in POUNDS; the user's display unit may be kg. Weights are
 *    converted via `toDisplayUnits` so the numbers the model sees match the app,
 *    and `unit` is set accordingly. Intensities/reps are unit-independent.
 *
 * Identifiers (exercise/set ids, user id) are never emitted — only training data.
 */

import type { Exercise, OverloadSuggestion } from '../stores/workout'
import type { BodyweightEntry } from '../stores/bodyweight'
import { setDayKey } from './dates'
import { computeWeeklyGoal } from './weeklyGoal'
import {
  MAX_SETS,
  MAX_PR_ITEMS,
  MAX_VOLUME_ITEMS,
  MAX_FOCUS_ITEMS,
  MAX_SESSION_ITEMS,
  type CoachPayload,
  type SetRecord,
  type PRItem,
  type VolumeItem,
  type ConsistencyBlock,
  type FocusItem,
  type BodyweightBlock,
  type SessionDigest,
  type WeightUnit,
} from './aiCoach'

/** Default history window the client sends — long enough for real progression analysis. */
export const DEFAULT_WINDOW_DAYS = 112 // ~16 weeks

/** An exercise paired with its store-computed overload suggestion (the one non-pure input). */
export interface ExerciseOverload {
  exerciseName: string
  suggestion: OverloadSuggestion | null
}

export interface CoachDigestInput {
  exercises: Exercise[]
  bodyweightEntries: BodyweightEntry[]
  /** Store-computed overload suggestions (getOverloadSuggestion is store-bound). */
  overloads: ExerciseOverload[]
  /** The user's display weight unit, e.g. 'lbs' | 'kg'. */
  weightUnit: string
  /** Weekly training-days goal (1–7); 0 disables the consistency block. */
  weeklyTarget: number
  streakWeeks: number
  /** Convert a stored pound value to the display unit. Defaults to identity (lbs). */
  toDisplayUnits?: (lb: number) => number
  /** Injectable "now" for tests. */
  now?: Date
  /** History window in days (default ~16 weeks). */
  windowDays?: number
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** Local "HH:MM" for a real ISO timestamp, or undefined when absent/unparseable. */
function localTimeOfDay(iso: string | undefined): string | undefined {
  if (!iso) return undefined
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return undefined
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Local YYYY-MM-DD key for a Date (matches dates.ts's private localDayKey). */
function dayKeyOf(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Monday→today local day keys for the week containing `now`. */
function currentWeekKeys(now: Date): Set<string> {
  const dow = now.getDay() // 0=Sun
  const since = dow === 0 ? 6 : dow - 1
  const keys = new Set<string>()
  for (let i = since; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(now.getDate() - i)
    keys.add(dayKeyOf(d))
  }
  return keys
}

/**
 * Per-set context from a single chronological pass:
 *  - `isPR`: this set was an all-time e1RM PR at the moment it was performed
 *    (stays true even if a later set beat it — it reflects PR-at-execution).
 *  - `bestThen`: the best e1RM achieved up to AND including this set — the
 *    denominator for intensity-at-the-time, so a hard set early in the history
 *    isn't divided by a PR the user hadn't hit yet.
 */
function prAndIntensityContext(exercise: Exercise): Map<string, { isPR: boolean; bestThen: number }> {
  const ctx = new Map<string, { isPR: boolean; bestThen: number }>()
  const ordered = [...exercise.sets].sort((a, b) => a.date.localeCompare(b.date))
  let runningMax = 0
  for (const s of ordered) {
    const isPR = s.estimated1RM > runningMax
    if (isPR) runningMax = s.estimated1RM
    ctx.set(s.id, { isPR, bestThen: runningMax })
  }
  return ctx
}

/**
 * Build the full Coach payload from raw store data. Pure and deterministic given
 * `now`. The result is shaped to pass `validateCoachPayload` whenever there is
 * enough data; the caller decides whether to send it (MIN_SETS_FOR_REVIEW).
 */
export function buildCoachPayload(input: CoachDigestInput): CoachPayload {
  const {
    exercises,
    bodyweightEntries,
    overloads,
    weightUnit,
    weeklyTarget,
    streakWeeks,
    toDisplayUnits = (lb) => lb,
    now = new Date(),
    windowDays = DEFAULT_WINDOW_DAYS,
  } = input

  const unit: WeightUnit = weightUnit === 'kg' ? 'kg' : 'lb'
  const conv = (lb: number) => round1(toDisplayUnits(lb))

  const windowStart = new Date(now)
  windowStart.setDate(now.getDate() - windowDays)
  const windowStartKey = dayKeyOf(windowStart)
  const nowKey = dayKeyOf(now)

  // ---- sets (core ground truth) + personalRecords + per-day sessions ----
  // sortTime carries the set's real timestamp so the window can be ordered by
  // actual within-day sequence once capture lands; '' (today) keeps stable order.
  const setItems: Array<{ rec: SetRecord; sortTime: string }> = []
  const personalRecords: PRItem[] = []
  const sessionMap = new Map<string, { tags: Set<string>; setCount: number }>()

  for (const ex of exercises) {
    if (ex.sets.length === 0) continue

    const bestE1rm = ex.sets.reduce((m, s) => Math.max(m, s.estimated1RM), 0)
    const prBestSet = ex.sets.reduce((best, s) => (s.estimated1RM > best.estimated1RM ? s : best), ex.sets[0])
    const ctx = prAndIntensityContext(ex)

    personalRecords.push({
      exerciseName: ex.name,
      bestE1rm: conv(bestE1rm),
      bestWeight: conv(prBestSet.weight),
      bestReps: prBestSet.reps,
      date: setDayKey(prBestSet.date),
    })

    for (const s of ex.sets) {
      const key = setDayKey(s.date)
      if (key < windowStartKey || key > nowKey) continue

      // Per-day session summary (split + cadence).
      let session = sessionMap.get(key)
      if (!session) {
        session = { tags: new Set<string>(), setCount: 0 }
        sessionMap.set(key, session)
      }
      session.setCount++
      for (const tag of ex.tags ?? []) session.tags.add(tag)

      const c = ctx.get(s.id)
      const rec: SetRecord = {
        exerciseName: ex.name,
        weight: conv(s.weight),
        reps: s.reps,
        e1rm: conv(s.estimated1RM),
        date: key,
      }
      // Intensity relative to the best e1RM AS OF this set (not the lifetime best),
      // so historical sets reflect how hard they were when performed.
      if (c && c.bestThen > 0) rec.intensityPct = Math.round((s.weight / c.bestThen) * 100)
      if (c?.isPR) rec.isPR = true
      const t = localTimeOfDay(s.createdAt)
      if (t) rec.timeOfDay = t
      setItems.push({ rec, sortTime: s.createdAt ?? '' })
    }
  }

  // Order by day, then by real log time within the day when available (stable
  // — preserving per-exercise logged order — when timestamps aren't captured yet).
  setItems.sort((a, b) => {
    const d = (a.rec.date ?? '').localeCompare(b.rec.date ?? '')
    return d !== 0 ? d : a.sortTime.localeCompare(b.sortTime)
  })
  const orderedSets = setItems.map((it) => it.rec)
  const cappedSets = orderedSets.length > MAX_SETS ? orderedSets.slice(orderedSets.length - MAX_SETS) : orderedSets

  // Highest-impact PRs first, capped.
  personalRecords.sort((a, b) => b.bestE1rm - a.bestE1rm)
  const cappedPRs = personalRecords.slice(0, MAX_PR_ITEMS)

  // ---- volume (current week, sets per tag) ----
  const weekKeys = currentWeekKeys(now)
  const tagCounts: Record<string, number> = {}
  for (const ex of exercises) {
    if (!ex.tags || ex.tags.length === 0) continue
    let n = 0
    for (const s of ex.sets) {
      if (weekKeys.has(setDayKey(s.date))) n++
    }
    if (n === 0) continue
    for (const tag of ex.tags) tagCounts[tag] = (tagCounts[tag] || 0) + n
  }
  const volume: VolumeItem[] = Object.entries(tagCounts)
    .map(([tagName, weeklyVolume]) => ({ tagName, weeklyVolume }))
    .sort((a, b) => b.weeklyVolume - a.weeklyVolume)
    .slice(0, MAX_VOLUME_ITEMS)

  // ---- consistency ----
  let consistency: ConsistencyBlock | null = null
  if (weeklyTarget > 0) {
    const goal = computeWeeklyGoal(exercises, weeklyTarget, now)
    consistency = {
      workoutDaysThisWeek: goal.trained,
      weeklyTarget: goal.target,
      streakWeeks,
      goalMet: goal.met,
    }
  }

  // ---- focus (high-confidence overload suggestions only) ----
  const focus: FocusItem[] = overloads
    .filter((o): o is { exerciseName: string; suggestion: OverloadSuggestion } =>
      o.suggestion !== null && o.suggestion.confidence === 'high')
    .map((o) => ({
      exerciseName: o.exerciseName,
      type: o.suggestion.type,
      suggestedWeight: conv(o.suggestion.weight),
      suggestedReps: o.suggestion.reps,
      reason: o.suggestion.reason,
    }))
    .slice(0, MAX_FOCUS_ITEMS)

  // ---- bodyweight (trend + delta over the window) ----
  let bodyweight: BodyweightBlock | null = null
  const windowEntries = bodyweightEntries
    .filter((e) => {
      const key = setDayKey(e.date)
      return key >= windowStartKey && key <= nowKey
    })
    .sort((a, b) => (setDayKey(a.date) < setDayKey(b.date) ? -1 : 1))
  if (windowEntries.length >= 2) {
    const first = windowEntries[0].weight
    const last = windowEntries[windowEntries.length - 1].weight
    const deltaLbs = round1(toDisplayUnits(last) - toDisplayUnits(first))
    const trendDirection = deltaLbs > 0.05 ? 'up' : deltaLbs < -0.05 ? 'down' : 'flat'
    bodyweight = { trendDirection, deltaLbs }
  }

  // ---- sessions (oldest first; rest-day cadence = gaps between dates, split = tags/day) ----
  const allSessions: SessionDigest[] = Array.from(sessionMap.entries())
    .map(([date, s]) => ({ date, tags: Array.from(s.tags), setCount: s.setCount }))
    .sort((a, b) => a.date.localeCompare(b.date))
  const sessions = allSessions.length > MAX_SESSION_ITEMS
    ? allSessions.slice(allSessions.length - MAX_SESSION_ITEMS)
    : allSessions

  return {
    unit,
    sets: cappedSets,
    personalRecords: cappedPRs,
    volume,
    consistency,
    focus,
    bodyweight,
    sessions,
  }
}
