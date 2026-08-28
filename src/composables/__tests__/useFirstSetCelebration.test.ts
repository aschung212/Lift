import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// Mock useHaptics before importing the module under test so its inline
// notifySuccess() call on present is observable.
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
    useFirstSetCelebration().dismissFirstSetCelebration()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('presents and fires a success haptic when celebrations are enabled', () => {
    const { presentFirstSetCelebration, visible } = useFirstSetCelebration()
    presentFirstSetCelebration()
    expect(visible.value).toBe(true)
    expect(notifySuccessMock).toHaveBeenCalledTimes(1)
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
    expect(notifySuccessMock).not.toHaveBeenCalled()
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
