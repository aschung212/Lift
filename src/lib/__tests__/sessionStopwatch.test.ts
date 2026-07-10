import { describe, it, expect } from 'vitest'
import {
  formatSessionClock,
  resolveSessionStart,
  isStoredSessionStart,
  type StoredSessionStart,
} from '../sessionStopwatch'

describe('formatSessionClock', () => {
  it('formats sub-minute spans as M:SS with padded seconds', () => {
    expect(formatSessionClock(0)).toBe('0:00')
    expect(formatSessionClock(7_000)).toBe('0:07')
    expect(formatSessionClock(59_000)).toBe('0:59')
  })

  it('formats minute spans without zero-padding the minutes', () => {
    expect(formatSessionClock(60_000)).toBe('1:00')
    expect(formatSessionClock(24 * 60_000 + 31_000)).toBe('24:31')
  })

  it('adds an hour field with padded minutes past 60 minutes', () => {
    expect(formatSessionClock(3_600_000)).toBe('1:00:00')
    expect(formatSessionClock(3_600_000 + 5 * 60_000 + 9_000)).toBe('1:05:09')
    expect(formatSessionClock(2 * 3_600_000 + 10_000)).toBe('2:00:10')
  })

  it('truncates sub-second remainders rather than rounding up', () => {
    expect(formatSessionClock(7_999)).toBe('0:07')
    expect(formatSessionClock(59_950)).toBe('0:59')
  })

  it('clamps negative, NaN, and infinite spans to 0:00', () => {
    expect(formatSessionClock(-5_000)).toBe('0:00')
    expect(formatSessionClock(Number.NaN)).toBe('0:00')
    expect(formatSessionClock(Number.POSITIVE_INFINITY)).toBe('0:00')
  })
})

describe('isStoredSessionStart', () => {
  it('accepts a well-formed blob', () => {
    expect(isStoredSessionStart({ dayKey: '2026-07-09', startedAt: 123 })).toBe(true)
  })

  it('rejects junk and corrupt shapes', () => {
    expect(isStoredSessionStart(null)).toBe(false)
    expect(isStoredSessionStart('nope')).toBe(false)
    expect(isStoredSessionStart([])).toBe(false)
    expect(isStoredSessionStart({ dayKey: '', startedAt: 1 })).toBe(false)
    expect(isStoredSessionStart({ dayKey: '2026-07-09' })).toBe(false)
    expect(isStoredSessionStart({ dayKey: '2026-07-09', startedAt: 'x' })).toBe(false)
    expect(isStoredSessionStart({ dayKey: '2026-07-09', startedAt: Number.NaN })).toBe(false)
  })
})

describe('resolveSessionStart', () => {
  const NOW = 1_700_000_000_000
  const stored: StoredSessionStart = { dayKey: '2026-07-09', startedAt: NOW - 60_000 }

  it('returns null when no sets are logged today (no active session)', () => {
    expect(resolveSessionStart(stored, '2026-07-09', false, NOW)).toBeNull()
    expect(resolveSessionStart(null, '2026-07-09', false, NOW)).toBeNull()
  })

  it('trusts a stored start for today so the clock survives a reload', () => {
    expect(resolveSessionStart(stored, '2026-07-09', true, NOW)).toBe(NOW - 60_000)
  })

  it('starts fresh at now when there is no stored value', () => {
    expect(resolveSessionStart(null, '2026-07-09', true, NOW)).toBe(NOW)
  })

  it('ignores a stored start from a previous day (day rollover)', () => {
    expect(resolveSessionStart(stored, '2026-07-10', true, NOW)).toBe(NOW)
  })

  it('ignores a future stored start from a backward clock change', () => {
    const future: StoredSessionStart = { dayKey: '2026-07-09', startedAt: NOW + 5_000 }
    expect(resolveSessionStart(future, '2026-07-09', true, NOW)).toBe(NOW)
  })
})
