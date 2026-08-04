/**
 * useXPCeremony composable tests
 *
 * Verifies the full XP attribution pipeline fires in the correct order:
 * record → credit → unlock check → celebration → analytics → toast.
 *
 * Issue #521
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from './helpers'

const localStorageMock = getLocalStorageMock()

vi.mock('../lib/syncQueue', () => ({
  syncQueue: { enqueue: vi.fn(), enqueueDelete: vi.fn() }
}))

const mockLogXPEvent = vi.fn()
const mockLogBodyweightXPEvent = vi.fn()

vi.mock('../lib/xpInstrumentation', () => ({
  logXPEvent: (...args: unknown[]) => mockLogXPEvent(...args),
  logBodyweightXPEvent: (...args: unknown[]) => mockLogBodyweightXPEvent(...args),
  logWeeklySnapshot: vi.fn(),
}))

vi.mock('../lib/crossTabSync', () => ({
  broadcastStoreUpdate: vi.fn(),
}))

vi.mock('../lib/durableStorage', () => ({
  backupToIDB: vi.fn(),
}))

import { useProgressionStore } from '../stores/progression'
import { xpToast, unlockCelebration, resetXPCeremony } from '../composables/xpCeremonyUI'
import { useXPCeremony } from '../composables/useXPCeremony'
import { XP_CONFIG } from '../lib/xp'

describe('useXPCeremony', () => {
  beforeEach(() => {
    localStorageMock.clear()
    setActivePinia(createPinia())
    vi.useFakeTimers()
    mockLogXPEvent.mockClear()
    mockLogBodyweightXPEvent.mockClear()
    // Clear transient ceremony UI (and any in-flight toast timer) so state can't
    // bleed across test cases.
    resetXPCeremony()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('logSetXPCeremony', () => {
    it('records set XP metadata even when progression is disabled', () => {
      const store = useProgressionStore()
      store.progressionEnabled = false
      const { logSetXPCeremony } = useXPCeremony()

      logSetXPCeremony({
        setId: 'set-1',
        exerciseId: 'ex-1',
        xp: 100,
        baseXP: 100,
        zone: 'working',
        isPR: false,
        isTie: false,
        isRepPR: false,
        activeTheme: 'eternal',
        estimated1RM: 200,
        exerciseBest1RM: 250,
        streakMultiplier: 1,
      })

      // Shadow ledger always records
      expect(store.xpPerSet['set-1']).toBeDefined()
      // But totalXP is not credited
      expect(store.totalXP).toBe(0)
    })

    it('credits XP and records analytics when progression is enabled', () => {
      const store = useProgressionStore()
      store.setStarterTheme('fire')
      store.starterConfirmed = true
      const { logSetXPCeremony } = useXPCeremony()

      logSetXPCeremony({
        setId: 'set-1',
        exerciseId: 'ex-1',
        xp: 150,
        baseXP: 100,
        zone: 'pr',
        isPR: true,
        isTie: false,
        isRepPR: false,
        activeTheme: 'fire',
        estimated1RM: 300,
        exerciseBest1RM: 250,
        streakMultiplier: 1.5,
      })

      expect(store.totalXP).toBe(150)
      expect(mockLogXPEvent).toHaveBeenCalledTimes(1)
      expect(mockLogXPEvent).toHaveBeenCalledWith(expect.objectContaining({
        setId: 'set-1',
        exerciseId: 'ex-1',
        baseXP: 100,
        finalXP: 150,
        isPR: true,
        zone: 'pr',
      }))
    })

    it('shows XP toast with zone breakdown when showProgression is true', () => {
      const store = useProgressionStore()
      store.setStarterTheme('fire')
      store.starterConfirmed = true
      store.showProgression = true
      const { logSetXPCeremony } = useXPCeremony()

      logSetXPCeremony({
        setId: 'set-2',
        exerciseId: 'ex-1',
        xp: 200,
        baseXP: 200,
        zone: 'pr',
        isPR: true,
        isTie: false,
        isRepPR: false,
        activeTheme: 'fire',
        estimated1RM: 300,
        exerciseBest1RM: 250,
        streakMultiplier: 1,
      })

      expect(xpToast.visible).toBe(true)
      expect(xpToast.text).toContain('PR!')
      expect(xpToast.text).toContain('200 XP')
    })

    it('does not show toast when showProgression is false', () => {
      const store = useProgressionStore()
      store.setStarterTheme('fire')
      store.starterConfirmed = true
      store.showProgression = false
      const { logSetXPCeremony } = useXPCeremony()

      logSetXPCeremony({
        setId: 'set-3',
        exerciseId: 'ex-1',
        xp: 100,
        baseXP: 100,
        zone: 'working',
        isPR: false,
        isTie: false,
        isRepPR: false,
        activeTheme: 'fire',
        estimated1RM: 200,
        exerciseBest1RM: 250,
        streakMultiplier: 1,
      })

      // XP is still credited
      expect(store.totalXP).toBe(100)
      // But toast is not shown
      expect(xpToast.visible).toBe(false)
    })

    it('shows New Exercise in toast for new exercises', () => {
      const store = useProgressionStore()
      store.setStarterTheme('fire')
      store.starterConfirmed = true
      store.showProgression = true
      const { logSetXPCeremony } = useXPCeremony()

      logSetXPCeremony({
        setId: 'set-4',
        exerciseId: 'ex-new',
        xp: 50,
        baseXP: 50,
        zone: 'new_exercise',
        isPR: false,
        isTie: false,
        isRepPR: false,
        activeTheme: 'fire',
        estimated1RM: 100,
        exerciseBest1RM: null,
        streakMultiplier: 1,
      })

      expect(xpToast.text).toContain('New Exercise')
    })

    it('includes rep PR and streak multiplier in toast', () => {
      const store = useProgressionStore()
      store.setStarterTheme('fire')
      store.starterConfirmed = true
      store.showProgression = true
      const { logSetXPCeremony } = useXPCeremony()

      logSetXPCeremony({
        setId: 'set-5',
        exerciseId: 'ex-1',
        xp: 300,
        baseXP: 200,
        zone: 'working',
        isPR: false,
        isTie: false,
        isRepPR: true,
        activeTheme: 'fire',
        estimated1RM: 200,
        exerciseBest1RM: 250,
        streakMultiplier: 1.5,
      })

      expect(xpToast.text).toContain('Rep PR')
      expect(xpToast.text).toContain('1.5x streak')
    })

    it('calls onUnlock callback when a theme is unlocked', () => {
      const store = useProgressionStore()
      store.setStarterTheme('fire')
      store.starterConfirmed = true
      // Set XP just below the level 2 threshold (15,000 for 'air')
      store.totalXP = 14_900
      const onUnlock = vi.fn()
      const { logSetXPCeremony } = useXPCeremony()

      logSetXPCeremony({
        setId: 'set-6',
        exerciseId: 'ex-1',
        xp: 200,
        baseXP: 200,
        zone: 'pr',
        isPR: true,
        isTie: false,
        isRepPR: false,
        activeTheme: 'fire',
        estimated1RM: 300,
        exerciseBest1RM: 250,
        streakMultiplier: 1,
        onUnlock,
      })

      // Should have scheduled celebration
      vi.advanceTimersByTime(2000)
      expect(onUnlock).toHaveBeenCalledTimes(1)
      expect(unlockCelebration.visible).toBe(true)
    })

    it('shows starter lock-in toast on first set during trial', () => {
      const store = useProgressionStore()
      store.setStarterTheme('fire')
      store.starterConfirmed = false // still in trial
      const { logSetXPCeremony } = useXPCeremony()

      logSetXPCeremony({
        setId: 'set-7',
        exerciseId: 'ex-1',
        xp: 50,
        baseXP: 50,
        zone: 'new_exercise',
        isPR: false,
        isTie: false,
        isRepPR: false,
        activeTheme: 'fire',
        estimated1RM: 100,
        exerciseBest1RM: null,
        streakMultiplier: 1,
      })

      // Advance past the 4500ms delay
      vi.advanceTimersByTime(5000)
      expect(xpToast.text).toContain('locked in as your starter')
    })
  })

  describe('logBodyweightXPCeremony', () => {
    it('does nothing when progression is disabled', () => {
      const store = useProgressionStore()
      store.progressionEnabled = false
      const { logBodyweightXPCeremony } = useXPCeremony()

      logBodyweightXPCeremony({ date: '2026-05-09', activeTheme: 'eternal' })

      expect(store.bodyweightXPDates).toHaveLength(0)
      expect(store.totalXP).toBe(0)
    })

    it('awards XP and logs analytics for first bodyweight entry on a date', () => {
      const store = useProgressionStore()
      store.setStarterTheme('fire')
      store.starterConfirmed = true
      const { logBodyweightXPCeremony } = useXPCeremony()

      logBodyweightXPCeremony({ date: '2026-05-09', activeTheme: 'fire' })

      expect(store.totalXP).toBe(XP_CONFIG.bodyweightXP)
      expect(store.bodyweightXPDates).toContain('2026-05-09')
      expect(mockLogBodyweightXPEvent).toHaveBeenCalledTimes(1)
      expect(mockLogBodyweightXPEvent).toHaveBeenCalledWith(
        null, '2026-05-09', XP_CONFIG.bodyweightXP, 'fire', store.epoch
      )
    })

    it('does not double-credit XP for same date', () => {
      const store = useProgressionStore()
      store.setStarterTheme('fire')
      store.starterConfirmed = true
      const { logBodyweightXPCeremony } = useXPCeremony()

      logBodyweightXPCeremony({ date: '2026-05-09', activeTheme: 'fire' })
      logBodyweightXPCeremony({ date: '2026-05-09', activeTheme: 'fire' })

      expect(store.totalXP).toBe(XP_CONFIG.bodyweightXP)
      // Analytics should only fire once (first time)
      expect(mockLogBodyweightXPEvent).toHaveBeenCalledTimes(1)
    })

    it('shows XP toast when showProgression is true', () => {
      const store = useProgressionStore()
      store.setStarterTheme('fire')
      store.starterConfirmed = true
      store.showProgression = true
      const { logBodyweightXPCeremony } = useXPCeremony()

      logBodyweightXPCeremony({ date: '2026-05-09', activeTheme: 'fire' })

      expect(xpToast.visible).toBe(true)
      expect(xpToast.text).toContain(`+${XP_CONFIG.bodyweightXP} XP`)
    })
  })

  describe('celebrateUnlocks', () => {
    it('shows celebrations for multiple themes sequentially', () => {
      const { celebrateUnlocks } = useXPCeremony()

      celebrateUnlocks(['air', 'amethyst'])

      // First celebration at 500ms
      vi.advanceTimersByTime(500)
      expect(unlockCelebration.visible).toBe(true)
      expect(unlockCelebration.themeId).toBe('air')

      // Second celebration at 2500ms
      vi.advanceTimersByTime(2500)
      expect(unlockCelebration.themeId).toBe('amethyst')
    })

    it('handles empty array gracefully', () => {
      const { celebrateUnlocks } = useXPCeremony()
      celebrateUnlocks([])
      vi.advanceTimersByTime(5000)
      expect(unlockCelebration.visible).toBe(false)
    })
  })
})
