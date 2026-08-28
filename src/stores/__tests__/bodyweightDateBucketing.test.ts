/**
 * Regression: the bodyweight merge must bucket by `setDayKey`, not a raw
 * `date.slice(0, 10)` (#1242, the #746 convention rule).
 *
 * `_fetchFromSupabase` collapses the merged local+remote entries to one per
 * calendar day. It keyed that map with `entry.date.slice(0, 10)`, but the field
 * carries TWO storage conventions:
 *
 *   - `addEntry(weight, dateStr)` → `endOfDayISO(dateStr)` = `…T23:59:ssZ`,
 *     whose prefix IS the chosen local day. Slicing is correct.
 *   - `addEntry(weight)` (the "log today's weight" path with no date picked)
 *     and every legacy row → a real-time UTC instant. For an Americas evening
 *     that slices to TOMORROW, while `setDayKey` — and therefore every screen
 *     in the app — resolves it to today.
 *
 * So the two conventions landed in different buckets and a real-time entry
 * never collapsed against the end-of-day entry for the day the UI displays it
 * under. The user saw two points on the chart for one calendar day, and the
 * Health CSV export (which buckets via `setDayKey` and keeps one row per day)
 * silently disagreed with what the merge kept.
 *
 * The timezone is forced per-case rather than inherited from the CI machine —
 * on a UTC runner the two conventions coincide and every assertion here would
 * pass vacuously against the buggy slice.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

const { fakeSupabase } = await vi.hoisted(async () => {
  const { createFakeSupabase } = await import('../../__tests__/fakeSupabase')
  return { fakeSupabase: createFakeSupabase({ mode: 'ok' }) }
})

vi.mock('../../lib/supabase', () => ({
  supabase: fakeSupabase,
  isPreviewMode: { value: false },
}))

vi.mock('../../lib/syncQueue', () => ({
  syncQueue: { enqueue: vi.fn(), enqueueDelete: vi.fn(), clear: vi.fn() },
}))

vi.mock('../../lib/logger', () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}))

import { useBodyweightStore, type BodyweightEntry } from '../bodyweight'
import { dailyLatestBodyweight } from '../../lib/bodyweightExport'
import { setDayKey } from '../../lib/dates'

const USER = 'user-1242'
const PREV_TZ = process.env.TZ

/** America/Los_Angeles: 2026-03-16T02:00Z is 7pm on 2026-03-15 local. */
function useAmericasEvening() {
  process.env.TZ = 'America/Los_Angeles'
}

function localEntry(
  id: string,
  weight: number,
  date: string,
  updatedAt: string,
): BodyweightEntry {
  return { id, date, weight, updated_at: updatedAt }
}

describe('bodyweight day bucketing uses setDayKey (#1242)', () => {
  beforeEach(() => {
    localStorageMock.clear()
    fakeSupabase.reset()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useAmericasEvening()
  })

  afterEach(() => {
    process.env.TZ = PREV_TZ
  })

  it('guards the guard — the two conventions really do slice to different days here', () => {
    const endOfDay = '2026-03-15T23:59:30.000Z'   // date-picker entry for Mar 15
    const realTime = '2026-03-16T02:00:00.000Z'   // 7pm Mar 15 local, no date picked

    expect(setDayKey(endOfDay)).toBe('2026-03-15')
    expect(setDayKey(realTime)).toBe('2026-03-15')
    // The buggy key — if these ever agree, the cases below prove nothing.
    expect(endOfDay.slice(0, 10)).not.toBe(realTime.slice(0, 10))
  })

  it('collapses an end-of-day and a real-time entry logged on the same local day', async () => {
    const store = useBodyweightStore()
    store.entries = [
      localEntry('bw-picked', 181, '2026-03-15T23:59:30.000Z', '2026-03-15T20:00:00.000Z'),
      localEntry('bw-realtime', 179, '2026-03-16T02:00:00.000Z', '2026-03-16T02:00:00.000Z'),
    ]

    await store.init(USER)

    expect(store.entries).toHaveLength(1)
    // Later updated_at wins, exactly as it always did within a bucket.
    expect(store.entries[0].id).toBe('bw-realtime')
  })

  it('collapses across the local/remote boundary too', async () => {
    fakeSupabase.seed('bodyweight_entries', [{
      id: 'bw-remote',
      user_id: USER,
      date: '2026-03-16T02:00:00.000Z',
      weight: 179,
      created_at: '2026-03-16T02:00:00.000Z',
      updated_at: '2026-03-16T02:00:00.000Z',
      deleted_at: null,
    }])

    const store = useBodyweightStore()
    store.entries = [
      localEntry('bw-picked', 181, '2026-03-15T23:59:30.000Z', '2026-03-15T20:00:00.000Z'),
    ]

    await store.init(USER)

    expect(store.entries).toHaveLength(1)
    expect(store.entries[0].id).toBe('bw-remote')
  })

  it('leaves the merge agreeing with the chart and the Health CSV export', async () => {
    // The user-visible symptom: two rows on screen for one day, and an export
    // that disagrees with them because it buckets correctly.
    const store = useBodyweightStore()
    store.entries = [
      localEntry('bw-picked', 181, '2026-03-15T23:59:30.000Z', '2026-03-15T20:00:00.000Z'),
      localEntry('bw-realtime', 179, '2026-03-16T02:00:00.000Z', '2026-03-16T02:00:00.000Z'),
    ]

    await store.init(USER)

    expect(dailyLatestBodyweight(store.entries)).toHaveLength(store.entries.length)
    expect(dailyLatestBodyweight(store.entries).map(d => d.date)).toEqual(['2026-03-15'])
  })

  it('still keeps genuinely different local days apart', async () => {
    // Over-collapsing would be the opposite data-loss bug: `bw-next-day` is
    // 11am Mar 16 local, a different calendar day from the Mar 15 entry.
    const store = useBodyweightStore()
    store.entries = [
      localEntry('bw-picked', 181, '2026-03-15T23:59:30.000Z', '2026-03-15T20:00:00.000Z'),
      localEntry('bw-next-day', 180, '2026-03-16T18:00:00.000Z', '2026-03-16T18:00:00.000Z'),
    ]

    await store.init(USER)

    expect(store.entries).toHaveLength(2)
    expect(store.entries.map(e => setDayKey(e.date)).sort())
      .toEqual(['2026-03-15', '2026-03-16'])
  })

  it('persists the deduped result so a reload does not resurrect the loser', async () => {
    const store = useBodyweightStore()
    store.entries = [
      localEntry('bw-picked', 181, '2026-03-15T23:59:30.000Z', '2026-03-15T20:00:00.000Z'),
      localEntry('bw-realtime', 179, '2026-03-16T02:00:00.000Z', '2026-03-16T02:00:00.000Z'),
    ]

    await store.init(USER)
    store._reloadFromStorage()

    expect(store.entries).toHaveLength(1)
    expect(store.entries[0].id).toBe('bw-realtime')
  })
})
