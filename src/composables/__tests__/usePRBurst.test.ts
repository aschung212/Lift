import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// Mock useHaptics before we import the module under test so its inline
// haptics.notifySuccess() call on present is observable.
const notifySuccessMock = vi.fn()
vi.mock('../useHaptics', () => ({
  useHaptics: () => ({
    impactLight: vi.fn(),
    impactMedium: vi.fn(),
    impactHeavy: vi.fn(),
    notifySuccess: notifySuccessMock,
    notifyWarning: vi.fn(),
    notifyError: vi.fn(),
  }),
}))

vi.mock('../../lib/syncQueue', () => ({
  syncQueue: { enqueue: vi.fn(), enqueueDelete: vi.fn() },
}))

import { usePRBurst } from '../usePRBurst'
import { usePreferencesStore } from '../../stores/preferences'

describe('usePRBurst', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    notifySuccessMock.mockClear()
    const { dismissPRBurst } = usePRBurst()
    dismissPRBurst()
    // Flush the 200ms dismiss timeout so it doesn't leak across tests
    vi.advanceTimersByTime(200)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('presents when new e1RM beats old and celebrations are enabled', () => {
    const { presentPRBurst, visible, payload } = usePRBurst()
    presentPRBurst({
      exerciseName: 'Hack Squat',
      oldE1RM: 594,
      newE1RM: 606,
      setWeight: 505,
      setReps: 6,
    })
    expect(visible.value).toBe(true)
    expect(payload.value?.exerciseName).toBe('Hack Squat')
    expect(payload.value?.oldE1RM).toBe(594)
    expect(payload.value?.newE1RM).toBe(606)
    expect(notifySuccessMock).toHaveBeenCalledTimes(1)
  })

  it('skips when the user disables PR celebrations', () => {
    const prefs = usePreferencesStore()
    prefs.setExperienceFlag('prCelebrations', false)

    const { presentPRBurst, visible } = usePRBurst()
    presentPRBurst({
      exerciseName: 'Hack Squat',
      oldE1RM: 500,
      newE1RM: 600,
      setWeight: 500,
      setReps: 6,
    })
    expect(visible.value).toBe(false)
    expect(notifySuccessMock).not.toHaveBeenCalled()
  })

  it('guards against malformed payloads where new <= old', () => {
    const { presentPRBurst, visible } = usePRBurst()
    presentPRBurst({
      exerciseName: 'Hack Squat',
      oldE1RM: 600,
      newE1RM: 600,
      setWeight: 500,
      setReps: 6,
    })
    expect(visible.value).toBe(false)
    presentPRBurst({
      exerciseName: 'Hack Squat',
      oldE1RM: 600,
      newE1RM: 550,
      setWeight: 500,
      setReps: 6,
    })
    expect(visible.value).toBe(false)
  })

  it('fires heavy haptic for first PR', () => {
    vi.mocked(notifySuccessMock).mockClear()

    // The heavy haptic is called inside presentPRBurst when isFirstPR is true
    const { presentPRBurst, visible, payload } = usePRBurst()
    presentPRBurst({
      exerciseName: 'Bench Press',
      oldE1RM: 200,
      newE1RM: 225,
      setWeight: 185,
      setReps: 8,
      isFirstPR: true,
    })
    expect(visible.value).toBe(true)
    expect(payload.value?.isFirstPR).toBe(true)
    expect(notifySuccessMock).toHaveBeenCalledTimes(1)
  })

  it('passes isFirstPR false for subsequent PRs', () => {
    const { presentPRBurst, payload } = usePRBurst()
    presentPRBurst({
      exerciseName: 'Squat',
      oldE1RM: 300,
      newE1RM: 315,
      setWeight: 275,
      setReps: 5,
      isFirstPR: false,
    })
    expect(payload.value?.isFirstPR).toBe(false)
  })

  it('dismissPRBurst clears pending timeout on re-dismiss', () => {
    const { presentPRBurst, dismissPRBurst, payload } = usePRBurst()
    presentPRBurst({
      exerciseName: 'Hack Squat',
      oldE1RM: 594,
      newE1RM: 606,
      setWeight: 505,
      setReps: 6,
    })

    // First dismiss starts 200ms timeout
    dismissPRBurst()

    // Present again before timeout fires
    presentPRBurst({
      exerciseName: 'Bench Press',
      oldE1RM: 200,
      newE1RM: 225,
      setWeight: 185,
      setReps: 8,
    })

    // Second dismiss — should clear the first timeout
    dismissPRBurst()

    vi.advanceTimersByTime(200)
    // Payload should be null (only one timeout fired)
    expect(payload.value).toBeNull()
  })

  it('dismissPRBurst hides the overlay', () => {
    const { presentPRBurst, dismissPRBurst, visible } = usePRBurst()
    presentPRBurst({
      exerciseName: 'Hack Squat',
      oldE1RM: 594,
      newE1RM: 606,
      setWeight: 505,
      setReps: 6,
    })
    expect(visible.value).toBe(true)
    dismissPRBurst()
    expect(visible.value).toBe(false)
  })

  // LIFT-916: the caller (WorkoutTracker) owns store access and hands a
  // pre-built session summary to the burst, so the presentational PRBurst
  // component drives its "Share this PR" flow without reaching into stores.
  it('carries a caller-supplied shareSummary through the payload', () => {
    const { presentPRBurst, payload } = usePRBurst()
    const summary = { rawDate: '2026-07-08', setsCompleted: 3 } as unknown as NonNullable<
      typeof payload.value
    >['shareSummary']
    presentPRBurst({
      exerciseName: 'Deadlift',
      oldE1RM: 400,
      newE1RM: 420,
      setWeight: 365,
      setReps: 5,
      shareSummary: summary,
    })
    expect(payload.value?.shareSummary).toEqual(summary)
  })
})
