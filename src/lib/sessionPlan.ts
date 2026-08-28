/**
 * Guided session plan — the day-level "repeat your last session" view (#1256).
 *
 * Beta feedback asked for Strong-style workout templates ("load up your entire
 * day workout in one session"). Lift's answer stays authoring-free: history IS
 * the template. Given the exercises in the current filter scope (gym + tags),
 * the plan is the most recent prior day any of them was trained; each exercise
 * carries that day's set count as its target, its heaviest set as the
 * headline, and live progress from today's logged sets.
 *
 * Pure and framework-free: `todayKey` is a parameter (no clock reads), and
 * every set date is bucketed through `setDayKey` (#746 — set dates carry two
 * storage conventions; never derive a day via slice(0, 10) or toLocalDateKey
 * directly).
 */

import type { Exercise } from '../stores/workout'
import { setDayKey } from './dates'

export interface SessionPlanItem {
  exerciseId: string
  name: string
  /** Sets performed on the reference day — today's target. */
  plannedSets: number
  /** Sets logged today (uncapped — can exceed plannedSets). */
  doneSets: number
  /** Heaviest set of the reference day (raw lbs; caller converts/formats). */
  topSet: { weightLbs: number; reps: number } | null
}

export interface SessionPlan {
  /** Local day key (YYYY-MM-DD) of the reference session. */
  day: string
  /** Exercises trained on the reference day, in the input list's order. */
  items: SessionPlanItem[]
  plannedTotal: number
  /** Progress toward the plan — per-item done capped at planned, summed. */
  doneTotal: number
}

/**
 * Build the plan for a scope of exercises, or null when the scope has no
 * training day strictly before `todayKey` (nothing to repeat). Input order is
 * preserved so plan rows don't reshuffle as today's sets land — callers must
 * pass a list whose order is insensitive to today's logging (i.e. NOT the
 * today-inclusive recency sort).
 */
export function buildSessionPlan(exercises: readonly Exercise[], todayKey: string): SessionPlan | null {
  // Reference day: the most recent day strictly before today on which any
  // in-scope exercise was trained.
  let refDay = ''
  for (const ex of exercises) {
    for (const s of ex.sets) {
      const day = setDayKey(s.date)
      if (day < todayKey && day > refDay) refDay = day
    }
  }
  if (!refDay) return null

  const items: SessionPlanItem[] = []
  let plannedTotal = 0
  let doneTotal = 0
  for (const ex of exercises) {
    let planned = 0
    let done = 0
    let top: { weightLbs: number; reps: number } | null = null
    for (const s of ex.sets) {
      const day = setDayKey(s.date)
      if (day === refDay) {
        planned++
        if (!top || s.weight > top.weightLbs) top = { weightLbs: s.weight, reps: s.reps }
      } else if (day === todayKey) {
        done++
      }
    }
    if (planned === 0) continue
    items.push({ exerciseId: ex.id, name: ex.name, plannedSets: planned, doneSets: done, topSet: top })
    plannedTotal += planned
    doneTotal += Math.min(done, planned)
  }
  return { day: refDay, items, plannedTotal, doneTotal }
}
