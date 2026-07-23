/**
 * Shared, configurable Supabase test double (LIFT-1009).
 *
 * Before this existed, every sync test (`supabaseApiError`,
 * `supabaseFetchResilience`, `syncPipelineIntegration`, `syncFuzz`) hand-rolled
 * its own chainable PostgREST fake, each implementing a *different* subset of
 * `select/eq/is/order/single/upsert/update/delete/then`. That is the classic
 * mock-drift red flag for a local-first app whose entire durability story runs
 * through these queries: a real client API change could be reflected in one fake
 * but not another, letting a store pass against a shape production no longer has.
 *
 * `createFakeSupabase({ mode })` is the single source of truth for what the
 * Supabase client contract looks like in tests. It implements the full chain
 * surface the stores actually use in ONE place, with per-test behavior selected
 * by a `mode` option rather than copy-pasted chains:
 *
 *   - `'ok'`       — in-memory tables. Records every call; `seed()` rows, then
 *                    reads/upserts/updates/deletes them like a real backend.
 *                    This is the superset used by the read-path fuzz + write-path
 *                    integration tests.
 *   - `'reject'`   — every query rejects (network/offline simulation). Stores
 *                    must preserve local data and never throw out of `init()`.
 *   - `'apiError'` — every query resolves `{ data: null, error }` (a non-throwing
 *                    API/RLS error). Stores must check `.error` and bail out.
 *
 * The set of methods on the builder is asserted against the stores' real usage
 * by `fakeSupabase.contract.test.ts`, so a new query method in a store fails the
 * contract check until the fake grows to match it.
 */

/** The method names a store may invoke on a `supabase.from(...)` query chain. */
export const FAKE_SUPABASE_CHAIN_METHODS = [
  'select',
  'upsert',
  'update',
  'delete',
  'eq',
  'is',
  'order',
  'single',
  'then',
] as const

export type FakeSupabaseMode = 'ok' | 'reject' | 'apiError'

export interface FakeSupabaseError {
  message: string
  code?: string
}

export interface FakeSupabaseOptions {
  /** Selects per-query behavior. Defaults to `'ok'`. */
  mode?: FakeSupabaseMode
  /** Error object returned in `'apiError'` mode (defaults to an RLS 42501 denial). */
  error?: FakeSupabaseError
  /** Error thrown in `'reject'` mode (defaults to a network failure). */
  rejectionError?: Error
}

interface Row {
  id: string
  [k: string]: unknown
}

type Op = 'select' | 'delete' | 'upsert' | 'update'

interface RecordedCall {
  op: Op
  table: string
  filters: Record<string, unknown>
  data?: unknown
}

/** Sentinel wrapping a `.is(col, val)` filter so it can match NULL-or-missing. */
interface IsFilter {
  __is: unknown
}

function isIsFilter(v: unknown): v is IsFilter {
  return v !== null && typeof v === 'object' && '__is' in (v as object)
}

const DEFAULT_API_ERROR: FakeSupabaseError = {
  message: 'permission denied for table exercises',
  code: '42501',
}

export class FakeSupabase {
  readonly mode: FakeSupabaseMode
  private readonly _apiError: FakeSupabaseError
  private readonly _rejectionError: Error

  /** In-memory rows keyed by table name (populated via `seed()`; `'ok'` mode). */
  tables: Record<string, Row[]> = {
    exercises: [],
    sets: [],
    bodyweight_entries: [],
    user_progression: [],
    user_preferences: [],
  }

  /** Every query recorded in call order, across all modes. */
  calls: RecordedCall[] = []

  constructor(options: FakeSupabaseOptions = {}) {
    this.mode = options.mode ?? 'ok'
    this._apiError = options.error ?? DEFAULT_API_ERROR
    this._rejectionError = options.rejectionError ?? new Error('Network request failed')
  }

  reset() {
    this.tables = {
      exercises: [],
      sets: [],
      bodyweight_entries: [],
      user_progression: [],
      user_preferences: [],
    }
    this.calls = []
  }

  seed(table: string, rows: Row[]) {
    this.tables[table] = rows.map(r => ({ ...r }))
  }

  from(table: string) {
    return new FakeBuilder(this, table)
  }

  callsFor(op: Op, table: string) {
    return this.calls.filter(c => c.op === op && c.table === table)
  }

  selectsFor(table: string) {
    return this.callsFor('select', table)
  }

  deletesFor(table: string) {
    return this.callsFor('delete', table)
  }

  upsertsFor(table: string) {
    return this.callsFor('upsert', table)
  }

  updatesFor(table: string) {
    return this.callsFor('update', table)
  }

  /** @internal — records the call and, in `'ok'` mode, mutates/reads the store. */
  _resolve(
    op: Op,
    table: string,
    filters: Record<string, unknown>,
    data: unknown,
    single: boolean,
  ): { data: unknown; error: FakeSupabaseError | null } {
    this.calls.push({ op, table, filters: { ...filters }, data })

    if (this.mode === 'apiError') {
      return { data: null, error: this._apiError }
    }

    const rows = this._query(op, table, filters, data)
    return { data: single ? (rows[0] ?? null) : rows, error: null }
  }

  /** @internal — the throwing branch for `'reject'` mode. */
  get _rejection(): Error {
    return this._rejectionError
  }

  private _query(op: Op, table: string, filters: Record<string, unknown>, data: unknown): Row[] {
    const rows = this.tables[table] || (this.tables[table] = [])
    const matches = rows.filter(r =>
      Object.entries(filters).every(([k, v]) => {
        if (isIsFilter(v)) {
          const target = v.__is
          if (target === null) return r[k] == null
          return r[k] === target
        }
        return r[k] === v
      }),
    )

    if (op === 'select') return matches
    if (op === 'delete') {
      const ids = new Set(matches.map(r => r.id))
      this.tables[table] = rows.filter(r => !ids.has(r.id))
      return matches
    }
    if (op === 'upsert') {
      const records = Array.isArray(data) ? (data as Row[]) : [data as Row]
      for (const rec of records) {
        const idx = rows.findIndex(r => r.id === rec.id)
        if (idx >= 0) rows[idx] = { ...rows[idx], ...rec }
        else rows.push({ ...rec })
      }
      return records
    }
    if (op === 'update') {
      for (const m of matches) Object.assign(m, data as Row)
      return matches
    }
    return []
  }
}

class FakeBuilder implements PromiseLike<{ data: unknown; error: FakeSupabaseError | null }> {
  private _op: Op = 'select'
  private _filters: Record<string, unknown> = {}
  private _data: unknown = null
  private _single = false

  constructor(private _parent: FakeSupabase, private _table: string) {}

  select(_cols?: string) { this._op = 'select'; return this }
  delete() { this._op = 'delete'; return this }
  upsert(data: unknown) { this._op = 'upsert'; this._data = data; return this }
  update(data: unknown) { this._op = 'update'; this._data = data; return this }
  eq(col: string, val: unknown) { this._filters[col] = val; return this }
  is(col: string, val: null | boolean) { this._filters[col] = { __is: val }; return this }
  order(_col: string) { return this }
  single() { this._single = true; return this }

  then<TResult1 = { data: unknown; error: FakeSupabaseError | null }, TResult2 = never>(
    onfulfilled?: (v: { data: unknown; error: FakeSupabaseError | null }) => TResult1 | PromiseLike<TResult1>,
    onrejected?: (reason: unknown) => TResult2 | PromiseLike<TResult2>,
  ): PromiseLike<TResult1 | TResult2> {
    if (this._parent.mode === 'reject') {
      return Promise.reject(this._parent._rejection).then(onfulfilled, onrejected)
    }
    const result = this._parent._resolve(this._op, this._table, this._filters, this._data, this._single)
    return Promise.resolve(result).then(onfulfilled, onrejected)
  }
}

/**
 * Build a shared Supabase test double. Pass `{ mode }` to select behavior; the
 * returned instance is what a `vi.mock('.../lib/supabase')` factory should
 * expose as `supabase`.
 */
export function createFakeSupabase(options: FakeSupabaseOptions = {}): FakeSupabase {
  return new FakeSupabase(options)
}
