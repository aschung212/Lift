/**
 * Contract check for the shared Supabase test double (LIFT-1009).
 *
 * The four sync test files used to hand-roll divergent fakes; they now share
 * `createFakeSupabase`. That only removes mock-drift risk if the shared fake's
 * method set is kept in lockstep with the query surface the stores ACTUALLY use
 * against the real client. This test enforces that link two ways:
 *
 *   1. The fake's builder exposes every method the store source invokes on a
 *      `supabase.from(...)` chain — scanned straight out of the store files, so
 *      a store adopting a new method (e.g. `.limit()`) fails here until the fake
 *      grows to match, instead of silently passing against a stale shape.
 *   2. Each mode (`ok` / `reject` / `apiError`) honors the documented behavioral
 *      contract the sync tests depend on.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createFakeSupabase, FAKE_SUPABASE_CHAIN_METHODS } from './fakeSupabase'

const here = dirname(fileURLToPath(import.meta.url))
const storesDir = resolve(here, '../stores')
const libDir = resolve(here, '../lib')

/**
 * Every file that builds a query against the real client. The stores own their
 * filters; `supabasePagination.ts` owns the `.range()` windowing every
 * collection read now goes through (#1152), so it belongs to the same contract
 * — the fake must speak whatever the helper speaks.
 */
const QUERY_SOURCE_FILES = [
  resolve(storesDir, 'workout.ts'),
  resolve(storesDir, 'bodyweight.ts'),
  resolve(storesDir, 'progression.ts'),
  resolve(storesDir, 'preferences.ts'),
  resolve(libDir, 'supabasePagination.ts'),
]

/**
 * Extract the chain methods invoked after a `supabase...from(...)` in a source
 * file. Matches `.method(` tokens so a new query verb shows up here the moment
 * the app starts using it.
 */
function chainMethodsUsedIn(source: string): Set<string> {
  const used = new Set<string>()
  // Fluent query chains wrap across lines. Fold continuation lines (those
  // starting with `.`) onto their predecessor first, so a wrapped chain is
  // scanned as one unit — otherwise every verb that happens to land on a
  // continuation line is invisible to the scan, and the contract silently stops
  // covering it. (#1152 wrapped the workout reads and cost this scan `.is()`
  // and `.order()`; the vacuous-scan sanity check below is what caught it.)
  const lines: string[] = []
  for (const raw of source.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('.') && lines.length > 0) lines[lines.length - 1] += line
    else lines.push(line)
  }
  // Only consider lines that touch the supabase client chain, to avoid picking
  // up Array.prototype.filter/map/etc. We look for the query verbs by name.
  const verbPattern = /\.(select|upsert|update|delete|insert|eq|is|order|single|maybeSingle|limit|in|neq|gte|lte|match|not|filter|range|contains|overlaps|textSearch)\(/g
  for (const line of lines) {
    if (!/supabase|\bclient\b|\bq\b|\.from\(/.test(line)) continue
    let m: RegExpExecArray | null
    while ((m = verbPattern.exec(line)) !== null) {
      // `.filter(` is an Array method too; only count it when the line is clearly
      // a query builder chain (has .from/.eq/.is/.update/.select on it).
      if (m[1] === 'filter' && !/\.(from|eq|is|update|select|upsert)\(/.test(line)) continue
      used.add(m[1])
    }
  }
  return used
}

describe('createFakeSupabase contract (LIFT-1009)', () => {
  const builder = createFakeSupabase().from('sets') as unknown as Record<string, unknown>

  it('exposes every chain method the fake advertises via FAKE_SUPABASE_CHAIN_METHODS', () => {
    for (const method of FAKE_SUPABASE_CHAIN_METHODS) {
      expect(typeof builder[method], `builder.${method} should be a function`).toBe('function')
    }
  })

  it('the builder is a thenable (awaitable) query', () => {
    expect(typeof builder.then).toBe('function')
  })

  it('covers every query method the stores invoke on the supabase chain', () => {
    const used = new Set<string>()
    for (const file of QUERY_SOURCE_FILES) {
      for (const method of chainMethodsUsedIn(readFileSync(file, 'utf-8'))) used.add(method)
    }
    // `filter` is the JS array method, never a PostgREST verb we mock — drop it
    // if it leaked through despite the guard above.
    used.delete('filter')

    // Sanity: the scan actually found the core verbs (guards against a regex
    // that silently matches nothing and makes this test pass vacuously).
    // `range` is here because a fake that can't window is a fake that certifies
    // an unpaged read as correct — the #1152 failure mode exactly.
    for (const core of ['select', 'upsert', 'update', 'eq', 'is', 'order', 'range']) {
      expect(used, `query-source scan should detect .${core}(`).toContain(core)
    }

    const missing = [...used].filter(m => typeof builder[m] !== 'function')
    expect(
      missing,
      `The shared fake is missing chain method(s) the stores use: ${missing.join(', ')}. ` +
        `Add them to FakeBuilder in src/__tests__/fakeSupabase.ts.`,
    ).toEqual([])
  })
})

describe('createFakeSupabase modes (LIFT-1009)', () => {
  it("'ok' mode seeds, reads, upserts and soft-deletes in-memory", async () => {
    const fake = createFakeSupabase({ mode: 'ok' })
    fake.seed('sets', [
      { id: 's-1', user_id: 'u1', deleted_at: null, weight: 100 },
      { id: 's-2', user_id: 'u1', deleted_at: '2026-01-01T00:00:00Z', weight: 200 },
    ])

    // .is(deleted_at, null) matches NULL-or-missing only
    const active = await fake.from('sets').select('*').eq('user_id', 'u1').is('deleted_at', null).order('id')
    expect((active.data as Array<{ id: string }>).map(r => r.id)).toEqual(['s-1'])

    // upsert merges by id and is recorded
    await fake.from('sets').upsert({ id: 's-1', weight: 150 })
    expect(fake.tables.sets.find(r => r.id === 's-1')!.weight).toBe(150)
    expect(fake.upsertsFor('sets')).toHaveLength(1)

    // update matches filters and mutates in place (soft delete)
    await fake.from('sets').update({ deleted_at: 'now' }).eq('id', 's-1').eq('user_id', 'u1')
    expect(fake.tables.sets.find(r => r.id === 's-1')!.deleted_at).toBe('now')
    expect(fake.updatesFor('sets')[0].filters).toMatchObject({ id: 's-1', user_id: 'u1' })
  })

  it("'ok' mode .single() returns the first match or null", async () => {
    const fake = createFakeSupabase({ mode: 'ok' })
    fake.seed('user_progression', [{ id: 'p1', user_id: 'u1', total_xp: 42 }])

    const hit = await fake.from('user_progression').select('*').eq('user_id', 'u1').single()
    expect((hit.data as { total_xp: number }).total_xp).toBe(42)

    const miss = await fake.from('user_progression').select('*').eq('user_id', 'nobody').single()
    expect(miss.data).toBeNull()
  })

  it("'reject' mode rejects every query", async () => {
    const fake = createFakeSupabase({ mode: 'reject' })
    await expect(fake.from('sets').select('*').eq('user_id', 'u1')).rejects.toThrow('Network request failed')
  })

  it("'apiError' mode resolves { data: null, error } without throwing", async () => {
    const fake = createFakeSupabase({ mode: 'apiError' })
    const res = await fake.from('exercises').select('*').eq('user_id', 'u1')
    expect(res.data).toBeNull()
    expect(res.error).toMatchObject({ code: '42501' })
    // The call is still recorded even in error mode.
    expect(fake.selectsFor('exercises')).toHaveLength(1)
  })

  it('reset() clears seeded tables and recorded calls', async () => {
    const fake = createFakeSupabase({ mode: 'ok' })
    fake.seed('sets', [{ id: 's-1', user_id: 'u1' }])
    await fake.from('sets').select('*')
    fake.reset()
    expect(fake.tables.sets).toEqual([])
    expect(fake.calls).toEqual([])
  })
})
