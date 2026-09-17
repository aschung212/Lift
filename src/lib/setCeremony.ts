/**
 * Post-save ceremony arbitration (LIFT-1448).
 *
 * A saved set can earn at most ONE celebration surface, and exactly one haptic.
 * Those exclusion rules used to exist only as prose comments inside
 * `WorkoutTracker.saveSet`, spread across four `if`s that each had to be
 * re-read (and re-derived) by anyone adding a fifth engagement moment. Two
 * defects had already shipped from that arrangement:
 *
 *  1. **Stacked haptics.** The PR lane fired `notifySuccess()` at the call site
 *     AND again inside `presentPRBurst`; two native haptics fired back-to-back
 *     collapse into a muddy / truncated buzz on Capacitor/iOS — the very
 *     failure the comment beside the light tap warned about.
 *  2. **A save with no haptic at all.** The first-set activation overlay fired
 *     its haptic *inside* the present call, which no-ops under the
 *     `experience.prCelebrations` opt-out — and it also suppressed the light
 *     tap. A brand-new user with celebrations off got silence on the one save
 *     the app most wants to feel good.
 *
 * So the haptic is decided HERE, with the celebration, and fired exactly once
 * by `useSetLogCeremony`; the celebration composables are pure presentation.
 * The rule the matrix encodes: **the haptic reflects what the lifter earned,
 * not whether a surface was drawn for it.** A PR under the celebrations
 * opt-out already behaved that way (it kept its success buzz while the burst
 * stayed hidden) and the other lanes now match, rather than each lane deciding
 * for itself.
 *
 * Precedence, highest first:
 *   PR → first-ever set → weekly goal → nothing.
 *
 * `resolveGoal` is a **thunk on purpose**: it is consulted only when the save
 * actually reaches the goal lane. The weekly-goal celebration is once-per-week
 * bookkeeping (`markGoalWeekCelebrated`), so resolving it on a PR save would
 * burn the week on a banner that was never shown — the original code skipped
 * the whole `maybeCelebrateWeeklyGoal` body for the same reason, leaving the
 * week unmarked so the banner still fires on the next non-PR set.
 */

import type { GoalCelebrationDecision } from './goalCelebration'

/**
 * Device-local one-time flag for the first-set activation moment (#762).
 * Device-local by design, like the goal-celebration week key and the overload
 * nudge: a first-save celebration is a momentary per-device experience, not
 * synced account state.
 */
export const FIRST_SET_CELEBRATED_KEY = 'first-set-celebrated'

/** Which single celebration surface the save earned, if any. */
export type SetCelebration = 'pr' | 'first-set' | 'goal' | 'none'

/**
 * The one haptic pattern a save fires. `heavy-success` is the deliberate
 * two-call emphasis pattern (impactHeavy + notifySuccess) the first PR and a
 * streak-tier crossing already used — it is one *pattern*, not two competing
 * haptics, which is what the muddy-buzz failure was.
 */
export type SetCeremonyHaptic = 'light' | 'success' | 'heavy-success'

/** A weekly-goal celebration that is due, plus the copy it needs. */
export interface SetCeremonyGoal extends GoalCelebrationDecision {
  /** The user's weekly training-days target — banner copy only. */
  target: number
}

export interface SetCeremonyContext {
  /** The just-logged set beat the PR baseline. */
  wasPR: boolean
  /** The lifter had logged no set anywhere before this one (#762). */
  isFirstSetEver: boolean
  /** The lifter had never hit a PR before this one — drives the heavier pattern. */
  isFirstPR: boolean
  /**
   * Resolves the due weekly-goal celebration, or null when none is due.
   * Called at most once, and ONLY when the save reaches the goal lane.
   */
  resolveGoal: () => SetCeremonyGoal | null
}

export interface SetCeremonyDecision {
  celebration: SetCelebration
  /** Populated only when `celebration === 'goal'`. */
  goal: SetCeremonyGoal | null
  haptic: SetCeremonyHaptic
}

/**
 * Pick the single celebration a saved set earns, and the single haptic that
 * goes with it. Total over the context: every save returns exactly one
 * celebration (possibly `'none'`) and exactly one haptic (never none).
 */
export function decideSetCeremony(ctx: SetCeremonyContext): SetCeremonyDecision {
  // A PR is the full-bleed takeover and outranks everything — including a
  // first-ever set, which can't be a PR anyway (a PR needs a prior established
  // best), so this ordering only ever settles a caller that got that wrong.
  if (ctx.wasPR) {
    return { celebration: 'pr', goal: null, haptic: ctx.isFirstPR ? 'heavy-success' : 'success' }
  }
  // The activation moment: a new lifter's first save is their "aha", and two
  // full-screen moments must never stack, so it also suppresses the goal banner.
  if (ctx.isFirstSetEver) {
    return { celebration: 'first-set', goal: null, haptic: 'success' }
  }
  const goal = ctx.resolveGoal()
  if (goal) {
    return { celebration: 'goal', goal, haptic: goal.milestone ? 'heavy-success' : 'success' }
  }
  // The common path: a routine set gets the routine light tap.
  return { celebration: 'none', goal: null, haptic: 'light' }
}

/**
 * Has the one-time first-set activation moment already fired on this device?
 * A bare `'true'` string, not JSON — `loadJSON` would `JSON.parse` it into a
 * boolean and the `=== 'true'` comparison the flag has always used would never
 * match, silently re-arming the moment for every existing user.
 */
export function hasCelebratedFirstSet(): boolean {
  try {
    return localStorage.getItem(FIRST_SET_CELEBRATED_KEY) === 'true'
  } catch {
    // Storage denied (Safari private mode) — treat as "not yet celebrated";
    // the write below will fail too, so the moment is at worst repeated.
    return false
  }
}

/** Burn the one-time first-set flag. Best-effort, like the goal week key. */
export function markFirstSetCelebrated(): void {
  try {
    localStorage.setItem(FIRST_SET_CELEBRATED_KEY, 'true')
  } catch {
    /* best-effort — a failed write just means the moment may fire again */
  }
}
