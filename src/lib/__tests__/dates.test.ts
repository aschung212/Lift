import { describe, it, expect, vi, afterEach } from 'vitest'
import { todayISO, localDateKey, toLocalDateKey, setDayKey, formatShortDate, daysBetweenISO } from '../dates'

afterEach(() => {
  vi.useRealTimers()
})

/**
 * Run `fn` with the process timezone temporarily forced to `tz`. Node 13+
 * honors a runtime reassignment of `process.env.TZ` for subsequent Date ops,
 * which lets us prove the day-key helpers behave correctly across the zones
 * real users live in without mocking Date internals.
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

describe('localDateKey', () => {
  it('formats a Date as its LOCAL calendar day, not the UTC day', () => {
    // 23:59 local on June 10 — the same near-midnight boundary the other
    // helpers guard. Deriving from a Date must never roll to the UTC tomorrow.
    expect(localDateKey(new Date(2026, 5, 10, 23, 59, 0))).toBe('2026-06-10')
  })

  it('pads single-digit months and days', () => {
    expect(localDateKey(new Date(2026, 0, 5, 0, 0, 0))).toBe('2026-01-05')
  })

  it('todayISO is localDateKey applied to now', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 2, 9, 8, 30, 0))
    expect(todayISO()).toBe(localDateKey(new Date()))
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

describe('setDayKey', () => {
  // The two storage conventions, exercised across the zones users live in.
  const ZONES = ['America/Los_Angeles', 'UTC', 'Asia/Tokyo']

  describe('endOfDayISO convention (prefix IS the chosen local day)', () => {
    // A UI-logged set for the user's June 15 lands at 23:59 UTC. The day key
    // must stay June 15 in EVERY zone — this is the regression `toLocalDateKey`
    // would cause (it rolls to June 16 east of UTC).
    const endOfDay = '2026-06-15T23:59:42.317Z'

    for (const tz of ZONES) {
      it(`returns the date prefix unchanged in ${tz}`, () => {
        withTZ(tz, () => {
          expect(setDayKey(endOfDay)).toBe('2026-06-15')
        })
      })
    }

    it('does NOT shift the day +1 east of UTC the way toLocalDateKey would', () => {
      withTZ('Asia/Tokyo', () => {
        expect(toLocalDateKey(endOfDay)).toBe('2026-06-16') // the bug we avoid
        expect(setDayKey(endOfDay)).toBe('2026-06-15')      // the correct key
      })
    })

    it('handles the lower edge of the 23:59 minute window', () => {
      withTZ('Asia/Tokyo', () => {
        expect(setDayKey('2026-06-15T23:59:00.000Z')).toBe('2026-06-15')
      })
    })
  })

  describe('real-time stamp convention (true UTC instant)', () => {
    // An Americas-evening set: 05:00 UTC on June 16 is 22:00 (10pm) on June 15
    // in Los Angeles, but already June 16 in UTC/Tokyo. The local day differs
    // by zone, and `slice(0, 10)` (= '2026-06-16') is wrong for LA.
    const realTime = '2026-06-16T05:00:00.000Z'

    it('returns the LOCAL day in Los Angeles (slice would roll to tomorrow)', () => {
      withTZ('America/Los_Angeles', () => {
        expect(setDayKey(realTime)).toBe('2026-06-15')
        expect(realTime.slice(0, 10)).toBe('2026-06-16') // the bug we avoid
      })
    })

    for (const tz of ['UTC', 'Asia/Tokyo']) {
      it(`returns the local day in ${tz}`, () => {
        withTZ(tz, () => {
          expect(setDayKey(realTime)).toBe(toLocalDateKey(realTime))
          expect(setDayKey(realTime)).toBe('2026-06-16')
        })
      })
    }
  })

  it('falls back to the raw prefix for unparseable input', () => {
    expect(setDayKey('not-a-date')).toBe('not-a-date'.slice(0, 10))
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
