import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  HEALTH_SYNC_STATE_KEY,
  HEALTH_ENTRY_ID_KEY,
  defaultHealthSyncState,
  readHealthSyncState,
  writeHealthSyncState,
  lbsToKg,
  healthSampleInstant,
  buildWeightSample,
  isHealthWritable,
  pendingHealthEntries,
  matchExistingSamples,
  readBackWindow,
  markWritten,
  type HealthSyncState,
} from '../healthSync'
import { setDayKey, toLocalDateKey } from '../dates'
import { APP_BUNDLE_ID } from '../appMeta'
import type { BodyweightEntry } from '../../stores/bodyweight'

/**
 * Pure half of the Apple Health bodyweight write-sync (#1420).
 *
 * The timezone cases matter most. `entry.date` carries two storage conventions
 * (#746) and CI runs in UTC, where both derivations agree — so a day-key test
 * that does not pin `process.env.TZ` cannot fail (CLAUDE.md). Each side of UTC
 * is asserted: Tokyo catches handing an `endOfDayISO` stamp to HealthKit
 * verbatim (it files the weigh-in under the NEXT day there); Los Angeles catches
 * slicing a real-time evening stamp (it files it under the next day THERE).
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

function entry(over: Partial<BodyweightEntry> & { id: string }): BodyweightEntry {
  return { date: '2026-09-14T23:59:30.000Z', weight: 185, ...over }
}

const END_OF_DAY = '2026-09-14T23:59:30.000Z' // UI-logged: the prefix IS the local day
const LA_EVENING = '2026-09-15T03:30:00.000Z' // real-time: 20:30 PDT on Sept 14

describe('lbsToKg', () => {
  it('converts with the app-wide factor at three decimals', () => {
    expect(lbsToKg(185)).toBe(83.915)
    expect(lbsToKg(200)).toBe(90.718)
    expect(lbsToKg(0)).toBe(0)
  })
})

describe('healthSampleInstant', () => {
  it('files an end-of-day stamp under its LOCAL day at noon east of UTC', () => {
    withTZ('Asia/Tokyo', () => {
      // The raw stamp is 08:59 the next morning in Tokyo — the bug the mapping avoids.
      expect(toLocalDateKey(END_OF_DAY)).toBe('2026-09-15')
      const instant = healthSampleInstant(END_OF_DAY)
      expect(toLocalDateKey(instant)).toBe('2026-09-14')
      expect(new Date(instant).getHours()).toBe(12)
    })
  })

  it('files an end-of-day stamp under its LOCAL day at noon west of UTC', () => {
    withTZ('America/Los_Angeles', () => {
      const instant = healthSampleInstant(END_OF_DAY)
      expect(toLocalDateKey(instant)).toBe('2026-09-14')
      expect(new Date(instant).getHours()).toBe(12)
    })
  })

  it('passes a real-time stamp through unchanged', () => {
    withTZ('America/Los_Angeles', () => {
      expect(healthSampleInstant(LA_EVENING)).toBe(LA_EVENING)
      // …which is the evening of the 14th locally, the day the app files it under.
      expect(toLocalDateKey(healthSampleInstant(LA_EVENING))).toBe('2026-09-14')
    })
  })

  it('agrees with setDayKey for both conventions on both sides of UTC', () => {
    for (const tz of ['Asia/Tokyo', 'America/Los_Angeles', 'UTC']) {
      withTZ(tz, () => {
        for (const date of [END_OF_DAY, LA_EVENING, '2026-01-01T23:59:59.999Z', '2026-06-30T00:00:00.000Z']) {
          expect(toLocalDateKey(healthSampleInstant(date)), `${tz} ${date}`).toBe(setDayKey(date))
        }
      })
    }
  })
})

describe('buildWeightSample', () => {
  it('writes kilograms at the entry instant, stamped with the entry id', () => {
    const sample = buildWeightSample(entry({ id: 'e1', weight: 185 }))
    expect(sample).toEqual({
      dataType: 'weight',
      value: 83.915,
      unit: 'kilogram',
      startDate: healthSampleInstant(END_OF_DAY),
      endDate: healthSampleInstant(END_OF_DAY),
      metadata: { [HEALTH_ENTRY_ID_KEY]: 'e1' },
    })
    expect(HEALTH_ENTRY_ID_KEY).toBe(`${APP_BUNDLE_ID}.entryId`)
  })
})

describe('isHealthWritable', () => {
  it('excludes onboarding sample data and corrupt weights', () => {
    expect(isHealthWritable(entry({ id: 'a' }))).toBe(true)
    expect(isHealthWritable(entry({ id: 'b', sample: true }))).toBe(false)
    expect(isHealthWritable(entry({ id: 'c', weight: 0 }))).toBe(false)
    expect(isHealthWritable(entry({ id: 'd', weight: -5 }))).toBe(false)
    expect(isHealthWritable(entry({ id: 'e', weight: Number.NaN }))).toBe(false)
  })
})

describe('pendingHealthEntries', () => {
  it('returns writable entries not in the ledger, oldest first across both conventions', () => {
    const state: HealthSyncState = { ...defaultHealthSyncState(), written: { done: true } }
    const entries = [
      entry({ id: 'newest', date: '2026-09-16T23:59:01.000Z' }),
      entry({ id: 'done' }),
      entry({ id: 'sample', sample: true }),
      entry({ id: 'zero', weight: 0 }),
      entry({ id: 'realtime', date: '2026-09-13T15:00:00.000Z' }),
      entry({ id: 'eod' }),
    ]
    expect(pendingHealthEntries(entries, state).map(e => e.id)).toEqual(['realtime', 'eod', 'newest'])
  })
})

describe('matchExistingSamples', () => {
  it('matches only Logbook-sourced samples on the same local day within 0.01 kg', () => {
    withTZ('America/Los_Angeles', () => {
      const a = entry({ id: 'a', date: END_OF_DAY, weight: 185 }) // 83.915 kg on Sept 14
      const b = entry({ id: 'b', date: '2026-09-13T23:59:10.000Z', weight: 186 }) // 84.368 kg on Sept 13
      const c = entry({ id: 'c', date: '2026-09-12T23:59:10.000Z', weight: 187 })
      const samples = [
        // Logbook's own sample, HealthKit's double a hair off the stored value.
        { value: 83.9149, startDate: healthSampleInstant(END_OF_DAY), sourceId: APP_BUNDLE_ID },
        // A smart scale reading the same day — not "already written by Logbook".
        { value: 84.368, startDate: healthSampleInstant(b.date), sourceId: 'com.example.scale' },
        // Logbook's own sample, but a different weigh-in.
        { value: 85.5, startDate: healthSampleInstant(c.date), sourceId: APP_BUNDLE_ID },
      ]
      expect(matchExistingSamples([a, b, c], samples)).toEqual(['a'])
    })
  })

  it('returns nothing for an empty read-back', () => {
    expect(matchExistingSamples([entry({ id: 'a' })], [])).toEqual([])
  })

  it('does not match across the local day boundary east of UTC', () => {
    withTZ('Asia/Tokyo', () => {
      const a = entry({ id: 'a', date: END_OF_DAY, weight: 185 })
      // A Logbook sample whose instant is the raw stamp: 08:59 on Sept 15 in Tokyo.
      const stale = [{ value: 83.915, startDate: END_OF_DAY, sourceId: APP_BUNDLE_ID }]
      expect(matchExistingSamples([a], stale)).toEqual([])
    })
  })
})

describe('readBackWindow', () => {
  it('is null with nothing pending', () => {
    expect(readBackWindow([])).toBeNull()
  })

  it('pads the pending span by a day on each side', () => {
    const first = entry({ id: 'a', date: '2026-09-10T23:59:00.000Z' })
    const last = entry({ id: 'b', date: '2026-09-14T23:59:00.000Z' })
    const window = readBackWindow([last, first])!
    const min = new Date(healthSampleInstant(first.date)).getTime()
    const max = new Date(healthSampleInstant(last.date)).getTime()
    expect(new Date(window.startDate).getTime()).toBe(min - 86_400_000)
    expect(new Date(window.endDate).getTime()).toBe(max + 86_400_000)
  })
})

describe('markWritten', () => {
  it('returns a new state with the ids marked and the stamp advanced, never mutating', () => {
    const before = defaultHealthSyncState()
    const after = markWritten(before, ['x', 'y'], '2026-09-15T00:00:00.000Z')
    expect(after.written).toEqual({ x: true, y: true })
    expect(after.lastSyncedAt).toBe('2026-09-15T00:00:00.000Z')
    expect(before.written).toEqual({})
    expect(before.lastSyncedAt).toBeNull()
  })
})

describe('ledger persistence', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('reads the disabled default when nothing is stored', () => {
    expect(readHealthSyncState('u1')).toEqual(defaultHealthSyncState())
  })

  it('round-trips through localStorage for the owning user', () => {
    const state: HealthSyncState = { ownerId: 'u1', enabled: true, written: { a: true }, lastSyncedAt: '2026-09-15T00:00:00.000Z' }
    writeHealthSyncState(state)
    expect(readHealthSyncState('u1')).toEqual(state)
  })

  it('does not hand one user\'s switch or ledger to another user on the same device', () => {
    writeHealthSyncState({ ownerId: 'u1', enabled: true, written: { a: true }, lastSyncedAt: null })
    expect(readHealthSyncState('u2')).toEqual(defaultHealthSyncState())
    expect(readHealthSyncState(null)).toEqual(defaultHealthSyncState())
  })

  it.each([
    ['unparseable', '{not json'],
    ['an array', '[]'],
    ['a string', '"enabled"'],
    ['wrong field types', JSON.stringify({ ownerId: 'u1', enabled: 'yes', written: {}, lastSyncedAt: null })],
    ['a non-object ledger', JSON.stringify({ ownerId: 'u1', enabled: true, written: ['a'], lastSyncedAt: null })],
  ])('falls back to the default on corrupt storage (%s)', (_label, raw) => {
    localStorage.setItem(HEALTH_SYNC_STATE_KEY, raw)
    expect(readHealthSyncState('u1')).toEqual(defaultHealthSyncState())
  })

  it('trusts only genuine `true` marks in the ledger', () => {
    localStorage.setItem(
      HEALTH_SYNC_STATE_KEY,
      JSON.stringify({ ownerId: 'u1', enabled: true, written: { a: true, b: 1, c: 'true', d: false }, lastSyncedAt: null }),
    )
    expect(readHealthSyncState('u1').written).toEqual({ a: true })
  })

  it('never throws when storage refuses the write', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => writeHealthSyncState(defaultHealthSyncState())).not.toThrow()
  })
})
