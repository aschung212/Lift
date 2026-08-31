/**
 * #1272 — strength baseline mode (lifetime vs recent).
 *
 * The whole point of this module is that BOTH modes collapse to the one
 * `sinceDate` day key the rest of the app already threads through
 * `getExercisePR` / `calculateBest1RM` / `filterSetsSinceBaseline`. These tests
 * pin that resolution — especially the anchor/window interaction, where the two
 * are both floors and the later one must win.
 */
import { describe, it, expect } from 'vitest'
import {
  sanitizeStrengthBaselineMode,
  sanitizeRecentBaselineWeeks,
  recentWindowStart,
  resolveStrengthBaseline,
  DEFAULT_STRENGTH_BASELINE_MODE,
  DEFAULT_RECENT_BASELINE_WEEKS,
  MIN_RECENT_BASELINE_WEEKS,
  MAX_RECENT_BASELINE_WEEKS,
  STRENGTH_BASELINE_MODES,
} from '../strengthBaseline'

describe('sanitizeStrengthBaselineMode', () => {
  it('accepts both known modes', () => {
    expect(sanitizeStrengthBaselineMode('lifetime')).toBe('lifetime')
    expect(sanitizeStrengthBaselineMode('recent')).toBe('recent')
  })

  it('falls back to the default for anything else', () => {
    for (const bad of [undefined, null, '', 'Recent', 'all-time', 3, {}, []]) {
      expect(sanitizeStrengthBaselineMode(bad)).toBe(DEFAULT_STRENGTH_BASELINE_MODE)
    }
  })

  it('defaults to lifetime so existing users see no behavior change', () => {
    expect(DEFAULT_STRENGTH_BASELINE_MODE).toBe('lifetime')
    expect(STRENGTH_BASELINE_MODES).toEqual(['lifetime', 'recent'])
  })
})

describe('sanitizeRecentBaselineWeeks', () => {
  it('passes through in-range integers', () => {
    expect(sanitizeRecentBaselineWeeks(8)).toBe(8)
    expect(sanitizeRecentBaselineWeeks(MIN_RECENT_BASELINE_WEEKS)).toBe(MIN_RECENT_BASELINE_WEEKS)
    expect(sanitizeRecentBaselineWeeks(MAX_RECENT_BASELINE_WEEKS)).toBe(MAX_RECENT_BASELINE_WEEKS)
  })

  it('clamps out-of-range values instead of dropping them', () => {
    expect(sanitizeRecentBaselineWeeks(0)).toBe(MIN_RECENT_BASELINE_WEEKS)
    expect(sanitizeRecentBaselineWeeks(-40)).toBe(MIN_RECENT_BASELINE_WEEKS)
    expect(sanitizeRecentBaselineWeeks(9999)).toBe(MAX_RECENT_BASELINE_WEEKS)
  })

  it('floors fractional values', () => {
    expect(sanitizeRecentBaselineWeeks(6.9)).toBe(6)
  })

  it('falls back to the default for non-numbers', () => {
    for (const bad of [undefined, null, 'eight', '8', NaN, Infinity, {}, []]) {
      expect(sanitizeRecentBaselineWeeks(bad)).toBe(DEFAULT_RECENT_BASELINE_WEEKS)
    }
  })

  it('does not coerce a missing field down to the most aggressive window', () => {
    // `Number(null)` and `Number([])` are both 0, so a coerce-then-clamp guard
    // would turn a corrupt/absent field into the 2-week MINIMUM — silently the
    // narrowest baseline in the app. Absent means default, not minimum.
    expect(sanitizeRecentBaselineWeeks(null)).not.toBe(MIN_RECENT_BASELINE_WEEKS)
    expect(sanitizeRecentBaselineWeeks([])).not.toBe(MIN_RECENT_BASELINE_WEEKS)
  })

  it('defaults shorter than the 6-month XP fallback, so recent mode always narrows', () => {
    // XP_CONFIG.best1RMWindowMonths is 6 (~26 weeks); the cap must not exceed it
    // or "recent" could widen the window it is supposed to tighten.
    expect(DEFAULT_RECENT_BASELINE_WEEKS).toBeLessThan(26)
    expect(MAX_RECENT_BASELINE_WEEKS).toBeLessThanOrEqual(26)
  })
})

describe('recentWindowStart', () => {
  it('steps back whole weeks on the local calendar', () => {
    expect(recentWindowStart('2026-08-30', 8)).toBe('2026-07-05')
    expect(recentWindowStart('2026-08-30', 2)).toBe('2026-08-16')
  })

  it('crosses month and year boundaries', () => {
    expect(recentWindowStart('2026-01-10', 4)).toBe('2025-12-13')
  })

  it('sanitizes the week count', () => {
    expect(recentWindowStart('2026-08-30', 0)).toBe(recentWindowStart('2026-08-30', MIN_RECENT_BASELINE_WEEKS))
  })

  it('returns null for an unparseable day key rather than inventing a window', () => {
    expect(recentWindowStart('not-a-date', 8)).toBeNull()
  })

  it('spans a DST transition without shifting the boundary a day', () => {
    // US DST forward is 2026-03-08. Millisecond arithmetic (weeks × 7 × 86400000)
    // lands an hour short across that transition and floors to the day before.
    expect(recentWindowStart('2026-03-22', 2)).toBe('2026-03-08')
    expect(recentWindowStart('2026-03-15', 2)).toBe('2026-03-01')
  })
})

describe('resolveStrengthBaseline', () => {
  const today = '2026-08-30'

  it('lifetime mode returns the anchor untouched (null = all time)', () => {
    expect(resolveStrengthBaseline({ mode: 'lifetime', anchor: null, weeks: 8, todayKey: today }))
      .toBeNull()
    expect(resolveStrengthBaseline({ mode: 'lifetime', anchor: '2026-01-01', weeks: 8, todayKey: today }))
      .toBe('2026-01-01')
  })

  it('lifetime mode ignores the window length entirely', () => {
    expect(resolveStrengthBaseline({ mode: 'lifetime', anchor: null, weeks: 2, todayKey: today }))
      .toBeNull()
  })

  it('recent mode with no anchor returns the rolling window start', () => {
    expect(resolveStrengthBaseline({ mode: 'recent', anchor: null, weeks: 8, todayKey: today }))
      .toBe('2026-07-05')
  })

  it('recent mode keeps a NEWER anchor — a fresh training block still shadows the window', () => {
    // Block started 10 days ago; the 8-week window reaches further back, so the
    // block start is the tighter floor and must win.
    expect(resolveStrengthBaseline({ mode: 'recent', anchor: '2026-08-20', weeks: 8, todayKey: today }))
      .toBe('2026-08-20')
  })

  it('recent mode overrides a STALE anchor — an old block no longer sets the bar', () => {
    expect(resolveStrengthBaseline({ mode: 'recent', anchor: '2025-01-01', weeks: 8, todayKey: today }))
      .toBe('2026-07-05')
  })

  it('recent mode with an anchor exactly on the window start is stable', () => {
    expect(resolveStrengthBaseline({ mode: 'recent', anchor: '2026-07-05', weeks: 8, todayKey: today }))
      .toBe('2026-07-05')
  })

  it('a longer window reaches further back', () => {
    const short = resolveStrengthBaseline({ mode: 'recent', anchor: null, weeks: 2, todayKey: today })!
    const long = resolveStrengthBaseline({ mode: 'recent', anchor: null, weeks: 26, todayKey: today })!
    expect(long < short).toBe(true)
  })

  it('falls back to the anchor when today is unparseable', () => {
    expect(resolveStrengthBaseline({ mode: 'recent', anchor: '2026-01-01', weeks: 8, todayKey: 'garbage' }))
      .toBe('2026-01-01')
    expect(resolveStrengthBaseline({ mode: 'recent', anchor: null, weeks: 8, todayKey: 'garbage' }))
      .toBeNull()
  })

  it('is pure — same inputs, same output, no clock read', () => {
    const args = { mode: 'recent' as const, anchor: null, weeks: 8, todayKey: today }
    expect(resolveStrengthBaseline(args)).toBe(resolveStrengthBaseline(args))
  })
})
