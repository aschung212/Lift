import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import type { Exercise, WorkoutSet } from '../../stores/workout'
import { GOAL_CELEBRATION_KEY, weekKeyOf } from '../../lib/goalCelebration'
import { FIRST_SET_CELEBRATED_KEY } from '../../lib/setCeremony'

/**
 * The post-save pipeline end-to-end (LIFT-1448): which surface a save presents,
 * the ONE haptic that goes with it, the analytics it emits, and the ordering
 * the burst's share card depends on.
 *
 * `WorkoutTracker.test.ts` mounts the tracker but has never asserted a single
 * one of these — the whole exclusion matrix lived as prose in `saveSet` and was
 * untested, which is how a double haptic on every PR and a silent first save
 * both shipped.
 */

const hoisted = vi.hoisted(() => ({
  logEvent: vi.fn(),
  impactLight: vi.fn(),
  impactHeavy: vi.fn(),
  notifySuccess: vi.fn(),
  presentPRBurst: vi.fn(),
  presentFirstSetCelebration: vi.fn(),
  presentGoalCelebration: vi.fn(),
  logSetXPCeremony: vi.fn(),
  startRestTimer: vi.fn(),
}))

vi.mock('../useAnalytics', () => ({ useAnalytics: () => ({ logEvent: hoisted.logEvent }) }))
vi.mock('../useHaptics', () => ({
  useHaptics: () => ({
    impactLight: hoisted.impactLight,
    impactMedium: vi.fn(),
    impactHeavy: hoisted.impactHeavy,
    notifySuccess: hoisted.notifySuccess,
    notifyWarning: vi.fn(),
    notifyError: vi.fn(),
  }),
}))
vi.mock('../useTheme', () => ({ useTheme: () => ({ currentTheme: ref('eternal') }) }))
vi.mock('../useWeightUnit', () => ({
  useWeightUnit: () => ({
    weightUnit: ref('lbs'),
    displayWeight: (w: number) => Math.round(w),
    toLbs: (w: number) => w,
  }),
}))
vi.mock('../usePRBaseline', () => ({ usePRBaseline: () => ({ prBaselineDate: ref(null) }) }))
vi.mock('../useXPCeremony', () => ({
  useXPCeremony: () => ({ logSetXPCeremony: hoisted.logSetXPCeremony }),
}))
vi.mock('../usePRBurst', () => ({ usePRBurst: () => ({ presentPRBurst: hoisted.presentPRBurst }) }))
vi.mock('../useFirstSetCelebration', () => ({
  useFirstSetCelebration: () => ({ presentFirstSetCelebration: hoisted.presentFirstSetCelebration }),
}))
vi.mock('../useGoalCelebration', () => ({
  useGoalCelebration: () => ({ presentGoalCelebration: hoisted.presentGoalCelebration }),
}))

// Rest-timer flags: both off by default, flipped per test.
const restTimer = { enabled: ref(false), autoStart: ref(false) }
vi.mock('../useRestTimer', () => ({
  useRestTimer: () => ({
    restTimerEnabled: restTimer.enabled,
    restTimerAutoStart: restTimer.autoStart,
    setRestTimerEnabled: vi.fn(),
  }),
}))

// Minimal but faithful store doubles: the ceremony reads the exercise array
// back after the write, so `logSet` really appends.
const storeState = {
  exercises: [] as Exercise[],
  prByExercise: {} as Record<string, number>,
}
vi.mock('../../stores/workout', () => ({
  useWorkoutStore: () => ({
    get exercises() { return storeState.exercises },
    getExercisePR: (id: string) => storeState.prByExercise[id] ?? 0,
  }),
}))

const progression = {
  progressionEnabled: false,
  weeklyTarget: 3,
  streakWeeks: 0,
  streakHistory: [] as unknown[],
  currentMultiplier: 1,
  totalPRCount: 0,
  xpPerSet: {} as Record<string, number>,
}
vi.mock('../../stores/progression', () => ({ useProgressionStore: () => progression }))

vi.mock('../../lib/xp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/xp')>()
  return { ...actual, applyStreakMultiplier: (xp: number) => xp }
})

vi.mock('../../lib/setScoring', () => ({
  scoreSet: () => ({
    best1RM: 200,
    isPR: false,
    isTie: false,
    isRepPR: false,
    zone: 'working' as const,
    baseXP: 10,
  }),
}))

import { useSetLogCeremony, type SetCeremonyInput } from '../useSetLogCeremony'

const TODAY = new Date('2026-09-16T18:00:00')

function makeSet(over: Partial<WorkoutSet> = {}): WorkoutSet {
  return {
    id: 'set-1',
    date: '2026-09-16T23:59:00.000Z',
    weight: 185,
    reps: 5,
    estimated1RM: 216,
    ...over,
  } as WorkoutSet
}

function seedExercise(sets: WorkoutSet[]): void {
  storeState.exercises = [{ id: 'ex-1', name: 'Bench Press', tags: [], sets }] as Exercise[]
}

function input(over: Partial<SetCeremonyInput> = {}): SetCeremonyInput {
  return {
    exerciseId: 'ex-1',
    exerciseName: 'Bench Press',
    weightLbs: 185,
    reps: 5,
    rawDate: '2026-09-16',
    wasPR: false,
    loggedSet: makeSet(),
    ...over,
  }
}

/**
 * Every haptic invocation, with multiplicity — so a re-introduced second
 * `notifySuccess()` reads as `['success', 'success']` and fails the assertion.
 * A boolean "was it called" check would have passed straight through the
 * double-buzz defect this replaced.
 */
function hapticCalls(): string[] {
  return [
    ...hoisted.impactHeavy.mock.calls.map(() => 'heavy'),
    ...hoisted.notifySuccess.mock.calls.map(() => 'success'),
    ...hoisted.impactLight.mock.calls.map(() => 'light'),
  ]
}

/** Snapshot → write → ceremony, the order `saveSet` uses. Models a successful write. */
function run(over: Partial<SetCeremonyInput> = {}) {
  const ceremony = useSetLogCeremony({ startRestTimer: hoisted.startRestTimer })
  const before = ceremony.captureSetCeremony('ex-1')
  // Model the write: the caller snapshots, the store appends, the ceremony runs.
  const logged = (over.loggedSet ?? makeSet()) as WorkoutSet
  storeState.exercises[0].sets.push(logged)
  return { decision: ceremony.runSetCeremony(input({ ...over, loggedSet: logged }), before), before }
}

describe('useSetLogCeremony', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(TODAY)
    localStorage.clear()
    Object.values(hoisted).forEach(m => m.mockClear())
    restTimer.enabled.value = false
    restTimer.autoStart.value = false
    progression.progressionEnabled = false
    progression.weeklyTarget = 3
    progression.streakWeeks = 0
    progression.totalPRCount = 3
    storeState.prByExercise = {}
    // A pre-existing set, so the save is not the lifter's first ever.
    seedExercise([makeSet({ id: 'old-1', weight: 135 })])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('a routine set: no celebration, the light tap, and XP attributed', () => {
    const { decision } = run()
    expect(decision.celebration).toBe('none')
    expect(hapticCalls()).toEqual(['light'])
    expect(hoisted.presentPRBurst).not.toHaveBeenCalled()
    expect(hoisted.presentFirstSetCelebration).not.toHaveBeenCalled()
    expect(hoisted.presentGoalCelebration).not.toHaveBeenCalled()
    expect(hoisted.logSetXPCeremony).toHaveBeenCalledTimes(1)
  })

  it('a PR: ONE success pattern, not the two the burst and caller each used to fire', () => {
    storeState.prByExercise['ex-1'] = 300
    const { decision } = run({ wasPR: true })
    expect(decision.celebration).toBe('pr')
    expect(hapticCalls()).toEqual(['success'])
    expect(hoisted.notifySuccess).toHaveBeenCalledTimes(1)
    expect(hoisted.impactLight).not.toHaveBeenCalled()
  })

  it('a first PR adds the heavier emphasis and its analytics event', () => {
    progression.totalPRCount = 0
    const { decision } = run({ wasPR: true })
    expect(decision.haptic).toBe('heavy-success')
    expect(hapticCalls()).toEqual(['heavy', 'success'])
    expect(hoisted.presentPRBurst.mock.calls[0][0].isFirstPR).toBe(true)
    expect(hoisted.logEvent).toHaveBeenCalledWith('first_pr', { exercise: 'Bench Press' })
  })

  it('the burst reads old → new across the write', () => {
    storeState.prByExercise['ex-1'] = 216
    const ceremony = useSetLogCeremony({ startRestTimer: hoisted.startRestTimer })
    const before = ceremony.captureSetCeremony('ex-1')
    // The write lands: the store's PR answer moves.
    storeState.exercises[0].sets.push(makeSet())
    storeState.prByExercise['ex-1'] = 240
    ceremony.runSetCeremony(input({ wasPR: true }), before)
    const payload = hoisted.presentPRBurst.mock.calls[0][0]
    expect(payload.oldE1RM).toBe(216)
    expect(payload.newE1RM).toBe(240)
    expect(payload.setWeight).toBe(185)
    expect(payload.setReps).toBe(5)
  })

  it('attributes XP BEFORE presenting, so the share card reflects the set that earned it', () => {
    const order: string[] = []
    hoisted.logSetXPCeremony.mockImplementation(() => { order.push('xp') })
    hoisted.presentPRBurst.mockImplementation(() => { order.push('burst') })
    run({ wasPR: true })
    expect(order).toEqual(['xp', 'burst'])
  })

  it('scores the set the store actually wrote, excluding it from its own priors', () => {
    const logged = makeSet({ id: 'set-99', weight: 225, reps: 3, estimated1RM: 247 })
    run({ loggedSet: logged })
    const call = hoisted.logSetXPCeremony.mock.calls[0][0]
    expect(call.setId).toBe('set-99')
    expect(call.estimated1RM).toBe(247)
    expect(call.exerciseId).toBe('ex-1')
  })

  it('skips XP when the write produced no set, but still runs the celebration lane', () => {
    const ceremony = useSetLogCeremony({ startRestTimer: hoisted.startRestTimer })
    const before = ceremony.captureSetCeremony('ex-1')
    ceremony.runSetCeremony(input({ loggedSet: null }), before)
    expect(hoisted.logSetXPCeremony).not.toHaveBeenCalled()
    expect(hapticCalls()).toEqual(['light'])
  })

  // ── First-ever set (#762) ────────────────────────────────────────

  it('a brand-new lifter gets the activation card, one success pattern, and the burnt flag', () => {
    seedExercise([])
    const { decision } = run()
    expect(decision.celebration).toBe('first-set')
    expect(hoisted.presentFirstSetCelebration).toHaveBeenCalledTimes(1)
    expect(hapticCalls()).toEqual(['success'])
    expect(localStorage.getItem(FIRST_SET_CELEBRATED_KEY)).toBe('true')
    expect(hoisted.logEvent).toHaveBeenCalledWith('first_set', { exercise: 'Bench Press' })
  })

  it('still fires its haptic when the surface no-ops (the celebrations opt-out)', () => {
    // The presenters are mocked to do nothing, which is exactly what they do
    // under `experience.prCelebrations: false`. The haptic reflects what the
    // lifter earned, not whether a surface was drawn — before LIFT-1448 the
    // first-set lane owned its haptic AND suppressed the routine light tap, so
    // a brand-new lifter with celebrations off got no feedback at all.
    seedExercise([])
    run()
    expect(hoisted.presentFirstSetCelebration).toHaveBeenCalledTimes(1)
    expect(hapticCalls()).toEqual(['success'])
  })

  it('the activation card fires once ever — the burnt flag keeps the next empty state quiet', () => {
    localStorage.setItem(FIRST_SET_CELEBRATED_KEY, 'true')
    seedExercise([])
    const { decision } = run()
    expect(decision.celebration).toBe('none')
    expect(hoisted.presentFirstSetCelebration).not.toHaveBeenCalled()
    expect(hapticCalls()).toEqual(['light'])
  })

  // ── Weekly goal (LIFT-764) ───────────────────────────────────────

  function seedMetWeeklyGoal(): void {
    progression.progressionEnabled = true
    progression.weeklyTarget = 2
    // Mon 2026-09-14 and Tue 2026-09-15, both inside the Mon–Sun week of TODAY.
    seedExercise([
      makeSet({ id: 'w-1', date: '2026-09-14T23:59:00.000Z' }),
      makeSet({ id: 'w-2', date: '2026-09-15T23:59:00.000Z' }),
    ])
  }

  it('a met weekly goal presents the banner, marks the week, and fires one success', () => {
    seedMetWeeklyGoal()
    const { decision } = run()
    expect(decision.celebration).toBe('goal')
    expect(hoisted.presentGoalCelebration).toHaveBeenCalledWith({
      streak: 1,
      milestone: false,
      target: 2,
    })
    expect(hapticCalls()).toEqual(['success'])
    expect(JSON.parse(localStorage.getItem(GOAL_CELEBRATION_KEY)!)).toEqual({
      lastCelebratedWeek: weekKeyOf(TODAY),
    })
    expect(hoisted.logEvent).toHaveBeenCalledWith('weekly_goal_celebrated', {
      streak: 1,
      milestone: false,
    })
  })

  it('a streak-tier crossing adds the heavier emphasis and the milestone event', () => {
    seedMetWeeklyGoal()
    progression.streakWeeks = 1 // → projected streak 2, the first multiplier tier
    const { decision } = run()
    expect(decision.haptic).toBe('heavy-success')
    expect(hapticCalls()).toEqual(['heavy', 'success'])
    expect(hoisted.logEvent).toHaveBeenCalledWith('streak_milestone', { streak: 2, target: 2 })
  })

  it('the banner fires once a week', () => {
    seedMetWeeklyGoal()
    localStorage.setItem(
      GOAL_CELEBRATION_KEY,
      JSON.stringify({ lastCelebratedWeek: weekKeyOf(TODAY) }),
    )
    const { decision } = run()
    expect(decision.celebration).toBe('none')
    expect(hoisted.presentGoalCelebration).not.toHaveBeenCalled()
    expect(hapticCalls()).toEqual(['light'])
  })

  it('no goal banner while progression is off', () => {
    seedMetWeeklyGoal()
    progression.progressionEnabled = false
    expect(run().decision.celebration).toBe('none')
    expect(hoisted.presentGoalCelebration).not.toHaveBeenCalled()
  })

  // ── Exclusion ────────────────────────────────────────────────────

  it('a PR suppresses the goal banner and LEAVES THE WEEK UNMARKED', () => {
    seedMetWeeklyGoal()
    const { decision } = run({ wasPR: true })
    expect(decision.celebration).toBe('pr')
    expect(hoisted.presentGoalCelebration).not.toHaveBeenCalled()
    // Unmarked, so the banner still fires on the next non-PR set this week —
    // the week must not be burned on a celebration nobody saw.
    expect(localStorage.getItem(GOAL_CELEBRATION_KEY)).toBeNull()
    expect(hoisted.logEvent).not.toHaveBeenCalledWith('weekly_goal_celebrated', expect.anything())
    expect(hapticCalls()).toEqual(['success'])
  })

  it('the activation card suppresses the goal banner and leaves the week unmarked', () => {
    progression.progressionEnabled = true
    progression.weeklyTarget = 1
    seedExercise([])
    const { decision } = run()
    expect(decision.celebration).toBe('first-set')
    expect(hoisted.presentGoalCelebration).not.toHaveBeenCalled()
    expect(localStorage.getItem(GOAL_CELEBRATION_KEY)).toBeNull()
    expect(hapticCalls()).toEqual(['success'])
  })

  // ── Rest timer ───────────────────────────────────────────────────

  it('autostarts the rest timer only when enabled AND set to autostart', () => {
    run()
    expect(hoisted.startRestTimer).not.toHaveBeenCalled()

    restTimer.enabled.value = true
    run()
    expect(hoisted.startRestTimer).not.toHaveBeenCalled()

    restTimer.autoStart.value = true
    run()
    expect(hoisted.startRestTimer).toHaveBeenCalledTimes(1)
  })
})
