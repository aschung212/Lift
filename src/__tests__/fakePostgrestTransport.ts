/**
 * The HTTP face of `createFakeSupabase` (LIFT-1524): answers the requests the
 * REAL supabase-js client sends, out of the shared fake's in-memory tables.
 *
 * A test that needs something to stand between a store and the server (the
 * service worker model, a dead connection, a slow one) has to speak HTTP, and
 * `createFakeSupabase` is a double of the client's query-builder API instead.
 * Rather than write a second database, this turns each request back into the
 * builder calls that produced it, so the rows, the migrations' literal
 * DEFAULTs, the `max_rows` cap and the optional `serverClock` trigger stamp
 * are all the shared fake's own.
 *
 * It answers exactly the subset the stores send and THROWS on anything else
 * (an unknown filter operator, query parameter, method, `Prefer` or conflict
 * target), so a request it cannot answer faithfully fails the test instead of
 * being answered approximately:
 *  - GET: `eq.` and `is.null` filters, `offset`/`limit` (the `.range()`
 *    window), `order` (accepted; the fake keeps insertion order) and `select`
 *    (whole rows). An `eq.` operand arrives as text and is compared as text,
 *    which holds for every filter the stores send (ids). `Accept:
 *    application/vnd.pgrst.object+json` is `.single()`: one row, or
 *    PostgREST's 406 PGRST116.
 *  - POST with `Prefer: resolution=merge-duplicates`: `.upsert()` on `id`.
 *  - PATCH: `.update()` under `eq.` filters.
 */
import type { FakeSupabase } from './fakeSupabase'
import type { Transport } from './serviceWorkerModel'

const REST_PREFIX = '/rest/v1/'
/** Parameters that shape the response rather than filter rows. */
const SHAPE_PARAMS = new Set(['select', 'order', 'columns'])

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

interface ParsedRequest {
  table: string
  filters: [column: string, operand: string][]
  range?: { from: number; to: number }
}

function parse(url: string): ParsedRequest {
  const target = new URL(url)
  if (!target.pathname.startsWith(REST_PREFIX)) {
    throw new Error(`fakePostgrestTransport: not a REST request: ${url}`)
  }
  const table = target.pathname.slice(REST_PREFIX.length)
  if (!/^\w+$/.test(table)) throw new Error(`fakePostgrestTransport: unsupported path ${target.pathname}`)

  const filters: ParsedRequest['filters'] = []
  let offset: number | undefined
  let limit: number | undefined
  for (const [key, value] of target.searchParams) {
    if (SHAPE_PARAMS.has(key)) continue
    if (key === 'offset') offset = Number(value)
    else if (key === 'limit') limit = Number(value)
    else if (key === 'on_conflict') {
      // The shared fake upserts on `id`, so any other target would be answered wrongly.
      if (value !== 'id') throw new Error(`fakePostgrestTransport: on_conflict=${value} is not modelled`)
    } else if (value.startsWith('eq.') || value === 'is.null') filters.push([key, value])
    else throw new Error(`fakePostgrestTransport: filter ${key}=${value} is not modelled`)
  }
  if ((offset === undefined) !== (limit === undefined)) {
    throw new Error('fakePostgrestTransport: offset and limit arrive together (.range())')
  }
  const range = offset === undefined ? undefined : { from: offset, to: offset + limit! - 1 }
  return { table, filters, range }
}

type Query = ReturnType<FakeSupabase['from']>

function applyFilters(query: Query, filters: ParsedRequest['filters']): Query {
  for (const [column, operand] of filters) {
    query = operand === 'is.null' ? query.is(column, null) : query.eq(column, operand.slice('eq.'.length))
  }
  return query
}

export function createPostgrestTransport(fake: FakeSupabase): Transport {
  if (fake.mode !== 'ok') {
    throw new Error('fakePostgrestTransport: build the fake in ok mode and model failures in the transport')
  }
  return async (url, init) => {
    const { table, filters, range } = parse(url)
    const method = (init.method ?? 'GET').toUpperCase()
    const headers = new Headers(init.headers)

    if (method === 'GET') {
      let query = applyFilters(fake.from(table).select('*'), filters)
      if (range) query = query.range(range.from, range.to)
      const { data } = await query
      const rows = data as unknown[]
      if ((headers.get('Accept') ?? '').includes('application/vnd.pgrst.object+json')) {
        if (rows.length !== 1) {
          return json(406, {
            code: 'PGRST116',
            message: 'JSON object requested, multiple (or no) rows returned',
            details: `The result contains ${rows.length} rows`,
            hint: null,
          })
        }
        return json(200, rows[0])
      }
      return json(200, rows)
    }

    const prefer = headers.get('Prefer') ?? ''
    if (/return=representation/.test(prefer)) {
      throw new Error('fakePostgrestTransport: return=representation is not modelled')
    }
    const body = JSON.parse(String(init.body)) as unknown

    if (method === 'POST') {
      if (!/resolution=merge-duplicates/.test(prefer)) {
        throw new Error('fakePostgrestTransport: only upserts (Prefer: resolution=merge-duplicates) are modelled')
      }
      await fake.from(table).upsert(body)
      return new Response(null, { status: 201 })
    }

    if (method === 'PATCH') {
      await applyFilters(fake.from(table).update(body), filters)
      return new Response(null, { status: 204 })
    }

    throw new Error(`fakePostgrestTransport: ${method} is not modelled`)
  }
}
