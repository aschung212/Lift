// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import type { AddressInfo } from 'node:net'
// @ts-expect-error — plain .mjs helper, deliberately outside the app's tsconfig
import { createStubServer } from '../../../e2e/support/supabaseStubServer.mjs'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/**
 * Wire-fidelity guard for the e2e Supabase stub (LIFT-1008).
 *
 * `e2e/support/supabaseStubServer.mjs` is the endpoint the e2e build talks to,
 * and it is the reason the sync layer executes in a browser at all — every one
 * of `syncQueue.enqueue` / `rehydrate` / `replayJournal` opens with
 * `if (!supabase …) return`, so before it existed none of them ran.
 *
 * It is a double, and this repo has a standing rule about those: a double that
 * quietly omits a behaviour does not merely fail to catch a bug, it CERTIFIES
 * the broken code as correct (`createFakeSupabase`'s `max_rows` cap, #1152; its
 * `networkError` envelope, LIFT-1321; its column DEFAULTs, LIFT-1387). The
 * shapes below are exactly the ones the app branches on, so a stub that drifts
 * from PostgREST fails here — in the fast unit job — instead of surfacing as an
 * unexplained Playwright timeout in a job that takes fifteen minutes.
 *
 * Runs under the `node` environment rather than happy-dom: these are real
 * sockets, and happy-dom's `fetch` applies browser CORS rules that would make
 * the probe assert something other than what the stub sent.
 */
describe('e2e Supabase stub — PostgREST fidelity', () => {
  let origin = ''
  let server: { close(cb: () => void): void }

  beforeAll(async () => {
    const stub = createStubServer()
    server = stub.server
    await new Promise<void>(resolve => stub.server.listen(0, '127.0.0.1', resolve))
    const { port } = stub.server.address() as AddressInfo
    origin = `http://127.0.0.1:${port}`
  })

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  it('answers the readiness probe Playwright waits on', async () => {
    const res = await fetch(`${origin}/__health`)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true })
  })

  describe('CORS', () => {
    // The app is served from localhost:4173 and the stub from 127.0.0.1:54331 —
    // a different origin. supabase-js sends apikey/authorization/prefer, which
    // makes every request preflighted, so a missing header here is not a subtle
    // degradation: no request reaches the stub at all.
    it('answers a preflight allowing the headers supabase-js actually sends', async () => {
      const res = await fetch(`${origin}/rest/v1/exercises`, {
        method: 'OPTIONS',
        headers: {
          origin: 'http://localhost:4173',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'apikey, authorization, content-type, prefer, x-client-info',
        },
      })
      expect(res.status).toBe(204)
      expect(res.headers.get('access-control-allow-origin')).toBe('*')
      const allowed = res.headers.get('access-control-allow-headers') ?? ''
      for (const header of ['apikey', 'authorization', 'prefer', 'x-client-info']) {
        expect(allowed).toContain(header)
      }
      expect(res.headers.get('access-control-allow-methods')).toContain('PATCH')
    })

    it('exposes Content-Range, without which a count read is unreadable', async () => {
      const res = await fetch(`${origin}/rest/v1/exercises?select=*`)
      expect(res.headers.get('access-control-expose-headers')).toContain('Content-Range')
    })
  })

  describe('reads', () => {
    it('serves every collection as empty, whatever the filters and page window', async () => {
      const res = await fetch(
        `${origin}/rest/v1/sets?select=*&user_id=eq.local-dev&deleted_at=is.null` +
        '&order=created_at.asc,id.asc&offset=0&limit=1000',
      )
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([])
    })

    it('answers .single() over zero rows with 406 + PGRST116, not an empty array', async () => {
      // Load-bearing, not pedantry: `preferences._fetchFromSupabase` treats any
      // other code as a real sync failure (lighting the error indicator and
      // firing a session refresh), and `progression._fetchFromSupabase` pushes
      // its local row precisely BECAUSE of PGRST116. A 200 `[]` here would send
      // both stores down the wrong branch on every e2e sign-in.
      const res = await fetch(`${origin}/rest/v1/user_preferences?select=preferences&user_id=eq.local-dev`, {
        headers: { accept: 'application/vnd.pgrst.object+json' },
      })
      expect(res.status).toBe(406)
      expect(await res.json()).toMatchObject({ code: 'PGRST116' })
    })

    it('answers a head-only count with a parseable Content-Range', async () => {
      // `migrateLocalStorageToSupabase` aborts when the count query errors, and
      // reads the number out of `Content-Range` — the LIFT-787 guard.
      const res = await fetch(`${origin}/rest/v1/exercises?select=*&user_id=eq.local-dev`, {
        method: 'HEAD',
        headers: { prefer: 'count=exact' },
      })
      expect(res.status).toBe(200)
      const contentRange = res.headers.get('content-range')
      expect(contentRange).toBe('*/0')
      expect(Number.parseInt(String(contentRange).split('/')[1], 10)).toBe(0)
    })
  })

  describe('writes', () => {
    it('answers a return=minimal upsert with an empty body', async () => {
      // postgrest-js only reads `data: null, error: null` out of an EMPTY body;
      // any JSON here would be parsed as the returned rows.
      const res = await fetch(`${origin}/rest/v1/sets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ id: 'set-1', user_id: 'local-dev', exercise_id: 'ex-1', weight: 235, reps: 5 }),
      })
      expect(res.status).toBe(201)
      expect(await res.text()).toBe('')
    })

    it('echoes the rows back when the client asked for a representation', async () => {
      const res = await fetch(`${origin}/rest/v1/exercises`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          prefer: 'resolution=merge-duplicates,return=representation',
        },
        body: JSON.stringify([{ id: 'ex-1', user_id: 'local-dev', name: 'Squat abc123' }]),
      })
      expect(res.status).toBe(201)
      expect(await res.json()).toEqual([{ id: 'ex-1', user_id: 'local-dev', name: 'Squat abc123' }])
    })

    it('answers a soft-delete PATCH with 204', async () => {
      const res = await fetch(`${origin}/rest/v1/sets?id=eq.set-1&user_id=eq.local-dev`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deleted_at: '2026-09-19T00:00:00.000Z' }),
      })
      expect(res.status).toBe(204)
      expect(await res.text()).toBe('')
    })

    it('accepts an RPC call', async () => {
      const res = await fetch(`${origin}/rest/v1/rpc/delete_coach_data`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      expect(res.status).toBe(200)
    })
  })

  describe('the write log', () => {
    // The specs assert on this log rather than on stub state, so its shape is
    // the contract between the two halves of the harness.
    it('records each mutation with its table, method, rows and match filters', async () => {
      const { writes } = (await (await fetch(`${origin}/__writes`)).json()) as {
        writes: { method: string; table: string; rows: Record<string, unknown>[]; query: string }[]
      }

      const upsert = writes.find(w => w.table === 'sets' && w.method === 'POST')
      expect(upsert?.rows[0]).toMatchObject({ id: 'set-1', exercise_id: 'ex-1', weight: 235, reps: 5 })

      const exercise = writes.find(w => w.table === 'exercises' && w.method === 'POST')
      expect(exercise?.rows[0]).toMatchObject({ name: 'Squat abc123' })

      // A PATCH body carries only the changed values, so the row it targets is
      // recoverable only from the query string.
      const patch = writes.find(w => w.method === 'PATCH')
      expect(patch?.query).toContain('id=eq.set-1')
      expect(patch?.rows[0]).toMatchObject({ deleted_at: '2026-09-19T00:00:00.000Z' })

      expect(writes.some(w => w.method === 'RPC' && w.table === 'delete_coach_data')).toBe(true)
    })

    it('does not record reads', async () => {
      await fetch(`${origin}/rest/v1/bodyweight_entries?select=*`)
      const { writes } = (await (await fetch(`${origin}/__writes`)).json()) as {
        writes: { table: string }[]
      }
      expect(writes.some(w => w.table === 'bodyweight_entries')).toBe(false)
    })
  })

  describe('everything else', () => {
    it('accepts a sign-out', async () => {
      const res = await fetch(`${origin}/auth/v1/logout`, { method: 'POST' })
      expect(res.status).toBe(204)
    })

    it('fails loudly on an auth endpoint it does not implement', async () => {
      // A silent 200 here would let a spec believe it had signed in.
      const res = await fetch(`${origin}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ error: 'unsupported_stub_endpoint' })
    })

    it('404s an unrouted path rather than pretending to serve it', async () => {
      const res = await fetch(`${origin}/storage/v1/object/x`)
      expect(res.status).toBe(404)
    })
  })

  /**
   * `e2e/support/supabaseStub.ts` is the other half of the harness, imported by
   * BOTH `playwright.config.ts` (to decide whether to start the stub) and the
   * offline-sync spec (to read what the app pushed). Neither of those is covered
   * by `vue-tsc` or `npm run lint` — the e2e tree is outside both — and
   * Playwright transpiles without typechecking, so nothing else looks at this
   * file until a CI e2e run fifteen minutes downstream.
   */
  describe('the enable gate and write-log readers', () => {
    async function loadHelper(url: string | undefined) {
      vi.resetModules()
      if (url === undefined) vi.stubEnv('VITE_SUPABASE_URL', '')
      else vi.stubEnv('VITE_SUPABASE_URL', url)
      return import('../../../e2e/support/supabaseStub')
    }

    afterAll(() => { vi.unstubAllEnvs() })

    it('arms on a loopback URL and reports the port the stub must bind', async () => {
      const helper = await loadHelper('http://127.0.0.1:54331')
      expect(helper.stubEnabled).toBe(true)
      expect(helper.stubOrigin).toBe('http://127.0.0.1:54331')
      expect(helper.stubPort).toBe('54331')
    })

    it('stays disarmed when the variable is absent', async () => {
      const helper = await loadHelper(undefined)
      expect(helper.stubEnabled).toBe(false)
      expect(helper.stubOrigin).toBeNull()
    })

    it('refuses a non-loopback host', async () => {
      // The safety property, not a nicety: a developer with real Supabase
      // credentials exported in their shell would otherwise point a
      // write-recording harness — and a webServer that cannot bind that host —
      // at a live project. Anything off-loopback simply turns the harness off
      // and the specs skip.
      for (const url of [
        'https://spa-rho-sandy.supabase.co',
        'https://example.supabase.co',
        'http://192.168.1.20:54331',
        'not-a-url',
      ]) {
        const helper = await loadHelper(url)
        expect(helper.stubEnabled, url).toBe(false)
      }
    })

    it('reads the write log and deduplicates rows by primary key', async () => {
      // Deduplication is load-bearing for the specs' `toHaveLength(1)`
      // assertions: the log is append-only and an upsert is idempotent, so the
      // same exercise row is re-pushed every time a set is logged against it
      // (its updated_at moves) and a retried write appears twice. Counting write
      // EVENTS would fail for reasons that are not the behaviour under test.
      const helper = await loadHelper(origin)

      const row = { id: 'dedupe-me', user_id: 'local-dev', name: 'Squat zzz999', tags: [] }
      for (const tags of [[], ['push']]) {
        await fetch(`${origin}/rest/v1/exercises`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify({ ...row, tags }),
        })
      }

      const writes = await helper.stubWrites()
      expect(writes.filter(w => w.rows.some(r => r.id === 'dedupe-me'))).toHaveLength(2)

      const rows = await helper.stubRows('exercises')
      const deduped = rows.filter(r => r.id === 'dedupe-me')
      expect(deduped).toHaveLength(1)
      // Last write wins, matching what the server would actually be holding.
      expect(deduped[0]).toMatchObject({ tags: ['push'] })
    })

    it('returns nothing rather than reaching out when the harness is disarmed', async () => {
      const helper = await loadHelper(undefined)
      await expect(helper.stubWrites()).resolves.toEqual([])
      await expect(helper.stubRows('sets')).resolves.toEqual([])
    })

    /**
     * The harness spans three files that must agree on one value, and nothing
     * else looks at two of them: `vue-tsc` and ESLint both stop at `src/`, and
     * Playwright transpiles its config without typechecking. A disagreement
     * here does not fail loudly — it makes `stubEnabled` false, which SKIPS the
     * server-side specs, so the coverage silently disappears and CI stays green.
     */
    describe('wiring', () => {
      const e2eEnv = (() => {
        const wf = parse(readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8')) as {
          jobs?: Record<string, { env?: Record<string, string> }>
        }
        return wf.jobs?.e2e?.env ?? {}
      })()

      it('gives the CI e2e build a loopback Supabase URL that arms the harness', async () => {
        // Executed through the real resolver rather than pattern-matched, for
        // the LIFT-1412 reason: a gate that silently matches nothing is exactly
        // the failure a text assertion cannot see.
        const url = e2eEnv.VITE_SUPABASE_URL
        expect(url, 'the e2e job must set VITE_SUPABASE_URL or the sync layer stays inert').toBeTruthy()
        const helper = await loadHelper(url)
        expect(helper.stubEnabled).toBe(true)
        expect(helper.stubPort).toBe(new URL(url).port)
      })

      it('gives the client a non-empty key, which is all supabase-js requires', () => {
        // `createClient` throws on a falsy key and validates nothing else, so
        // this is the whole contract. The value addresses a process on
        // 127.0.0.1 that authenticates nothing — it is a placeholder, not a
        // credential.
        expect(e2eEnv.VITE_SUPABASE_ANON_KEY).toBeTruthy()
      })

      it('launches a stub CLI that exists, on the port derived from that URL', () => {
        const config = readFileSync(resolve(ROOT, 'playwright.config.ts'), 'utf8')
        const command = config.match(/command:\s*'node ([^']+)'/)
        expect(command, 'playwright.config.ts must launch the stub CLI').not.toBeNull()
        expect(existsSync(resolve(ROOT, command![1]))).toBe(true)
        // Derived from the same URL, never restated: a second copy of 54331
        // could drift from ci.yml, and the symptom would be silently skipped
        // specs rather than a failure.
        expect(config).toContain('E2E_SUPABASE_STUB_PORT: stubPort')
      })
    })
  })
})
