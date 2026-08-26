import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

vi.mock('../../lib/syncQueue', () => ({
  syncQueue: { enqueue: vi.fn(), enqueueDelete: vi.fn() }
}))

import { useProgressionStore, getTrainingDaysInWeek, getUnlockedThemeIds, computeWeekXP, mergeXpPerSet, mergeUnlockedThemes, mergeBodyweightDates } from '../progression'
import type { SetXPEntry } from '../progression'
import { XP_CONFIG } from '../../lib/xp'

/** Helper: get theme IDs from store's unlocked themes */
function unlockedIds(store: ReturnType<typeof useProgressionStore>): string[] {
  return getUnlockedThemeIds(store.unlockedThemes)
}

/**
 * Run `fn` with the process timezone temporarily forced to `tz` (same pattern
 * as dates.test.ts) — Node honors runtime TZ reassignment for Date ops.
 */
function withTZ(tz: string, fn: () => void) {
  const prev = process.env.TZ
  process.env.TZ = tz
  try {
    fn()
  } finally {
    process.env.TZ = prev
  }
}

describe('progression store', () => {
  beforeEach(() => {
    localStorageMock.clear()
    setActivePinia(createPinia())
  })

  // ── Default state ─────────────────────────────────────────────

  describe('default state', () => {
    it('initializes with sensible defaults', () => {
      const store = useProgressionStore()
      expect(store.totalXP).toBe(0)
      expect(store.streakWeeks).toBe(0)
      expect(store.weeklyTarget).toBe(3)
      expect(store.pendingTargetChange).toBeNull()
      expect(store.showProgression).toBe(true)
      expect(unlockedIds(store)).toEqual(['pearl'])
      expect(store.starterTheme).toBeNull()
      expect(store.streakHistory).toEqual([])
      expect(store.xpPerSet).toEqual({})
      expect(store.bodyweightXPDates).toEqual([])
    })

    it('loads from localStorage', () => {
      localStorage.setItem('user-progression', JSON.stringify({
        totalXP: 5000,
        weeklyTarget: 5,
      }))
      setActivePinia(createPinia())
      const store = useProgressionStore()
      expect(store.totalXP).toBe(5000)
      expect(store.weeklyTarget).toBe(5)
      // Defaults fill in missing fields
      expect(store.showProgression).toBe(true)
    })

    it('infers starterConfirmed when localStorage has starterTheme + XP (regression: trial mode re-entry)', () => {
      // Reproduces bug where starterConfirmed was not persisted to Supabase,
      // so after localStorage eviction + Supabase restore, users with 31K XP
      // saw "Trying starters" again.
      localStorage.setItem('user-progression', JSON.stringify({
        totalXP: 31167,
        starterTheme: 'fire',
        starterConfirmed: false,
        progressionEnabled: false,
      }))
      setActivePinia(createPinia())
      const store = useProgressionStore()
      expect(store.starterConfirmed).toBe(true)
      // progressionEnabled is NOT inferred — user may have disabled it intentionally
      expect(store.progressionEnabled).toBe(false)
    })

    it('does NOT infer starterConfirmed when no XP has been earned', () => {
      localStorage.setItem('user-progression', JSON.stringify({
        totalXP: 0,
        starterTheme: 'fire',
        starterConfirmed: false,
      }))
      setActivePinia(createPinia())
      const store = useProgressionStore()
      expect(store.starterConfirmed).toBe(false)
    })
  })

  // ── logSetXP ──────────────────────────────────────────────────

  describe('logSetXP', () => {
    it('adds XP to total and records per-set mapping', () => {
      const store = useProgressionStore()
      store.logSetXP('set-1', 54)
      expect(store.totalXP).toBe(54)
      expect(store.xpPerSet['set-1']).toBe(54)
    })

    it('accumulates XP across multiple sets', () => {
      const store = useProgressionStore()
      store.logSetXP('set-1', 54)
      store.logSetXP('set-2', 315)
      expect(store.totalXP).toBe(369)
    })

    it('persists to localStorage', () => {
      const store = useProgressionStore()
      store.logSetXP('set-1', 100)
      const saved = JSON.parse(localStorage.getItem('user-progression')!)
      expect(saved.totalXP).toBe(100)
      expect(saved.xpPerSet['set-1']).toBe(100)
    })
  })

  // ── removeSetXP ───────────────────────────────────────────────

  describe('removeSetXP', () => {
    it('deducts XP from total and removes tracking', () => {
      const store = useProgressionStore()
      store.logSetXP('set-1', 100)
      store.logSetXP('set-2', 200)
      store.removeSetXP('set-1')
      expect(store.totalXP).toBe(200)
      expect(store.xpPerSet['set-1']).toBeUndefined()
      expect(store.xpPerSet['set-2']).toBe(200)
    })

    it('does not let totalXP go below zero', () => {
      const store = useProgressionStore()
      store.logSetXP('set-1', 100)
      store.totalXP = 50
      store.removeSetXP('set-1')
      expect(store.totalXP).toBe(0)
    })

    it('is a no-op for unknown set IDs', () => {
      const store = useProgressionStore()
      store.logSetXP('set-1', 100)
      store.removeSetXP('nonexistent')
      expect(store.totalXP).toBe(100)
    })
  })

  // ── recalcSetXP ───────────────────────────────────────────────

  describe('recalcSetXP', () => {
    it('increases totalXP when new XP is higher', () => {
      const store = useProgressionStore()
      store.logSetXP('set-1', 54)
      store.recalcSetXP('set-1', 89)
      expect(store.totalXP).toBe(89) // 54 + (89-54) = 89
      expect(store.xpPerSet['set-1']).toBe(89)
    })

    it('does not decrease totalXP when new XP is lower (XP is permanent)', () => {
      const store = useProgressionStore()
      store.logSetXP('set-1', 100)
      store.recalcSetXP('set-1', 50)
      expect(store.totalXP).toBe(100) // not decreased
      expect(store.xpPerSet['set-1']).toBe(50) // tracking updated
    })

    it('handles recalc for unknown set (treats old as 0)', () => {
      const store = useProgressionStore()
      store.recalcSetXP('new-set', 75)
      expect(store.totalXP).toBe(75)
      expect(store.xpPerSet['new-set']).toBe(75)
    })
  })

  // ── logBodyweightXP ───────────────────────────────────────────

  describe('logBodyweightXP', () => {
    it('adds 100 XP for a new date', () => {
      const store = useProgressionStore()
      store.logBodyweightXP('2026-04-01')
      expect(store.totalXP).toBe(100)
      expect(store.bodyweightXPDates).toContain('2026-04-01')
    })

    it('does not add XP for a duplicate date', () => {
      const store = useProgressionStore()
      store.logBodyweightXP('2026-04-01')
      store.logBodyweightXP('2026-04-01')
      expect(store.totalXP).toBe(100)
      expect(store.bodyweightXPDates.filter(d => d === '2026-04-01')).toHaveLength(1)
    })

    it('strips time from date string', () => {
      const store = useProgressionStore()
      store.logBodyweightXP('2026-04-01T15:30:00Z')
      expect(store.bodyweightXPDates).toContain('2026-04-01')
      store.logBodyweightXP('2026-04-01T08:00:00Z')
      expect(store.totalXP).toBe(100) // not double-counted
    })
  })

  // ── setWeeklyTarget ────────────────────────────────────────────

  describe('weekly target management', () => {
    it('stages a target change without immediately applying', () => {
      const store = useProgressionStore()
      expect(store.weeklyTarget).toBe(3)
      store.setWeeklyTarget(5)
      expect(store.weeklyTarget).toBe(3) // unchanged until evaluateWeek
      expect(store.pendingTargetChange).toBe(5)
    })

    it('clamps target to 1-7', () => {
      const store = useProgressionStore()
      store.setWeeklyTarget(0)
      expect(store.pendingTargetChange).toBe(1)
      store.setWeeklyTarget(10)
      expect(store.pendingTargetChange).toBe(7)
    })

    it('is a no-op when target matches current', () => {
      const store = useProgressionStore()
      store.setWeeklyTarget(3) // same as default
      expect(store.pendingTargetChange).toBeNull()
    })
  })

  // ── evaluateWeek ──────────────────────────────────────────────

  describe('evaluateWeek', () => {
    it('increments streak when target is met', () => {
      const store = useProgressionStore()
      store.evaluateWeek(3, '2026-03-30')
      expect(store.streakWeeks).toBe(1)
    })

    it('resets streak when target is not met', () => {
      const store = useProgressionStore()
      store.evaluateWeek(3, '2026-03-23') // build a streak
      expect(store.streakWeeks).toBe(1)
      store.evaluateWeek(1, '2026-03-30') // miss target (3)
      expect(store.streakWeeks).toBe(0)
    })

    it('builds consecutive streaks', () => {
      const store = useProgressionStore()
      store.evaluateWeek(3, '2026-03-16')
      store.evaluateWeek(4, '2026-03-23')
      store.evaluateWeek(3, '2026-03-30')
      expect(store.streakWeeks).toBe(3)
    })

    it('applies pending target change after evaluation', () => {
      const store = useProgressionStore()
      store.evaluateWeek(3, '2026-03-23') // streak=1, target=3
      store.setWeeklyTarget(5) // stage change
      // Evaluate: anti-gaming uses max(3, 5) = 5
      store.evaluateWeek(4, '2026-03-30') // 4 < 5, misses
      expect(store.weeklyTarget).toBe(5) // change applied
      expect(store.streakWeeks).toBe(0) // streak reset (missed + target changed)
    })

    it('anti-gaming: evaluates against higher of old/new target', () => {
      const store = useProgressionStore()
      store.evaluateWeek(5, '2026-03-23') // build streak
      store.setWeeklyTarget(2) // try to lower to save streak
      // max(3, 2) = 3, trained 3 days
      store.evaluateWeek(3, '2026-03-30')
      // Met the higher target (3), but target change still resets streak
      expect(store.weeklyTarget).toBe(2)
      expect(store.streakWeeks).toBe(1) // reset to 1 (met target, but fresh start)
    })

    it('records streak history entry', () => {
      const store = useProgressionStore()
      store.evaluateWeek(3, '2026-03-30')
      expect(store.streakHistory).toHaveLength(1)
      expect(store.streakHistory[0]).toEqual({
        weekStart: '2026-03-30',
        streakCount: 1,
        weeklyTarget: 3,
        combinedMultiplier: 1.1, // 1w=1.0 duration * 3d=1.1 target
      })
    })

    it('trims history to 26 weeks', () => {
      const store = useProgressionStore()
      // Fill with 30 entries
      for (let i = 0; i < 30; i++) {
        store.streakHistory.push({
          weekStart: `2025-${String(Math.floor(i / 4) + 1).padStart(2, '0')}-${String((i % 4) * 7 + 1).padStart(2, '0')}`,
          streakCount: i,
          weeklyTarget: 3,
          combinedMultiplier: 1.0,
        })
      }
      store.evaluateWeek(3, '2026-04-06')
      expect(store.streakHistory.length).toBeLessThanOrEqual(26)
    })
  })

  // ── checkUnlocks ──────────────────────────────────────────────

  describe('checkUnlocks', () => {
    it('unlocks themes when XP thresholds are met', () => {
      const store = useProgressionStore()
      store.totalXP = 15_000
      store.starterTheme = 'fire'
      const unlocked = store.checkUnlocks()
      expect(unlocked.length).toBeGreaterThan(0)
      expect(unlockedIds(store)).toContain('fire') // level 1 starter
      expect(unlockedIds(store)).toContain('air')  // level 2
    })

    it('does not unlock themes below XP threshold', () => {
      const store = useProgressionStore()
      store.totalXP = 3_000
      store.starterTheme = 'fire'
      store.checkUnlocks()
      expect(unlockedIds(store)).toEqual(['pearl']) // only default
    })

    it('returns empty array when no new unlocks', () => {
      const store = useProgressionStore()
      store.totalXP = 0
      expect(store.checkUnlocks()).toEqual([])
    })

    it('skips starter slot if no starter theme chosen', () => {
      const store = useProgressionStore()
      store.totalXP = 5_000
      store.starterTheme = null
      store.checkUnlocks()
      // Level 1 has null themeId and no starter chosen — skipped
      expect(unlockedIds(store)).toEqual(['pearl'])
    })

    it('is idempotent — calling twice does not duplicate unlocks', () => {
      const store = useProgressionStore()
      store.totalXP = 15_000
      store.starterTheme = 'fire'
      store.checkUnlocks()
      store.checkUnlocks()
      const fireCount = unlockedIds(store).filter(t => t === 'fire').length
      expect(fireCount).toBe(1)
    })
  })

  // ── setStarterTheme ───────────────────────────────────────────

  describe('setStarterTheme', () => {
    it('sets the starter theme and immediately unlocks it', () => {
      const store = useProgressionStore()
      store.setStarterTheme('water')
      expect(store.starterTheme).toBe('water')
      expect(unlockedIds(store)).toContain('water')
    })

    it('is one-time only — ignores subsequent calls', () => {
      const store = useProgressionStore()
      store.setStarterTheme('water')
      store.setStarterTheme('fire')
      expect(store.starterTheme).toBe('water')
    })

    it('sets weeklyTarget atomically with starter theme (prevents stale default sync)', () => {
      const store = useProgressionStore()
      expect(store.weeklyTarget).toBe(3) // default
      store.setStarterTheme('fire', 5)
      expect(store.weeklyTarget).toBe(5)
      expect(store.starterTheme).toBe('fire')
      expect(store.progressionEnabled).toBe(true)
      // Verify it was persisted
      const saved = JSON.parse(localStorage.getItem('user-progression')!)
      expect(saved.weeklyTarget).toBe(5)
    })

    it('does not change weeklyTarget when not provided', () => {
      const store = useProgressionStore()
      store.weeklyTarget = 4
      store.setStarterTheme('water')
      expect(store.weeklyTarget).toBe(4)
    })
  })

  // ── setShowProgression ────────────────────────────────────────

  describe('setShowProgression', () => {
    it('toggles verbose/quiet mode', () => {
      const store = useProgressionStore()
      expect(store.showProgression).toBe(true)
      store.setShowProgression(false)
      expect(store.showProgression).toBe(false)
    })
  })

  // ── Getters ───────────────────────────────────────────────────

  describe('getters', () => {
    it('currentLevel returns correct level for XP', () => {
      const store = useProgressionStore()
      expect(store.currentLevel).toBe(0)
      store.totalXP = 5_000
      expect(store.currentLevel).toBe(1)
      store.totalXP = 80_000
      expect(store.currentLevel).toBe(4)
      store.totalXP = 1_000_000
      expect(store.currentLevel).toBe(8)
    })

    it('nextUnlockThreshold returns next tier XP', () => {
      const store = useProgressionStore()
      expect(store.nextUnlockThreshold).toBe(5_000) // level 1
      store.totalXP = 5_000
      expect(store.nextUnlockThreshold).toBe(15_000) // level 2
    })

    it('nextUnlockThreshold returns null when all unlocked', () => {
      const store = useProgressionStore()
      store.totalXP = 2_000_000
      expect(store.nextUnlockThreshold).toBeNull()
    })

    it('xpToNextUnlock returns remaining XP', () => {
      const store = useProgressionStore()
      store.totalXP = 3_000
      expect(store.xpToNextUnlock).toBe(2_000) // 5000 - 3000
    })

    it('xpToNextUnlock returns 0 when all unlocked', () => {
      const store = useProgressionStore()
      store.totalXP = 2_000_000
      expect(store.xpToNextUnlock).toBe(0)
    })

    it('progressPercent computes progress within current tier', () => {
      const store = useProgressionStore()
      store.totalXP = 0
      expect(store.progressPercent).toBe(0)

      // Halfway between level 0 (0) and level 1 (5000) = 50%
      store.totalXP = 2_500
      expect(store.progressPercent).toBe(50)

      // Between level 1 (5000) and level 2 (15000): 10000 is halfway
      store.totalXP = 10_000
      expect(store.progressPercent).toBe(50)
    })

    it('progressPercent returns 100 when all unlocked', () => {
      const store = useProgressionStore()
      store.totalXP = 2_000_000
      expect(store.progressPercent).toBe(100)
    })

    it('currentMultiplier returns 1.0 with no streak', () => {
      const store = useProgressionStore()
      expect(store.currentMultiplier).toBe(1.0)
    })

    it('currentMultiplier stacks duration and target', () => {
      const store = useProgressionStore()
      store.streakWeeks = 4
      store.weeklyTarget = 5
      // duration: 4w=1.25, target: 5d=1.3 → 1.625
      expect(store.currentMultiplier).toBe(1.625)
    })

    it('effectiveTarget returns current weeklyTarget', () => {
      const store = useProgressionStore()
      store.weeklyTarget = 4
      store.pendingTargetChange = 6
      // During grace period, effective is still the current target
      expect(store.effectiveTarget).toBe(4)
    })

    it('totalPRCount counts sets with isPR true', () => {
      const store = useProgressionStore()
      expect(store.totalPRCount).toBe(0)

      // Add a non-PR set (legacy number format)
      store.xpPerSet['s1'] = 50
      expect(store.totalPRCount).toBe(0)

      // Add a non-PR set (object format)
      store.xpPerSet['s2'] = { xp: 80, theme: 'fire', epoch: 1, zone: 'working', isPR: false, isRepPR: false }
      expect(store.totalPRCount).toBe(0)

      // Add a PR set
      store.xpPerSet['s3'] = { xp: 200, theme: 'fire', epoch: 1, zone: 'pr', isPR: true, isRepPR: false }
      expect(store.totalPRCount).toBe(1)

      // Add another PR set
      store.xpPerSet['s4'] = { xp: 250, theme: 'water', epoch: 1, zone: 'pr', isPR: true, isRepPR: false }
      expect(store.totalPRCount).toBe(2)
    })
  })

  // ── getTrainingDaysInWeek ─────────────────────────────────────

  describe('getTrainingDaysInWeek', () => {
    it('counts unique training days within a Mon-Sun window', () => {
      const dates = [
        '2026-03-30T10:00:00Z', // Monday
        '2026-03-30T18:00:00Z', // Monday again (same day)
        '2026-04-01T10:00:00Z', // Wednesday
        '2026-04-03T10:00:00Z', // Friday
      ]
      expect(getTrainingDaysInWeek(dates, '2026-03-30', '2026-04-05')).toBe(3)
    })

    it('excludes sets outside the week window', () => {
      const dates = [
        '2026-03-29T10:00:00Z', // Sunday before
        '2026-03-30T10:00:00Z', // Monday (in)
        '2026-04-06T10:00:00Z', // Monday after
      ]
      expect(getTrainingDaysInWeek(dates, '2026-03-30', '2026-04-05')).toBe(1)
    })

    it('returns 0 for empty dates', () => {
      expect(getTrainingDaysInWeek([], '2026-03-30', '2026-04-05')).toBe(0)
    })

    it('includes Sunday as the last day of the week', () => {
      expect(getTrainingDaysInWeek(['2026-04-05T23:59:00Z'], '2026-03-30', '2026-04-05')).toBe(1)
    })
  })

  // ── evaluatePendingWeeks ──────────────────────────────────────

  describe('evaluatePendingWeeks', () => {
    it('evaluates one missed week', () => {
      const store = useProgressionStore()
      const dates = [
        '2026-03-23T10:00:00Z', // Mon
        '2026-03-25T10:00:00Z', // Wed
        '2026-03-27T10:00:00Z', // Fri
      ]
      store.evaluatePendingWeeks(dates, new Date('2026-03-30T10:00:00Z'))
      expect(store.streakHistory).toHaveLength(1)
      expect(store.streakHistory[0].weekStart).toBe('2026-03-23')
      expect(store.streakWeeks).toBe(1) // met target of 3
    })

    it('evaluates multiple missed weeks', () => {
      const store = useProgressionStore()
      const dates = [
        // Week of Mar 16: 3 days → met
        '2026-03-16T10:00:00Z',
        '2026-03-18T10:00:00Z',
        '2026-03-20T10:00:00Z',
        // Week of Mar 23: 1 day → missed
        '2026-03-24T10:00:00Z',
        // Week of Mar 30: 4 days → met
        '2026-03-30T10:00:00Z',
        '2026-04-01T10:00:00Z',
        '2026-04-03T10:00:00Z',
        '2026-04-04T10:00:00Z',
      ]
      store.evaluatePendingWeeks(dates, new Date('2026-04-06T10:00:00Z'))
      expect(store.streakHistory).toHaveLength(3)
      expect(store.streakWeeks).toBe(1) // reset after miss, then 1 for last week
    })

    it('does not evaluate the current (incomplete) week', () => {
      const store = useProgressionStore()
      const dates = [
        '2026-03-30T10:00:00Z', // Mon of current week
        '2026-04-01T10:00:00Z', // Wed of current week
      ]
      store.evaluatePendingWeeks(dates, new Date('2026-04-01T10:00:00Z'))
      expect(store.streakHistory).toHaveLength(0)
    })

    // Regression LIFT-1214: getMonday used UTC calendar components, so for a
    // US-timezone user a Sunday evening (already Monday in UTC) closed the
    // current week before their Sunday session was counted — one workout
    // short, streak reset. Week boundaries must follow the LOCAL calendar,
    // matching the local set-date keys (#746).
    it('keeps the current week open on a US-timezone Sunday evening (LIFT-1214)', () => {
      withTZ('America/Los_Angeles', () => {
        const store = useProgressionStore()
        // Only Monday logged so far — the user is about to log their Sunday
        // session when they open the app at 6 PM PDT (= Monday 01:00 UTC).
        const dates = ['2026-03-23T10:00:00Z']
        store.evaluatePendingWeeks(dates, new Date(2026, 2, 29, 18, 0, 0))
        // Pre-fix: the Mar 23 week was evaluated as missed right here.
        expect(store.streakHistory).toHaveLength(0)
      })
    })

    it('closes the finished week on a UTC+ Monday morning (LIFT-1214)', () => {
      withTZ('Asia/Tokyo', () => {
        const store = useProgressionStore()
        const dates = [
          '2026-03-23T10:00:00Z',
          '2026-03-25T10:00:00Z',
          '2026-03-27T10:00:00Z',
        ]
        // Monday Mar 30, 8 AM JST is still Sunday 23:00 UTC — pre-fix the
        // finished week wasn't evaluated until UTC caught up.
        store.evaluatePendingWeeks(dates, new Date(2026, 2, 30, 8, 0, 0))
        expect(store.streakHistory).toHaveLength(1)
        expect(store.streakHistory[0].weekStart).toBe('2026-03-23')
        expect(store.streakWeeks).toBe(1)
      })
    })

    it('skips weeks already in history', () => {
      const store = useProgressionStore()
      store.streakHistory.push({
        weekStart: '2026-03-23',
        streakCount: 1,
        weeklyTarget: 3,
        combinedMultiplier: 1.1,
      })
      store.streakWeeks = 1

      const dates = [
        '2026-03-30T10:00:00Z',
        '2026-04-01T10:00:00Z',
        '2026-04-03T10:00:00Z',
      ]
      store.evaluatePendingWeeks(dates, new Date('2026-04-06T10:00:00Z'))
      expect(store.streakHistory).toHaveLength(2)
      expect(store.streakWeeks).toBe(2)
    })

    it('is a no-op with no dates and no history', () => {
      const store = useProgressionStore()
      store.evaluatePendingWeeks([], new Date('2026-04-06T10:00:00Z'))
      expect(store.streakHistory).toHaveLength(0)
    })

    it('handles weeks with zero training days (streak breaks)', () => {
      const store = useProgressionStore()
      const dates = [
        '2026-03-16T10:00:00Z',
        '2026-03-18T10:00:00Z',
        '2026-03-20T10:00:00Z',
        // Week 2 (Mar 23): nothing
        // Week 3 (Mar 30): nothing
      ]
      store.evaluatePendingWeeks(dates, new Date('2026-04-06T10:00:00Z'))
      expect(store.streakHistory).toHaveLength(3)
      expect(store.streakWeeks).toBe(0) // broken by empty weeks
    })
  })

  // ── computeWeekXP ────────────────────────────────────────────

  describe('computeWeekXP', () => {
    it('sums XP from sets in the given week', () => {
      const xpPerSet: Record<string, SetXPEntry | number> = {
        's1': { xp: 10, theme: 'fire', epoch: 0, zone: 'working', isPR: false, isRepPR: false },
        's2': { xp: 25, theme: 'fire', epoch: 0, zone: 'pr', isPR: true, isRepPR: false },
        's3': { xp: 5, theme: 'water', epoch: 0, zone: 'warmup', isPR: false, isRepPR: false },
      }
      const setIdToDate: Record<string, string> = {
        's1': '2026-03-23',
        's2': '2026-03-25',
        's3': '2026-03-30', // next week
      }
      expect(computeWeekXP(xpPerSet, [], setIdToDate, '2026-03-23', '2026-03-29')).toBe(35)
    })

    it('includes bodyweight XP for dates in the week', () => {
      const xpPerSet: Record<string, SetXPEntry | number> = {
        's1': { xp: 10, theme: 'fire', epoch: 0, zone: 'working', isPR: false, isRepPR: false },
      }
      const setIdToDate: Record<string, string> = { 's1': '2026-03-23' }
      const bodyweightDates = ['2026-03-24', '2026-03-26', '2026-03-30']
      const result = computeWeekXP(xpPerSet, bodyweightDates, setIdToDate, '2026-03-23', '2026-03-29')
      expect(result).toBe(10 + 2 * XP_CONFIG.bodyweightXP)
    })

    it('handles legacy number format in xpPerSet', () => {
      const xpPerSet: Record<string, SetXPEntry | number> = {
        's1': 15, // legacy number
        's2': { xp: 20, theme: 'fire', epoch: 0, zone: 'working', isPR: false, isRepPR: false },
      }
      const setIdToDate: Record<string, string> = { 's1': '2026-03-23', 's2': '2026-03-24' }
      expect(computeWeekXP(xpPerSet, [], setIdToDate, '2026-03-23', '2026-03-29')).toBe(35)
    })

    it('returns 0 when no sets fall in the week', () => {
      const xpPerSet: Record<string, SetXPEntry | number> = {
        's1': { xp: 10, theme: 'fire', epoch: 0, zone: 'working', isPR: false, isRepPR: false },
      }
      const setIdToDate: Record<string, string> = { 's1': '2026-03-30' }
      expect(computeWeekXP(xpPerSet, [], setIdToDate, '2026-03-23', '2026-03-29')).toBe(0)
    })

    it('ignores sets not in setIdToDate map', () => {
      const xpPerSet: Record<string, SetXPEntry | number> = {
        's1': { xp: 10, theme: 'fire', epoch: 0, zone: 'working', isPR: false, isRepPR: false },
        'orphan': { xp: 99, theme: 'fire', epoch: 0, zone: 'working', isPR: false, isRepPR: false },
      }
      const setIdToDate: Record<string, string> = { 's1': '2026-03-23' }
      expect(computeWeekXP(xpPerSet, [], setIdToDate, '2026-03-23', '2026-03-29')).toBe(10)
    })
  })

  // ── evaluatePendingWeeks with weekXP ────────────────────────

  describe('evaluatePendingWeeks with setIdToDate', () => {
    it('passes computed weekXP to logWeeklySnapshot', () => {
      const store = useProgressionStore()
      store.xpPerSet = {
        's1': { xp: 10, theme: 'fire', epoch: 0, zone: 'working', isPR: false, isRepPR: false },
        's2': { xp: 20, theme: 'fire', epoch: 0, zone: 'pr', isPR: true, isRepPR: false },
      }
      const dates = ['2026-03-23', '2026-03-25', '2026-03-27']
      const setIdToDate: Record<string, string> = { 's1': '2026-03-23', 's2': '2026-03-25' }
      store.evaluatePendingWeeks(dates, new Date('2026-03-30T10:00:00Z'), setIdToDate)
      expect(store.streakHistory).toHaveLength(1)
    })

    it('falls back to 0 weekXP when setIdToDate not provided', () => {
      const store = useProgressionStore()
      const dates = ['2026-03-23', '2026-03-25', '2026-03-27']
      store.evaluatePendingWeeks(dates, new Date('2026-03-30T10:00:00Z'))
      expect(store.streakHistory).toHaveLength(1)
    })
  })

  // ── reEvaluateStreaks ──────────────────────────────────────────

  describe('reEvaluateStreaks', () => {
    it('re-evaluates all history using current weeklyTarget (regression: stale target from Supabase)', () => {
      const store = useProgressionStore()
      // Simulate: streak was originally evaluated with target 3
      store.weeklyTarget = 3
      const dates = ['2026-03-03', '2026-03-04', '2026-03-05',  // week 1: 3 days
                     '2026-03-10', '2026-03-11', '2026-03-12',  // week 2: 3 days
                     '2026-03-17', '2026-03-18', '2026-03-19']  // week 3: 3 days
      store.evaluatePendingWeeks(dates, new Date('2026-03-24T10:00:00Z'))
      expect(store.streakWeeks).toBe(3)
      expect(store.streakHistory).toHaveLength(3)

      // Now fix the target to 4 and re-evaluate — all weeks had only 3 days, so streak breaks
      store.weeklyTarget = 4
      store.reEvaluateStreaks(dates, new Date('2026-03-24T10:00:00Z'))
      expect(store.streakWeeks).toBe(0)
      expect(store.streakHistory).toHaveLength(3)
      expect(store.streakHistory.every(h => h.weeklyTarget === 4)).toBe(true)
    })

    it('preserves streak for weeks that meet the corrected target', () => {
      const store = useProgressionStore()
      store.weeklyTarget = 3
      const dates = ['2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06',  // week 1: 4 days
                     '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13',  // week 2: 4 days
                     '2026-03-17', '2026-03-18', '2026-03-19', '2026-03-20']  // week 3: 4 days
      store.evaluatePendingWeeks(dates, new Date('2026-03-24T10:00:00Z'))
      expect(store.streakWeeks).toBe(3)

      // Re-evaluate at target 4 — still met
      store.weeklyTarget = 4
      store.reEvaluateStreaks(dates, new Date('2026-03-24T10:00:00Z'))
      expect(store.streakWeeks).toBe(3)
    })

    it('clears pending target change before re-evaluating', () => {
      const store = useProgressionStore()
      store.weeklyTarget = 3
      store.pendingTargetChange = 5
      const dates = ['2026-03-03', '2026-03-04', '2026-03-05']
      store.reEvaluateStreaks(dates, new Date('2026-03-10T10:00:00Z'))
      expect(store.pendingTargetChange).toBeNull()
    })
  })

  // ── Merge functions (cross-device sync) ───────────────────────

  describe('mergeXpPerSet', () => {
    it('unions keys from local and remote', () => {
      const local = { 's1': 50, 's2': 100 }
      const remote = { 's2': 80, 's3': 200 }
      const merged = mergeXpPerSet(local, remote)
      expect(Object.keys(merged).sort()).toEqual(['s1', 's2', 's3'])
    })

    it('keeps higher XP on conflict', () => {
      const local = { 's1': 100 }
      const remote: Record<string, SetXPEntry | number> = {
        's1': { xp: 150, theme: 'fire', epoch: 1, zone: 'pr', isPR: true, isRepPR: false }
      }
      const merged = mergeXpPerSet(local, remote)
      expect(merged['s1']).toEqual(remote['s1']) // remote wins (150 > 100)
    })

    it('keeps local when local XP is higher', () => {
      const local: Record<string, SetXPEntry | number> = {
        's1': { xp: 200, theme: 'fire', epoch: 1, zone: 'pr', isPR: true, isRepPR: false }
      }
      const remote = { 's1': 100 }
      const merged = mergeXpPerSet(local, remote)
      expect(merged['s1']).toEqual(local['s1']) // local wins (200 > 100)
    })
  })

  describe('mergeUnlockedThemes', () => {
    it('unions themes from both lists', () => {
      const local = [{ id: 'pearl' as const, unlockedAt: '2026-01-01' }]
      const remote = [
        { id: 'pearl' as const, unlockedAt: '2026-01-02' },
        { id: 'fire' as const, unlockedAt: '2026-03-01' },
      ]
      const merged = mergeUnlockedThemes(local, remote)
      expect(merged.map(t => t.id).sort()).toEqual(['fire', 'pearl'])
    })

    it('keeps earliest unlock timestamp on conflict', () => {
      const local = [{ id: 'pearl' as const, unlockedAt: '2026-01-01' }]
      const remote = [{ id: 'pearl' as const, unlockedAt: '2026-01-05' }]
      const merged = mergeUnlockedThemes(local, remote)
      expect(merged[0].unlockedAt).toBe('2026-01-01')
    })
  })

  describe('mergeBodyweightDates', () => {
    it('unions and sorts dates', () => {
      const merged = mergeBodyweightDates(
        ['2026-03-01', '2026-03-03'],
        ['2026-03-02', '2026-03-03'],
      )
      expect(merged).toEqual(['2026-03-01', '2026-03-02', '2026-03-03'])
    })
  })

  // ── Full streak lifecycle ─────────────────────────────────────

  describe('streak lifecycle', () => {
    it('clearing pending change before evaluation preserves streak', () => {
      const store = useProgressionStore()
      // Build a 2-week streak
      store.evaluateWeek(3, '2026-03-16')
      store.evaluateWeek(4, '2026-03-23')
      expect(store.streakWeeks).toBe(2)

      // Stage a change mid-week, then clear it
      store.setWeeklyTarget(6)
      expect(store.pendingTargetChange).toBe(6)
      store.pendingTargetChange = null

      // Evaluate the current week — streak should continue normally
      store.evaluateWeek(3, '2026-03-30')
      expect(store.streakWeeks).toBe(3)
      expect(store.weeklyTarget).toBe(3) // unchanged
    })

    it('streak history multipliers step correctly over time', () => {
      const store = useProgressionStore()
      // Simulate 12 consecutive weeks hitting target
      for (let i = 0; i < 12; i++) {
        const monday = new Date(Date.UTC(2026, 0, 5 + i * 7)) // Jan 5, 12, 19...
        const weekStr = monday.toISOString().slice(0, 10)
        store.evaluateWeek(3, weekStr)
      }

      expect(store.streakWeeks).toBe(12)

      // Check multiplier progression in history
      // Target=3 → targetMult=1.1
      // Week 1: dur=1.0, combined=1.1
      expect(store.streakHistory[0].combinedMultiplier).toBe(1.1)
      // Week 2: dur=1.1, combined=1.21
      expect(store.streakHistory[1].combinedMultiplier).toBe(1.21)
      // Week 4: dur=1.25, combined=1.375
      expect(store.streakHistory[3].combinedMultiplier).toBe(1.375)
      // Week 8: dur=1.5, combined=1.65
      expect(store.streakHistory[7].combinedMultiplier).toBe(1.65)
      // Week 12: dur=1.75, combined=1.925
      expect(store.streakHistory[11].combinedMultiplier).toBe(1.925)
    })

    it('broken streak resets multiplier to 1.0 in history', () => {
      const store = useProgressionStore()
      store.evaluateWeek(3, '2026-03-16') // streak=1
      store.evaluateWeek(3, '2026-03-23') // streak=2
      store.evaluateWeek(0, '2026-03-30') // miss → streak=0

      const lastEntry = store.streakHistory[2]
      expect(lastEntry.streakCount).toBe(0)
      // streakWeeks=0 → duration falls through to 1.0, target=3 → 1.1
      // History records the raw combined (1.0 × 1.1 = 1.1)
      // The applyStreakMultiplier in xp.ts gates on streakCount < 1 and returns baseXP
      expect(lastEntry.combinedMultiplier).toBe(1.1)
    })
  })
})
