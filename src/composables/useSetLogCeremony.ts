/**
 * useSetLogCeremony — everything that happens AFTER a set is written (LIFT-1448).
 *
 * `WorkoutTracker.saveSet` used to inline the whole post-write pipeline: XP
 * scoring and attribution, the arbitration between three celebration surfaces,
 * their analytics events, the haptic, and the rest-timer autostart. Every new
 * engagement moment had to be threaded through that one function by hand, and
 * the exclusion rules between the surfaces lived only as prose comments — the
 * shape that had already shipped a double haptic and a save with none at all
 * (see `src/lib/setCeremony.ts` for both).
 *
 * The split is: `decideSetCeremony` (pure, testable, owns the exclusion matrix)
 * decides WHAT happens; this composable performs it, in the one order the
 * pipeline actually requires; `saveSet` keeps validation, the store write and
 * the form reset.
 *
 * ## Ordering
 *
 * XP is attributed BEFORE the celebration, because the PR burst's share card is
 * built from `progressionStore.xpPerSet` and must reflect the set that just
 * earned the burst. That was a comment in `saveSet` ("the set is already
 * persisted and its XP logged above"); here it is the function body, so an
 * edit cannot reorder it by accident.
 *
 * ## Before / after
 *
 * `captureSetCeremony` and `runSetCeremony` are a pair, adjacent over one list
 * of facts, because three of them are unrecoverable once the set is in the
 * store: the pre-write baseline PR (the burst's "old" number), whether the
 * lifter had ever logged anything (#762), and whether they had ever hit a PR.
 * Call `captureSetCeremony` before `store.logSet`, `runSetCeremony` after.
 */

import { useWorkoutStore, type WorkoutSet } from '../stores/workout'
import { useProgressionStore } from '../stores/progression'
import { useAnalytics } from './useAnalytics'
import { useHaptics } from './useHaptics'
import { useTheme } from './useTheme'
import { useWeightUnit } from './useWeightUnit'
import { useRestTimer } from './useRestTimer'
import { usePRBaseline } from './usePRBaseline'
import { useXPCeremony } from './useXPCeremony'
import { usePRBurst } from './usePRBurst'
import { useFirstSetCelebration } from './useFirstSetCelebration'
import { useGoalCelebration } from './useGoalCelebration'
import { scoreSet } from '../lib/setScoring'
import { applyStreakMultiplier } from '../lib/xp'
import { buildSessionSummary } from '../lib/sessionSummary'
import { computeWeeklyGoal } from '../lib/weeklyGoal'
import {
  decideGoalCelebration,
  markGoalWeekCelebrated,
  readGoalCelebrationState,
} from '../lib/goalCelebration'
import {
  decideSetCeremony,
  hasCelebratedFirstSet,
  markFirstSetCelebrated,
  type SetCeremonyDecision,
  type SetCeremonyGoal,
  type SetCeremonyHaptic,
} from '../lib/setCeremony'

/** Facts that only exist before the set is written. */
export interface SetCeremonySnapshot {
  /** Baseline-relative best e1RM for the exercise, BEFORE this set landed. */
  oldE1RM: number
  /** The lifter had logged no set anywhere, and the one-time flag is unburnt (#762). */
  isFirstSetEver: boolean
  /** The lifter had never hit a PR before — only the PR lane may read this. */
  isFirstPR: boolean
}

/** What was written, as the caller knows it. */
export interface SetCeremonyInput {
  exerciseId: string
  exerciseName: string
  /** Canonical-lbs load written for this set. */
  weightLbs: number
  reps: number
  /** The set's stored date — the day XP scoring and the share card are keyed to. */
  rawDate: string
  /** The save beat the PR baseline. */
  wasPR: boolean
  /**
   * The row the store just appended. Null only when the write produced no set
   * (defensive): XP is then skipped, exactly as before, while the celebration
   * lanes still run.
   */
  loggedSet: WorkoutSet | null
}

export interface SetLogCeremonyHost {
  /** Start the rest timer. The host owns the controller instance. */
  startRestTimer: () => void
}

export interface UseSetLogCeremonyReturn {
  captureSetCeremony: (exerciseId: string) => SetCeremonySnapshot
  runSetCeremony: (input: SetCeremonyInput, before: SetCeremonySnapshot) => SetCeremonyDecision
}

export function useSetLogCeremony(host: SetLogCeremonyHost): UseSetLogCeremonyReturn {
  const store = useWorkoutStore()
  const progressionStore = useProgressionStore()
  const { logEvent } = useAnalytics()
  const { impactLight, impactHeavy, notifySuccess } = useHaptics()
  const { currentTheme } = useTheme()
  const { weightUnit, displayWeight } = useWeightUnit()
  const { restTimerEnabled, restTimerAutoStart } = useRestTimer()
  const { prBaselineDate } = usePRBaseline()
  const { logSetXPCeremony } = useXPCeremony()
  const { presentPRBurst } = usePRBurst()
  const { presentFirstSetCelebration } = useFirstSetCelebration()
  const { presentGoalCelebration } = useGoalCelebration()

  function captureSetCeremony(exerciseId: string): SetCeremonySnapshot {
    return {
      oldE1RM: store.getExercisePR(exerciseId, prBaselineDate.value),
      isFirstSetEver:
        !hasCelebratedFirstSet() && store.exercises.every(e => e.sets.length === 0),
      isFirstPR: progressionStore.totalPRCount === 0,
    }
  }

  /**
   * Score the just-logged set and run the XP attribution ceremony.
   * Scored against the exercise's OTHER sets — the new row is already in the
   * array by the time this runs.
   */
  function _attributeXP(input: SetCeremonyInput): void {
    const loggedSet = input.loggedSet
    if (!loggedSet) return
    const exercise = store.exercises.find(e => e.id === input.exerciseId)
    if (!exercise) return

    const otherSets = exercise.sets.filter(s => s.id !== loggedSet.id)
    const { best1RM, isPR, isTie, isRepPR, zone, baseXP } = scoreSet({
      priorSets: otherSets,
      estimated1RM: loggedSet.estimated1RM,
      weightLbs: loggedSet.weight,
      reps: loggedSet.reps,
      dateKey: input.rawDate,
      baseline: prBaselineDate.value,
    })

    const mult = progressionStore.currentMultiplier
    let xp = applyStreakMultiplier(baseXP, progressionStore.streakHistory, new Date().toISOString())
    // No history entry for the current week yet — apply currentMultiplier directly.
    if (xp === baseXP && mult > 1) {
      xp = Math.round(baseXP * mult)
    }

    logSetXPCeremony({
      setId: loggedSet.id,
      exerciseId: input.exerciseId,
      xp,
      baseXP,
      zone,
      isPR,
      isTie,
      isRepPR,
      activeTheme: currentTheme.value,
      estimated1RM: loggedSet.estimated1RM,
      exerciseBest1RM: best1RM,
      streakMultiplier: mult,
      // A theme unlock is its own moment, fired on a delay from inside the
      // ceremony — it never lands back-to-back with the save haptic below.
      onUnlock: notifySuccess,
    })
  }

  /**
   * The weekly-goal celebration that is due right now, or null.
   * Consulted lazily by `decideSetCeremony`: resolving it is what leads to
   * burning the week, so a PR or first-set save must never ask.
   */
  function _resolveDueGoal(): SetCeremonyGoal | null {
    if (!progressionStore.progressionEnabled) return null
    const info = computeWeeklyGoal(store.exercises, progressionStore.weeklyTarget)
    const due = decideGoalCelebration(
      info.met,
      progressionStore.streakWeeks,
      readGoalCelebrationState().lastCelebratedWeek,
    )
    return due ? { ...due, target: info.target } : null
  }

  /** Present the one celebration the decision picked, with its analytics. */
  function _present(
    decision: SetCeremonyDecision,
    input: SetCeremonyInput,
    before: SetCeremonySnapshot,
  ): void {
    if (decision.celebration === 'pr') {
      // The burst reads old → new against the PR baseline, so `newE1RM` has to
      // be re-read after the write. `presentPRBurst` owns the celebrations
      // opt-out and the new <= old guard.
      presentPRBurst({
        exerciseName: input.exerciseName,
        oldE1RM: before.oldE1RM,
        newE1RM: store.getExercisePR(input.exerciseId, prBaselineDate.value),
        setWeight: input.weightLbs,
        setReps: input.reps,
        isFirstPR: before.isFirstPR,
        // Built here rather than inside PRBurst: the presentational component
        // never reaches into stores (LIFT-916). XP is already attributed above,
        // so the card reflects the set that earned it.
        shareSummary: buildSessionSummary({
          rawDate: input.rawDate,
          exercises: store.exercises,
          xpPerSet: progressionStore.xpPerSet,
          streakWeeks: progressionStore.streakWeeks,
          toDisplayUnits: displayWeight,
          unitLabel: weightUnit.value,
        }),
      })
      if (before.isFirstPR) logEvent('first_pr', { exercise: input.exerciseName })
      return
    }

    if (decision.celebration === 'first-set') {
      markFirstSetCelebrated()
      logEvent('first_set', { exercise: input.exerciseName })
      presentFirstSetCelebration()
      return
    }

    if (decision.celebration === 'goal' && decision.goal) {
      const { weekKey, streak, milestone, target } = decision.goal
      markGoalWeekCelebrated(weekKey)
      presentGoalCelebration({ streak, milestone, target })
      logEvent('weekly_goal_celebrated', { streak, milestone })
      // A streak-tier crossing (2/4/8/12-week multiplier bump) is a distinct
      // progression-depth signal from simply hitting the goal (#796).
      if (milestone) logEvent('streak_milestone', { streak, target })
    }
  }

  /**
   * Fire the ONE haptic the decision chose. `heavy-success` is a single
   * emphasis pattern, not two competing haptics — the failure this replaced was
   * two independent `notifySuccess()` calls from two owners.
   */
  function _fireHaptic(pattern: SetCeremonyHaptic): void {
    if (pattern === 'heavy-success') {
      impactHeavy()
      notifySuccess()
      return
    }
    if (pattern === 'success') {
      notifySuccess()
      return
    }
    impactLight()
  }

  function runSetCeremony(
    input: SetCeremonyInput,
    before: SetCeremonySnapshot,
  ): SetCeremonyDecision {
    _attributeXP(input)

    const decision = decideSetCeremony({
      wasPR: input.wasPR,
      isFirstSetEver: before.isFirstSetEver,
      isFirstPR: before.isFirstPR,
      resolveGoal: _resolveDueGoal,
    })

    _present(decision, input, before)
    _fireHaptic(decision.haptic)

    if (restTimerEnabled.value && restTimerAutoStart.value) {
      host.startRestTimer()
    }

    return decision
  }

  return { captureSetCeremony, runSetCeremony }
}
