/**
 * XP Instrumentation
 *
 * Logs XP events and weekly snapshots to Supabase for threshold tuning.
 * Fire-and-forget — no client-side impact if Supabase is unavailable.
 *
 * Issue #124
 */

import { supabase } from './supabase'
import { syncQueue } from './syncQueue'

export interface XPEventData {
  userId: string | null
  setId: string
  exerciseId: string
  setDate: string
  baseXP: number
  streakMultiplier: number
  finalXP: number
  isPR: boolean
  isTie: boolean
  isRepPR: boolean
  zone: 'warmup' | 'working' | 'pr' | 'tie' | 'new_exercise' | 'bodyweight'
}

export interface WeeklySnapshotData {
  userId: string | null
  weekStart: string
  totalXP: number
  weekXP: number
  streakWeeks: number
  trainingDays: number
  weeklyTarget: number
  themesUnlocked: number
}

/** Log a per-set XP event to Supabase. */
export function logXPEvent(data: XPEventData): void {
  if (!supabase || !data.userId) return

  syncQueue.enqueue(`xp-event:${data.setId}`, () =>
    supabase!.from('xp_events').upsert({
      set_id: data.setId,
      user_id: data.userId,
      exercise_id: data.exerciseId,
      set_date: data.setDate,
      base_xp: data.baseXP,
      streak_multiplier: data.streakMultiplier,
      final_xp: data.finalXP,
      is_pr: data.isPR,
      is_tie: data.isTie,
      is_rep_pr: data.isRepPR,
      zone: data.zone,
    })
  )
}

/** Log a bodyweight XP event to Supabase. */
export function logBodyweightXPEvent(userId: string | null, date: string, xp: number): void {
  if (!supabase || !userId) return

  syncQueue.enqueue(`xp-event:bw:${date}`, () =>
    supabase!.from('xp_events').upsert({
      set_id: `bw-${date}`,
      user_id: userId,
      set_date: date,
      base_xp: xp,
      streak_multiplier: 1,
      final_xp: xp,
      is_pr: false,
      is_tie: false,
      is_rep_pr: false,
      zone: 'bodyweight',
    })
  )
}

/** Log a weekly progression snapshot to Supabase. */
export function logWeeklySnapshot(data: WeeklySnapshotData): void {
  if (!supabase || !data.userId) return

  syncQueue.enqueue(`progression-snapshot:${data.weekStart}`, () =>
    supabase!.from('progression_snapshots').upsert({
      user_id: data.userId,
      week_start: data.weekStart,
      total_xp: data.totalXP,
      week_xp: data.weekXP,
      streak_weeks: data.streakWeeks,
      training_days: data.trainingDays,
      weekly_target: data.weeklyTarget,
      themes_unlocked: data.themesUnlocked,
    })
  )
}
