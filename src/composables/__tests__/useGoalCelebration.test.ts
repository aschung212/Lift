import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// Mock useHaptics so the inline haptic calls on present are observable.
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

import { useGoalCelebration } from '../useGoalCelebration'
import { usePreferencesStore } from '../../stores/preferences'

describe('useGoalCelebration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    notifySuccessMock.mockClear()
    impactHeavyMock.mockClear()
    const { dismissGoalCelebration } = useGoalCelebration()
    dismissGoalCelebration()
    vi.advanceTimersByTime(220)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('presents the banner and fires a success haptic', () => {
    const { presentGoalCelebration, visible, payload } = useGoalCelebration()
    const fired = presentGoalCelebration({ streak: 1, milestone: false, target: 3 })
    // Returns true so the caller (saveSet) suppresses its routine light tap and
    // the two native haptics don't collide on iOS.
    expect(fired).toBe(true)
    expect(visible.value).toBe(true)
    expect(payload.value).toEqual({ streak: 1, milestone: false, target: 3 })
    expect(notifySuccessMock).toHaveBeenCalledTimes(1)
    expect(impactHeavyMock).not.toHaveBeenCalled()
  })

  it('fires a heavy haptic on a milestone', () => {
    const { presentGoalCelebration } = useGoalCelebration()
    presentGoalCelebration({ streak: 2, milestone: true, target: 4 })
    expect(impactHeavyMock).toHaveBeenCalledTimes(1)
    expect(notifySuccessMock).toHaveBeenCalledTimes(1)
  })

  it('skips when the user disables celebrations', () => {
    const prefs = usePreferencesStore()
    prefs.setExperienceFlag('prCelebrations', false)
    const { presentGoalCelebration, visible } = useGoalCelebration()
    const fired = presentGoalCelebration({ streak: 1, milestone: false, target: 3 })
    // Returns false (no celebration haptic) so the caller still plays its
    // routine light tap for the logged set.
    expect(fired).toBe(false)
    expect(visible.value).toBe(false)
    expect(notifySuccessMock).not.toHaveBeenCalled()
  })

  it('auto-dismisses after the timeout', () => {
    const { presentGoalCelebration, visible } = useGoalCelebration()
    presentGoalCelebration({ streak: 1, milestone: false, target: 3 })
    expect(visible.value).toBe(true)
    vi.advanceTimersByTime(4500)
    expect(visible.value).toBe(false)
  })

  it('dismiss clears the payload after the fade-out', () => {
    const { presentGoalCelebration, dismissGoalCelebration, payload } = useGoalCelebration()
    presentGoalCelebration({ streak: 3, milestone: false, target: 5 })
    dismissGoalCelebration()
    vi.advanceTimersByTime(220)
    expect(payload.value).toBeNull()
  })
})
