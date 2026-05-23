import { describe, it, expect, vi } from 'vitest'
import type { ThemeUnlock, StreakWeekEntry, SetXPEntry } from '../../stores/progression'
import {
  themeUnlocksToJson,
  streakHistoryToJson,
  xpPerSetToJson,
  bodyweightDatesToJson,
  parseStreakHistory,
  parseUnlockedThemes,
  parseXpPerSet,
  parseBodyweightDates,
} from '../jsonColumns'
import type { Json } from '../database.types'

vi.mock('../logger', () => ({
  logWarn: vi.fn(),
  logError: vi.fn(),
}))

describe('jsonColumns', () => {
  // ── Round-trip: write → read ────────────────────────────────────

  describe('ThemeUnlock round-trip', () => {
    it('round-trips ThemeUnlock[] through toJson/parse', () => {
      const themes: ThemeUnlock[] = [
        { id: 'pearl', unlockedAt: '2026-01-01T00:00:00Z' },
        { id: 'fire', unlockedAt: '2026-02-15T10:30:00Z', totalXPAtUnlock: 5000, totalSetsAtUnlock: 100 },
      ]
      const json = themeUnlocksToJson(themes)
      const parsed = parseUnlockedThemes(json)
      expect(parsed).toEqual(themes)
    })

    it('round-trips themes without optional fields', () => {
      const themes: ThemeUnlock[] = [
        { id: 'midnight', unlockedAt: '2026-03-01T00:00:00Z' },
      ]
      const json = themeUnlocksToJson(themes)
      const parsed = parseUnlockedThemes(json)
      expect(parsed).toEqual(themes)
    })
  })

  describe('StreakWeekEntry round-trip', () => {
    it('round-trips StreakWeekEntry[] through toJson/parse', () => {
      const history: StreakWeekEntry[] = [
        { weekStart: '2026-01-06', streakCount: 1, weeklyTarget: 3, combinedMultiplier: 1.0 },
        { weekStart: '2026-01-13', streakCount: 2, weeklyTarget: 4, combinedMultiplier: 1.15 },
      ]
      const json = streakHistoryToJson(history)
      const parsed = parseStreakHistory(json, [])
      expect(parsed).toEqual(history)
    })
  })

  describe('xpPerSet round-trip', () => {
    it('round-trips mixed SetXPEntry and legacy number entries', () => {
      const xpPerSet: Record<string, SetXPEntry | number> = {
        'set-1': { xp: 50, theme: 'fire', epoch: 1, zone: 'strength', isPR: true, isRepPR: false },
        'set-2': 25,  // legacy number format
        'set-3': { xp: 100, theme: 'pearl', epoch: 1, zone: 'hypertrophy', isPR: false, isRepPR: true },
      }
      const json = xpPerSetToJson(xpPerSet)
      const parsed = parseXpPerSet(json, {})
      expect(parsed).toEqual(xpPerSet)
    })

    it('round-trips empty xpPerSet', () => {
      const json = xpPerSetToJson({})
      const parsed = parseXpPerSet(json, {})
      expect(parsed).toEqual({})
    })
  })

  describe('bodyweightXPDates round-trip', () => {
    it('round-trips string[]', () => {
      const dates = ['2026-01-01', '2026-01-15', '2026-02-01']
      const json = bodyweightDatesToJson(dates)
      const parsed = parseBodyweightDates(json, [])
      expect(parsed).toEqual(dates)
    })
  })

  // ── Parse: invalid/corrupt data ─────────────────────────────────

  describe('parseStreakHistory validation', () => {
    it('returns fallback for null', () => {
      const fallback: StreakWeekEntry[] = [
        { weekStart: '2026-01-06', streakCount: 1, weeklyTarget: 3, combinedMultiplier: 1.0 },
      ]
      expect(parseStreakHistory(null, fallback)).toBe(fallback)
    })

    it('returns fallback for non-array', () => {
      expect(parseStreakHistory('not-an-array' as Json, [])).toEqual([])
    })

    it('provides defaults for entries missing numeric fields', () => {
      const result = parseStreakHistory(
        [{ weekStart: '2026-01-06' }] as Json,
        [],
      )
      expect(result).toEqual([
        { weekStart: '2026-01-06', streakCount: 0, weeklyTarget: 3, combinedMultiplier: 1.0 },
      ])
    })

    it('skips invalid entries but keeps valid ones', () => {
      const mixed: Json = [
        { weekStart: '2026-01-06', streakCount: 1, weeklyTarget: 3, combinedMultiplier: 1.0 },
        { weekStart: 123, streakCount: 1, weeklyTarget: 3, combinedMultiplier: 1.0 },  // invalid weekStart type
        { weekStart: '2026-01-20', streakCount: 3, weeklyTarget: 3, combinedMultiplier: 1.1 },
      ]
      const result = parseStreakHistory(mixed, [])
      expect(result).toEqual([
        { weekStart: '2026-01-06', streakCount: 1, weeklyTarget: 3, combinedMultiplier: 1.0 },
        { weekStart: '2026-01-20', streakCount: 3, weeklyTarget: 3, combinedMultiplier: 1.1 },
      ])
    })

    it('returns fallback when all entries have invalid weekStart', () => {
      const corrupt: Json = [
        { weekStart: 123, streakCount: 1, weeklyTarget: 3, combinedMultiplier: 1.0 },
      ]
      expect(parseStreakHistory(corrupt, [])).toEqual([])
    })

    it('returns empty array for empty remote array (not fallback)', () => {
      const fallback: StreakWeekEntry[] = [
        { weekStart: '2026-01-06', streakCount: 1, weeklyTarget: 3, combinedMultiplier: 1.0 },
      ]
      expect(parseStreakHistory([], fallback)).toEqual([])
    })

    it('parses valid empty array', () => {
      expect(parseStreakHistory([], [])).toEqual([])
    })
  })

  describe('parseUnlockedThemes validation', () => {
    it('returns null for non-array', () => {
      expect(parseUnlockedThemes('not-array')).toBeNull()
    })

    it('returns null for empty array', () => {
      expect(parseUnlockedThemes([])).toBeNull()
    })

    it('handles legacy string[] format', () => {
      const result = parseUnlockedThemes(['pearl', 'fire'])
      expect(result).toHaveLength(2)
      expect(result![0].id).toBe('pearl')
      expect(result![1].id).toBe('fire')
      expect(result![0].unlockedAt).toBeDefined()
    })

    it('skips entries with missing id but keeps valid ones', () => {
      const mixed: Json = [
        { id: 'pearl', unlockedAt: '2026-01-01T00:00:00Z' },
        { unlockedAt: '2026-02-01T00:00:00Z' },  // missing id
      ]
      const result = parseUnlockedThemes(mixed)
      expect(result).toEqual([{ id: 'pearl', unlockedAt: '2026-01-01T00:00:00Z' }])
    })

    it('returns null when all entries are invalid', () => {
      const corrupt: Json = [{ unlockedAt: '2026-01-01T00:00:00Z' }]
      expect(parseUnlockedThemes(corrupt)).toBeNull()
    })
  })

  describe('parseXpPerSet validation', () => {
    it('returns fallback for non-object', () => {
      expect(parseXpPerSet('not-object' as Json, {})).toEqual({})
    })

    it('returns fallback for null', () => {
      expect(parseXpPerSet(null, { 'set-1': 10 })).toEqual({ 'set-1': 10 })
    })

    it('returns fallback for array', () => {
      expect(parseXpPerSet([] as Json, {})).toEqual({})
    })

    it('provides defaults for legacy SetXPEntry missing newer fields', () => {
      const legacy: Json = {
        'set-1': { xp: 50, theme: 'fire' },  // missing epoch, zone, isPR, isRepPR
        'set-2': 25,  // valid legacy number
      }
      const result = parseXpPerSet(legacy, {})
      expect(result).toEqual({
        'set-1': { xp: 50, theme: 'fire', epoch: 1, zone: '', isPR: false, isRepPR: false },
        'set-2': 25,
      })
    })

    it('skips object entries missing xp field', () => {
      const corrupt: Json = {
        'set-1': { theme: 'fire', epoch: 1 },  // missing xp
        'set-2': 25,
      }
      const result = parseXpPerSet(corrupt, {})
      expect(result).toEqual({ 'set-2': 25 })
    })

    it('skips entries that are neither number nor valid object', () => {
      const corrupt: Json = {
        'set-1': 'not-a-number-or-object',
        'set-2': 25,
      }
      const result = parseXpPerSet(corrupt, {})
      expect(result).toEqual({ 'set-2': 25 })
    })
  })

  describe('parseBodyweightDates validation', () => {
    it('returns fallback for non-array', () => {
      expect(parseBodyweightDates('not-array' as Json, ['fallback'])).toEqual(['fallback'])
    })

    it('skips non-string entries and keeps valid ones', () => {
      const corrupt: Json = ['2026-01-01', 42, '2026-01-03']
      expect(parseBodyweightDates(corrupt, [])).toEqual(['2026-01-01', '2026-01-03'])
    })

    it('returns fallback when all entries are invalid', () => {
      const corrupt: Json = [42, true, null]
      expect(parseBodyweightDates(corrupt, ['fallback'])).toEqual(['fallback'])
    })

    it('returns empty array for empty remote array (not fallback)', () => {
      expect(parseBodyweightDates([], ['2026-01-01'])).toEqual([])
    })
  })

  // ── Write helpers produce Json-compatible output ────────────────

  describe('toJson helpers type safety', () => {
    it('themeUnlocksToJson produces array of plain objects', () => {
      const result = themeUnlocksToJson([
        { id: 'pearl', unlockedAt: '2026-01-01T00:00:00Z' },
      ])
      expect(Array.isArray(result)).toBe(true)
      const arr = result as Json[]
      expect(arr[0]).toEqual({ id: 'pearl', unlockedAt: '2026-01-01T00:00:00Z' })
    })

    it('themeUnlocksToJson excludes undefined optional fields', () => {
      const result = themeUnlocksToJson([
        { id: 'fire', unlockedAt: '2026-01-01T00:00:00Z' },
      ])
      const arr = result as Json[]
      const obj = arr[0] as Record<string, Json | undefined>
      expect('totalXPAtUnlock' in obj).toBe(false)
      expect('totalSetsAtUnlock' in obj).toBe(false)
    })

    it('bodyweightDatesToJson creates a copy', () => {
      const dates = ['2026-01-01']
      const result = bodyweightDatesToJson(dates)
      expect(result).toEqual(dates)
      expect(result).not.toBe(dates)
    })
  })
})
