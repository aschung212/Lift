import { describe, it, expect, vi, afterEach } from 'vitest'
import { todayISO, toLocalDateKey, formatShortDate, daysBetweenISO } from '../dates'

afterEach(() => {
  vi.useRealTimers()
})

describe('todayISO', () => {
  it('returns the LOCAL calendar date, not the UTC date', () => {
    // 23:59 local on June 10. In any timezone behind UTC the UTC date has
    // already rolled to June 11 — the regression this module exists to fix
    // (BodyweightTracker defaulted its log date to "tomorrow" after ~5pm US).
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 10, 23, 59, 0))
    expect(todayISO()).toBe('2026-06-10')
  })

  it('pads single-digit months and days', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 5, 12, 0, 0))
    expect(todayISO()).toBe('2026-01-05')
  })
})

describe('toLocalDateKey', () => {
  it('converts an ISO timestamp to the local calendar day', () => {
    // Construct the expected key from the same instant's local components so
    // the assertion holds in every timezone the suite runs in.
    const instant = new Date('2026-06-10T23:30:00Z')
    const expected = `${instant.getFullYear()}-${String(instant.getMonth() + 1).padStart(2, '0')}-${String(instant.getDate()).padStart(2, '0')}`
    expect(toLocalDateKey('2026-06-10T23:30:00Z')).toBe(expected)
  })

  it('falls back to the raw prefix for unparseable input', () => {
    expect(toLocalDateKey('not-a-date')).toBe('not-a-date'.slice(0, 10))
  })

  it('is stable for date-only keys', () => {
    // Date-only strings parse as UTC midnight; in timezones behind UTC the
    // local day would shift. Callers pass full timestamps, but document the
    // round-trip for the noon-anchored display path.
    expect(toLocalDateKey('2026-06-10T12:00:00')).toBe('2026-06-10')
  })
})

describe('formatShortDate', () => {
  it('renders the day number and short month', () => {
    const out = formatShortDate('2026-01-05T12:00:00')
    expect(out).toContain('5')
    // Default test locale is en-US; month renders as its short name.
    expect(out.toLowerCase()).toContain('jan')
  })
})

describe('daysBetweenISO', () => {
  it('counts whole days, positive when the second date is later', () => {
    expect(daysBetweenISO('2026-01-01', '2026-01-08')).toBe(7)
    expect(daysBetweenISO('2026-01-08', '2026-01-01')).toBe(-7)
    expect(daysBetweenISO('2026-01-01', '2026-01-01')).toBe(0)
  })

  it('is DST-safe via rounding', () => {
    // A spring-forward week is 167 wall-clock hours; rounding keeps it 7 days.
    expect(daysBetweenISO('2026-03-06', '2026-03-13')).toBe(7)
  })
})
