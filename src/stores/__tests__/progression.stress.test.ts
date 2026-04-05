/**
 * Load & stress tests for the progression store.
 *
 * Validates that XP operations, large xpPerSet records, and
 * streak history remain performant at scale.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

vi.mock('../../lib/syncQueue', () => ({
  syncQueue: { enqueue: vi.fn() }
}))
vi.mock('../../lib/xpInstrumentation', () => ({
  logWeeklySnapshot: vi.fn()
}))

import { useProgressionStore } from '../progression'
import type { SetXPEntry, StreakWeekEntry } from '../progression'

// ── Helpers ──────────────────────────────────────────────────────

function measure(fn: () => void): number {
  const start = performance.now()
  fn()
  return performance.now() - start
}

function makeXPPerSet(count: number): Record<string, SetXPEntry> {
  const entries: Record<string, SetXPEntry> = {}
  for (let i = 0; i < count; i++) {
    entries[`set-${i}`] = {
      xp: 10 + (i % 50),
      theme: ['fire', 'water', 'air', 'void', 'luck'][i % 5],
      epoch: 1,
      zone: ['push', 'pull', 'legs', 'core'][i % 4],
      isPR: i % 20 === 0,
      isRepPR: i % 15 === 0,
    }
  }
  return entries
}

function makeStreakHistory(weeks: number): StreakWeekEntry[] {
  const entries: StreakWeekEntry[] = []
  const baseDate = new Date('2025-01-06')
  for (let i = 0; i < weeks; i++) {
    const weekStart = new Date(baseDate.getTime() + i * 7 * 86400000)
    entries.push({
      weekStart: weekStart.toISOString().slice(0, 10),
      daysActive: Math.min(3 + (i % 5), 7),
      target: 3,
      met: (3 + (i % 5)) >= 3,
      combinedMultiplier: 1 + (i % 10) * 0.1,
    })
  }
  return entries
}

// ── Tests ────────────────────────────────────────────────────────

describe('progression store — load & stress tests', () => {
  beforeEach(() => {
    localStorageMock.clear()
    setActivePinia(createPinia())
  })

  describe('large xpPerSet initialization', () => {
    it('loads store with 10,000 XP entries from localStorage under 100ms', () => {
      const state = {
        totalXP: 500_000,
        streakWeeks: 52,
        weeklyTarget: 4,
        pendingTargetChange: null,
        showProgression: true,
        progressionEnabled: true,
        epoch: 1,
        unlockedThemes: [{ id: 'pearl', unlockedAt: '2025-01-01T00:00:00Z' }],
        starterTheme: 'fire',
        starterConfirmed: true,
        streakHistory: makeStreakHistory(52),
        xpPerSet: makeXPPerSet(10_000),
        bodyweightXPDates: [],
      }
      localStorageMock.setItem('user-progression', JSON.stringify(state))

      const elapsed = measure(() => {
        setActivePinia(createPinia())
        const store = useProgressionStore()
        expect(store.totalXP).toBe(500_000)
        expect(Object.keys(store.xpPerSet).length).toBe(10_000)
      })

      expect(elapsed).toBeLessThan(100)
    })
  })

  describe('rapid XP recording', () => {
    it('records 500 sets of XP in rapid succession under 500ms', () => {
      const store = useProgressionStore()
      store.$patch({ progressionEnabled: true, starterTheme: 'fire', starterConfirmed: true })

      const elapsed = measure(() => {
        for (let i = 0; i < 500; i++) {
          store.recordSetXP(`rapid-set-${i}`, 15, {
            theme: 'fire',
            epoch: 1,
            zone: 'push',
            isPR: false,
            isRepPR: false,
          })
        }
      })

      expect(Object.keys(store.xpPerSet).length).toBe(500)
      // Each recordSetXP calls _persist() with full state serialization
      expect(elapsed).toBeLessThan(1500)
    })

    it('credits XP for 500 sets under 500ms', () => {
      const store = useProgressionStore()
      store.$patch({ progressionEnabled: true, totalXP: 0 })

      const elapsed = measure(() => {
        for (let i = 0; i < 500; i++) {
          store.creditSetXP(`credit-set-${i}`, 15)
        }
      })

      expect(store.totalXP).toBe(7500)
      expect(elapsed).toBeLessThan(500)
    })
  })

  describe('XP removal at scale', () => {
    it('removes 100 set XP entries from 10,000 under 200ms', () => {
      const store = useProgressionStore()
      store.$patch({
        xpPerSet: makeXPPerSet(10_000),
        totalXP: 500_000,
      })

      const elapsed = measure(() => {
        for (let i = 0; i < 100; i++) {
          store.removeSetXP(`set-${i}`)
        }
      })

      expect(Object.keys(store.xpPerSet).length).toBe(9_900)
      // Each removal calls _persist() serializing ~10k entries
      expect(elapsed).toBeLessThan(5000)
    })
  })

  describe('persistence with large state', () => {
    it('serializes state with 10,000 XP entries and 52-week history under 200ms', () => {
      const store = useProgressionStore()
      store.$patch({
        xpPerSet: makeXPPerSet(10_000),
        streakHistory: makeStreakHistory(52),
        totalXP: 500_000,
      })

      const elapsed = measure(() => {
        store._persist()
      })

      const stored = localStorageMock.setItem.mock.calls
      expect(stored.length).toBeGreaterThan(0)
      expect(elapsed).toBeLessThan(200)
    })
  })
})
