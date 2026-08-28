import { describe, it, expect } from 'vitest'
import {
  dailyLatestBodyweight,
  toDisplayWeight,
  buildBodyweightCsv,
  bodyweightCsvFilename,
} from '../bodyweightExport'
import type { BodyweightEntry } from '../../stores/bodyweight'

// Local-noon instants can never cross a day boundary in any timezone, so
// these assertions are TZ-stable in CI.
function entry(id: string, weight: number, day: string): BodyweightEntry {
  return { id, weight, date: new Date(day + 'T12:00:00').toISOString() }
}

// UI-logged storage convention (#746): endOfDayISO writes …T23:59:ssZ where
// the prefix IS the chosen local day.
function endOfDayEntry(id: string, weight: number, day: string): BodyweightEntry {
  return { id, weight, date: day + 'T23:59:00.000Z' }
}

describe('dailyLatestBodyweight', () => {
  it('returns one row per calendar day, ascending', () => {
    const rows = dailyLatestBodyweight([
      entry('b', 181, '2026-08-02'),
      entry('a', 180, '2026-08-01'),
      entry('c', 182, '2026-08-03'),
    ])
    expect(rows).toEqual([
      { date: '2026-08-01', weight: 180 },
      { date: '2026-08-02', weight: 181 },
      { date: '2026-08-03', weight: 182 },
    ])
  })

  it('dedupes same-day entries with the same higher-id rule as the tracker chart', () => {
    const rows = dailyLatestBodyweight([
      entry('id-2', 179, '2026-08-01'),
      entry('id-1', 185, '2026-08-01'),
    ])
    expect(rows).toEqual([{ date: '2026-08-01', weight: 179 }])
  })

  it('buckets end-of-day UI-logged dates by their prefix day (#746)', () => {
    // …T23:59:00Z in a US timezone is the NEXT local day via toLocalDateKey;
    // setDayKey must keep the chosen prefix day instead.
    const rows = dailyLatestBodyweight([endOfDayEntry('a', 183, '2026-08-15')])
    expect(rows).toEqual([{ date: '2026-08-15', weight: 183 }])
  })

  it('returns empty for no entries', () => {
    expect(dailyLatestBodyweight([])).toEqual([])
  })
})

describe('toDisplayWeight', () => {
  it('passes lbs through with one-decimal rounding', () => {
    expect(toDisplayWeight(170, 'lbs')).toBe(170)
    expect(toDisplayWeight(170.26, 'lbs')).toBe(170.3)
  })

  it('converts to kg with the same factor and rounding as useWeightUnit.displayWeight', () => {
    expect(toDisplayWeight(183.4, 'kg')).toBe(+(183.4 * 0.453592).toFixed(1))
    expect(toDisplayWeight(220, 'kg')).toBe(99.8)
  })
})

describe('buildBodyweightCsv', () => {
  it('emits a Date,Weight header and one converted row per day', () => {
    const csv = buildBodyweightCsv(
      [entry('a', 180, '2026-08-01'), entry('b', 181.5, '2026-08-02')],
      'lbs',
    )
    expect(csv).toBe('Date,Weight\n2026-08-01,180\n2026-08-02,181.5')
  })

  it('converts rows to kg when that is the display unit', () => {
    const csv = buildBodyweightCsv([entry('a', 220, '2026-08-01')], 'kg')
    expect(csv).toBe('Date,Weight\n2026-08-01,99.8')
  })

  it('yields just the header for no entries', () => {
    expect(buildBodyweightCsv([], 'lbs')).toBe('Date,Weight')
  })
})

describe('bodyweightCsvFilename', () => {
  it('carries the unit and export day', () => {
    expect(bodyweightCsvFilename('lbs', '2026-08-17')).toBe('lift-bodyweight-lbs-2026-08-17.csv')
    expect(bodyweightCsvFilename('kg', '2026-08-17')).toBe('lift-bodyweight-kg-2026-08-17.csv')
  })
})
