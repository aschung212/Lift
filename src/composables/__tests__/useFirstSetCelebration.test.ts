import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// Mock useHaptics so we can assert the card fires NOTHING. The save's single
// haptic is decided with the celebration in `lib/setCeremony` and fired once by
// `useSetLogCeremony` (LIFT-1448). Owning it here meant it vanished with the
// card under the celebrations opt-out — and because this moment also suppresses
// the routine light tap, a brand-new lifter's very first save got no feedback.
const notifySuccessMock = vi.fn()
const impactLightMock = vi.fn()
const impactHeavyMock = vi.fn()
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
  expect(impactLightMock).not.toHaveBeenCalled()
  expect(impactHeavyMock).not.toHaveBeenCalled()
}

vi.mock('../../lib/syncQueue', () => ({
  syncQueue: { enqueue: vi.fn(), enqueueDelete: vi.fn() },
}))

import {
  useFirstSetCelebration,
  FIRST_SET_AUTO_DISMISS_MS,
} from '../useFirstSetCelebration'
import { usePreferencesStore } from '../../stores/preferences'

describe('useFirstSetCelebration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    notifySuccessMock.mockClear()
    impactLightMock.mockClear()
    impactHeavyMock.mockClear()
    useFirstSetCelebration().dismissFirstSetCelebration()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('presents when celebrations are enabled, firing no haptic of its own', () => {
    const { presentFirstSetCelebration, visible } = useFirstSetCelebration()
    presentFirstSetCelebration()
    expect(visible.value).toBe(true)
    expectNoHaptic()
  })

  it('auto-dismisses after the configured delay', () => {
    const { presentFirstSetCelebration, visible } = useFirstSetCelebration()
    presentFirstSetCelebration()
    expect(visible.value).toBe(true)
    vi.advanceTimersByTime(FIRST_SET_AUTO_DISMISS_MS)
    expect(visible.value).toBe(false)
  })

  it('skips when the user disables celebrations', () => {
    usePreferencesStore().setExperienceFlag('prCelebrations', false)
    const { presentFirstSetCelebration, visible } = useFirstSetCelebration()
    presentFirstSetCelebration()
    expect(visible.value).toBe(false)
    expectNoHaptic()
  })

  it('dismiss clears the pending auto-dismiss timeout', () => {
    const { presentFirstSetCelebration, dismissFirstSetCelebration, visible } =
      useFirstSetCelebration()
    presentFirstSetCelebration()
    dismissFirstSetCelebration()
    expect(visible.value).toBe(false)
    // Advancing past the auto-dismiss window must not resurrect or re-toggle it.
    vi.advanceTimersByTime(FIRST_SET_AUTO_DISMISS_MS)
    expect(visible.value).toBe(false)
  })

  it('re-presenting resets the auto-dismiss window', () => {
    const { presentFirstSetCelebration, visible } = useFirstSetCelebration()
    presentFirstSetCelebration()
    vi.advanceTimersByTime(FIRST_SET_AUTO_DISMISS_MS - 500)
    expect(visible.value).toBe(true)
    presentFirstSetCelebration()
    // The original timer would have fired 500ms from now — it must have been reset.
    vi.advanceTimersByTime(500)
    expect(visible.value).toBe(true)
    vi.advanceTimersByTime(FIRST_SET_AUTO_DISMISS_MS - 500)
    expect(visible.value).toBe(false)
  })
})
