/**
 * Unit tests for the paged collection reader (#1152).
 *
 * The production failure was not a crash — it was a read that returned fewer
 * rows than exist and reported success, so these tests are mostly about the
 * boundary conditions where "fewer rows" is indistinguishable from "done":
 * exact multiples of the page size, an error mid-walk, and a server that never
 * returns a short page.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../logger', () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}))

import { fetchAllRows, SUPABASE_MAX_ROWS, MAX_PAGES } from '../supabasePagination'
import { logWarn } from '../logger'

interface TestRow { id: number }

/**
 * A server holding `total` rows that honors `.range()` and truncates every
 * response to `maxRows`, exactly as PostgREST does.
 */
function fakeCollection(total: number, maxRows = SUPABASE_MAX_ROWS) {
  const ranges: Array<{ from: number; to: number }> = []
  const rows: TestRow[] = Array.from({ length: total }, (_, i) => ({ id: i }))
  const build = () => ({
    range(from: number, to: number) {
      ranges.push({ from, to })
      const page = rows.slice(from, to + 1).slice(0, maxRows)
      return Promise.resolve({ data: page, error: null })
    },
  })
  return { build, ranges }
}

describe('fetchAllRows (#1152)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('defaults its page size to the PostgREST row cap', () => {
    expect(SUPABASE_MAX_ROWS).toBe(1000)
  })

  it('returns a single short page without asking for a second', async () => {
    const { build, ranges } = fakeCollection(42)
    const { data, error } = await fetchAllRows(build)

    expect(error).toBeNull()
    expect(data).toHaveLength(42)
    expect(ranges).toEqual([{ from: 0, to: 999 }])
  })

  it('walks past the row cap and returns EVERY row — the production regression', async () => {
    // The real incident: 1454 sets on the server, 1000 returned, history
    // visibly ending on the day set #1000 was written.
    const { build, ranges } = fakeCollection(1454)
    const { data } = await fetchAllRows(build)

    expect(data).toHaveLength(1454)
    expect(data!.at(-1)).toEqual({ id: 1453 })
    expect(ranges).toEqual([{ from: 0, to: 999 }, { from: 1000, to: 1999 }])
  })

  it('returns no duplicate or missing rows across page boundaries', async () => {
    const { data } = await fetchAllRows(fakeCollection(2500).build)

    expect(data).toHaveLength(2500)
    expect(new Set(data!.map(r => r.id)).size).toBe(2500)
    expect(data!.map(r => r.id)).toEqual([...Array(2500).keys()])
  })

  it('stops on the trailing empty page when the total is an exact multiple', async () => {
    // 2000 rows: two full pages give no short-page signal, so a third request
    // is required to learn the collection ended. Getting this wrong drops rows
    // for exactly the users with the most data.
    const { build, ranges } = fakeCollection(2000)
    const { data } = await fetchAllRows(build)

    expect(data).toHaveLength(2000)
    expect(ranges).toHaveLength(3)
  })

  it('surfaces an error from a later page with null data, never a partial list', async () => {
    const failure = { message: 'JWT expired', code: 'PGRST301' }
    let call = 0
    const build = () => ({
      range: (_from: number, _to: number) => {
        call++
        return Promise.resolve(
          call === 1
            ? { data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), error: null }
            : { data: null, error: failure },
        )
      },
    })

    const { data, error } = await fetchAllRows(build)

    // A partially-fetched collection must never look complete — the caller
    // would merge a truncated remote over good local state.
    expect(data).toBeNull()
    expect(error).toBe(failure)
  })

  it('propagates a first-page error unchanged', async () => {
    const failure = { message: 'permission denied', code: '42501' }
    const { data, error } = await fetchAllRows(() => ({
      range: () => Promise.resolve({ data: null, error: failure }),
    }))

    expect(data).toBeNull()
    expect(error).toBe(failure)
  })

  it('preserves the legacy null-data-no-error signal on the first page', async () => {
    // Stores guard `if (!data) return` to keep local state; that must survive.
    const { data, error } = await fetchAllRows(() => ({
      range: () => Promise.resolve({ data: null, error: null }),
    }))

    expect(data).toBeNull()
    expect(error).toBeNull()
  })

  it('keeps rows already fetched when a later page returns null data', async () => {
    let call = 0
    const build = () => ({
      range: () => {
        call++
        return Promise.resolve(
          call === 1
            ? { data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), error: null }
            : { data: null, error: null },
        )
      },
    })

    const { data, error } = await fetchAllRows(build)

    expect(error).toBeNull()
    expect(data).toHaveLength(1000)
  })

  it('honors a caller-supplied page size', async () => {
    const { build, ranges } = fakeCollection(25, 10)
    const { data } = await fetchAllRows(build, 10)

    expect(data).toHaveLength(25)
    expect(ranges).toEqual([
      { from: 0, to: 9 }, { from: 10, to: 19 }, { from: 20, to: 29 },
    ])
  })

  it('stops at the page ceiling instead of looping forever, and says so', async () => {
    // A server that always returns a full page (pathological .range()) must not
    // spin the app — the same unbounded-loop class that took down the PWA.
    let requests = 0
    const build = () => ({
      range: () => {
        requests++
        return Promise.resolve({
          data: Array.from({ length: SUPABASE_MAX_ROWS }, (_, i) => ({ id: i })),
          error: null,
        })
      },
    })

    const { data, error } = await fetchAllRows(build)

    expect(requests).toBe(MAX_PAGES)
    expect(error).toBeNull()
    expect(data).toHaveLength(MAX_PAGES * SUPABASE_MAX_ROWS)
    expect(logWarn).toHaveBeenCalledWith(
      expect.stringContaining('page ceiling'),
      expect.objectContaining({ maxPages: MAX_PAGES }),
    )
  })

  it('rebuilds the query for each page (a PostgREST builder is single-use)', async () => {
    const builds = vi.fn(() => ({
      range: (from: number, to: number) => Promise.resolve({
        data: Array.from({ length: 1454 }, (_, i) => ({ id: i })).slice(from, to + 1).slice(0, 1000),
        error: null,
      }),
    }))

    await fetchAllRows(builds)

    expect(builds).toHaveBeenCalledTimes(2)
  })
})
