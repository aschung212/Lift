import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// Mock useHaptics before we import the module under test so its inline
// haptics.notifySuccess() call on present is observable.
const notifySuccessMock = vi.fn()
const impactHeavyMock = vi.fn()
vi.mock('../useHaptics', () => ({
  useHaptics: () => ({
    impactLight: vi.fn(),
    impactMedium: vi.fn(),
    impactHeavy: impactHeavyMock,
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
    setActivePinia(createPinia())
    notifySuccessMock.mockClear()
    impactHeavyMock.mockClear()
    const { dismissPRBurst } = usePRBurst()
    dismissPRBurst()
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

  it('fires heavy haptic for first PR instead of success', () => {
    const { presentPRBurst } = usePRBurst()
    presentPRBurst({
      exerciseName: 'Bench Press',
      oldE1RM: 0,
      newE1RM: 135,
      setWeight: 135,
      setReps: 1,
      isFirstPR: true,
    })
    expect(impactHeavyMock).toHaveBeenCalledTimes(1)
    expect(notifySuccessMock).not.toHaveBeenCalled()
  })

  it('fires success haptic for subsequent PRs (isFirstPR false)', () => {
    const { presentPRBurst } = usePRBurst()
    presentPRBurst({
      exerciseName: 'Bench Press',
      oldE1RM: 135,
      newE1RM: 145,
      setWeight: 145,
      setReps: 1,
      isFirstPR: false,
    })
    expect(notifySuccessMock).toHaveBeenCalledTimes(1)
    expect(impactHeavyMock).not.toHaveBeenCalled()
  })

  it('stores isFirstPR flag in the payload', () => {
    const { presentPRBurst, payload } = usePRBurst()
    presentPRBurst({
      exerciseName: 'Deadlift',
      oldE1RM: 0,
      newE1RM: 225,
      setWeight: 225,
      setReps: 1,
      isFirstPR: true,
    })
    expect(payload.value?.isFirstPR).toBe(true)
  })
})
