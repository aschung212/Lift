import { logWarn } from './logger'

/**
 * Paged reads for Supabase collections (#1152).
 *
 * PostgREST caps every response at the project's `max_rows` (1000 — see
 * `supabase/config.toml`). A `.select()` with no `.range()` therefore returns
 * the FIRST page and stops: no error, no truncation flag, just a short array
 * that is indistinguishable from "this is all the rows there are".
 *
 * For a local-first app that treats the server dump as the source of truth on a
 * fresh device, that is silent data loss at the read boundary. The workout
 * fetch sorts `created_at` ASCENDING, so a user past the cap hydrates their
 * OLDEST 1000 sets and the app reports that their training stopped on the day
 * they crossed it — which is exactly what happened in production: 1454 sets on
 * the server, history visibly ending on the day set #1000 was written.
 *
 * `fetchAllRows` walks a collection one page at a time until a short page comes
 * back. The query is rebuilt per page because a PostgREST builder is single-use
 * (awaiting it issues the request), so the caller passes a factory rather than a
 * built query.
 *
 * Two rules for callers:
 *  1. **Sort must be total.** Pagination is only coherent under a deterministic
 *     order. `created_at` is `default now()`, so a CSV import writes many rows
 *     with an identical timestamp; without a tiebreaker (`.order('id')`) the
 *     database may order ties differently between two page requests, which
 *     repeats some rows and skips others.
 *  2. **Don't "fix" this by raising max-rows.** That moves the cliff to 5000 and
 *     re-arms the same silent failure at a less-tested scale.
 */

/**
 * Rows PostgREST will return in a single response, mirroring `max_rows` in
 * `supabase/config.toml`. Used as the default page size so a full page is
 * exactly what the server is willing to send — a page shorter than this is a
 * reliable end-of-collection signal.
 */
export const SUPABASE_MAX_ROWS = 1000

/**
 * Hard ceiling on page requests, so a server that never returns a short page
 * (a pathological `.range()` implementation, a filter that keeps matching) can't
 * spin forever. At the default page size this is 200k rows — orders of magnitude
 * beyond any real user — and hitting it is logged rather than thrown, since
 * returning the rows fetched so far beats failing the whole hydrate.
 */
export const MAX_PAGES = 200

/** The single builder method this helper needs: a range-windowed, awaitable query. */
interface RangeableQuery<Row, Err> {
  range(from: number, to: number): PromiseLike<{ data: Row[] | null; error: Err | null }>
}

/**
 * Read an entire Supabase collection, one `max_rows`-sized page at a time.
 *
 * Mirrors the shape callers already expect from a plain `await query`:
 * `{ data, error }`, with `data: null` on failure so existing error handling
 * (bail out, keep local state) works unchanged.
 *
 * @param buildQuery Factory returning a FRESH query for each page — the same
 *                   filters and the same total ordering every time.
 * @param pageSize   Rows per request. Defaults to `SUPABASE_MAX_ROWS`.
 */
export async function fetchAllRows<Row, Err>(
  buildQuery: () => RangeableQuery<Row, Err>,
  pageSize: number = SUPABASE_MAX_ROWS,
): Promise<{ data: Row[] | null; error: Err | null }> {
  const rows: Row[] = []

  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * pageSize
    const { data, error } = await buildQuery().range(from, from + pageSize - 1)

    // Surface the first failure with `data: null`, matching an unpaged read: a
    // partially-fetched collection must never look like a complete one, or the
    // caller would merge a truncated remote over good local state.
    if (error) return { data: null, error }

    // A null page with no error isn't a real PostgREST shape, but the stores
    // already guard `if (!data) return`. Preserve that meaning on the first page
    // (caller bails, local state survives) and treat it as end-of-collection
    // afterwards so rows already fetched aren't discarded.
    if (!data) return page === 0 ? { data: null, error: null } : { data: rows, error: null }

    for (const row of data) rows.push(row)

    // A short page means the collection is exhausted. A collection that is an
    // exact multiple of the page size costs one extra empty request — cheaper
    // than asking for a `count` on every hydrate.
    if (data.length < pageSize) return { data: rows, error: null }
  }

  logWarn('Stopped paging a Supabase collection at the page ceiling', {
    maxPages: MAX_PAGES,
    pageSize,
    rowsFetched: rows.length,
  })
  return { data: rows, error: null }
}
