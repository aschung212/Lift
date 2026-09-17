import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// Mock useHaptics so we can assert the banner fires NOTHING. The save's single
// haptic is decided with the celebration in `lib/setCeremony` and fired once by
// `useSetLogCeremony` (LIFT-1448) — this composable used to return a boolean so
// the caller could decide whether to add its own, which is what let two native
// haptics collide on iOS.
const notifySuccessMock = vi.fn()
const impactHeavyMock = vi.fn()
const impactLightMock = vi.fn()
vi.mock('../useHaptics', () => ({
  useHaptics: () => ({
    impactLight: impactLightMock,
    impactMedium: vi.fn(),
    impactHeavy: impactHeavyMock,
    notifySuccess: notifySuccessMock,
    notifyWarning: vi.fn(),
    notifyError: vi.fn(),
  }),
}))

function expectNoHaptic(): void {
  expect(notifySuccessMock).not.toHaveBeenCalled()
  expect(impactHeavyMock).not.toHaveBeenCalled()
  expect(impactLightMock).not.toHaveBeenCalled()
}

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
    impactLightMock.mockClear()
    const { dismissGoalCelebration } = useGoalCelebration()
    dismissGoalCelebration()
    vi.advanceTimersByTime(220)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('presents the banner and fires no haptic of its own', () => {
    const { presentGoalCelebration, visible, payload } = useGoalCelebration()
    presentGoalCelebration({ streak: 1, milestone: false, target: 3 })
    expect(visible.value).toBe(true)
    expect(payload.value).toEqual({ streak: 1, milestone: false, target: 3 })
    expectNoHaptic()
  })

  it('renders a milestone without firing the heavier pattern itself', () => {
    // `heavy-success` belongs to `decideSetCeremony`; the banner only shows the
    // milestone copy.
    const { presentGoalCelebration, payload } = useGoalCelebration()
    presentGoalCelebration({ streak: 2, milestone: true, target: 4 })
    expect(payload.value?.milestone).toBe(true)
    expectNoHaptic()
  })

  it('skips when the user disables celebrations', () => {
    const prefs = usePreferencesStore()
    prefs.setExperienceFlag('prCelebrations', false)
    const { presentGoalCelebration, visible } = useGoalCelebration()
    presentGoalCelebration({ streak: 1, milestone: false, target: 3 })
    expect(visible.value).toBe(false)
    expectNoHaptic()
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
