/**
 * xpCeremonyUI tests
 *
 * The XP toast and theme-unlock celebration are transient, non-persisted UI
 * singletons that live outside the Pinia store (LIFT-823). These tests lock in
 * the two contracts that motivated extracting them:
 *   1. resetXPCeremony() clears all state AND cancels the toast auto-dismiss
 *      timer, so a leaked setTimeout can't fire after sign-out or bleed across
 *      test cases.
 *   2. The mutators behave as the App.vue template + ceremony pipeline expect.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  xpToast,
  unlockCelebration,
  showXPToast,
  showUnlockCelebration,
  dismissUnlockCelebration,
  resetXPCeremony,
} from '../composables/xpCeremonyUI'

describe('xpCeremonyUI', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetXPCeremony()
  })

  afterEach(() => {
    resetXPCeremony()
    vi.useRealTimers()
  })

  describe('showXPToast', () => {
    it('makes the toast visible with the supplied payload', () => {
      showXPToast('+100 XP', 42, 1234, 5000)
      expect(xpToast.visible).toBe(true)
      expect(xpToast.text).toBe('+100 XP')
      expect(xpToast.progressPercent).toBe(42)
      expect(xpToast.totalXP).toBe(1234)
      expect(xpToast.nextThresholdXP).toBe(5000)
    })

    it('auto-dismisses after the timeout and clears its timer handle', () => {
      showXPToast('+100 XP', 10, 100, null)
      expect(xpToast.visible).toBe(true)
      expect(xpToast._timer).not.toBeNull()

      vi.advanceTimersByTime(4000)
      expect(xpToast.visible).toBe(false)
      expect(xpToast._timer).toBeNull()
    })

    it('replaces a pending timer so back-to-back toasts do not double-fire', () => {
      showXPToast('first', 10, 100, null)
      vi.advanceTimersByTime(2000)
      // Second toast resets the dismiss clock
      showXPToast('second', 20, 200, null)
      expect(xpToast.text).toBe('second')

      // Original 4s would have elapsed here, but the timer was replaced
      vi.advanceTimersByTime(2000)
      expect(xpToast.visible).toBe(true)

      vi.advanceTimersByTime(2000)
      expect(xpToast.visible).toBe(false)
    })
  })

  describe('unlock celebration', () => {
    it('shows and dismisses the celebration', () => {
      showUnlockCelebration('fire', 'Intensity')
      expect(unlockCelebration.visible).toBe(true)
      expect(unlockCelebration.themeId).toBe('fire')
      expect(unlockCelebration.themeName).toBe('Intensity')

      dismissUnlockCelebration()
      expect(unlockCelebration.visible).toBe(false)
    })
  })

  describe('resetXPCeremony', () => {
    it('clears all toast and celebration state', () => {
      showXPToast('+100 XP', 42, 1234, 5000)
      showUnlockCelebration('water', 'Flow')

      resetXPCeremony()

      expect(xpToast.visible).toBe(false)
      expect(xpToast.text).toBe('')
      expect(xpToast.progressPercent).toBe(0)
      expect(xpToast.totalXP).toBe(0)
      expect(xpToast.nextThresholdXP).toBeNull()
      expect(unlockCelebration.visible).toBe(false)
      expect(unlockCelebration.themeId).toBeNull()
      expect(unlockCelebration.themeName).toBe('')
    })

    it('cancels the in-flight auto-dismiss timer so it never fires post-reset', () => {
      showXPToast('+100 XP', 10, 100, null)
      expect(xpToast._timer).not.toBeNull()

      resetXPCeremony()
      expect(xpToast._timer).toBeNull()

      // A later toast that was shown after reset must not be wiped by the
      // original (now-cancelled) timer.
      showXPToast('next user', 5, 50, null)
      vi.advanceTimersByTime(4000)
      // The new toast's own timer fires exactly once; no double-dismiss crash.
      expect(xpToast.visible).toBe(false)
    })
  })
})
