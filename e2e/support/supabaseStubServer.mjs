/**
 * A deliberately WRITE-ONLY fake Supabase, for the e2e offline-sync specs
 * (LIFT-1008).
 *
 * ## Why this exists
 *
 * Everything in the sync layer is gated on the Supabase client existing:
 * `syncQueue.enqueue` / `enqueueDelete` / `rehydrate` / `replayJournal` all open
 * with `if (!supabase || isPreviewMode.value) return`. The e2e build has always
 * shipped without credentials, so the durable write queue, the IndexedDB
 * journal, the offline park (LIFT-1322) and the reconnect replay were not
 * merely untested end to end — not one line of them ever ran in a browser. The
 * app's defining architecture was validated exclusively by unit tests holding a
 * mocked client.
 *
 * Pointing `VITE_SUPABASE_URL` at this server gives the e2e build a real
 * endpoint, so those paths execute for real: a logged set is journaled, parked
 * while offline, and POSTed on reconnect over HTTP.
 *
 * ## Why it never serves rows back
 *
 * Every GET answers as an EMPTY collection, always. That is the property that
 * makes it safe to point the whole suite here:
 *
 *  - An empty remote merges nothing. `mergeEntities` only removes local rows via
 *    tombstones, so the seven pre-existing specs observe exactly the local-only
 *    state they observed before — their behaviour is unchanged while the write
 *    path underneath them becomes live.
 *  - Test isolation comes for free. Playwright runs spec files in parallel
 *    workers against this one process, and every spec signs in as the same
 *    `local-dev` user id, so a stub that served rows back would leak one spec's
 *    exercises into another's "empty slate" assertions. Reads returning nothing
 *    means the only shared state is the append-only write log, which each spec
 *    filters by an exercise name unique to itself.
 *  - It sharpens the assertions. With reads empty, a row can only reach the
 *    server because the client PUSHED it — never because it was already there.
 *
 * The cost is that "visible on a subsequent login" is not directly assertable
 * here; the substantive half ("the offline write reached the server") is, and
 * that is the half the mocked unit tests fake away.
 *
 * ## Fidelity
 *
 * Shapes match real PostgREST wherever the client can tell the difference,
 * because a double that quietly omits a behaviour certifies broken code as
 * correct (the `createFakeSupabase` max_rows rule, #1152). Pinned by
 * `src/lib/__tests__/e2eSupabaseStub.test.ts`:
 *
 *  - `.single()` over zero rows is 406 + PGRST116, NOT 200 `[]`. Both the
 *    preferences and progression stores branch on that exact code, and
 *    `progression` pushes its local row in response to it.
 *  - `head: true` + `count=exact` answers a `Content-Range` (exposed via CORS),
 *    because `migrateLocalStorageToSupabase` aborts when the count can't be
 *    trusted (LIFT-787).
 *  - An upsert with no `.select()` carries `Prefer: return=minimal`, so the
 *    reply is a status with an empty body — which postgrest-js maps to
 *    `{ data: null, error: null }`.
 *
 * Admin surface, for the test process only (never the browser):
 *   GET /__health  → readiness probe for Playwright's `webServer`
 *   GET /__writes  → the append-only log of every mutation received
 *
 * There is deliberately NO reset endpoint: workers share this process, so one
 * spec resetting it would erase another's in-flight evidence.
 *
 * This module is the implementation; `supabase-stub.mjs` beside it is the
 * unconditional CLI Playwright launches, the same split as
 * `scripts/live-domain.mjs` / `scripts/read-live-domain.mjs`.
 */
import { createServer } from 'node:http'

/** Default port. Overridden by `E2E_SUPABASE_STUB_PORT` in the CLI. */
export const DEFAULT_STUB_PORT = 54331

/**
 * Ceiling on the retained log. A full suite run writes a few hundred rows; the
 * cap only exists so a runaway retry loop can't grow this without bound.
 */
const MAX_WRITES = 10000

/** PostgREST's "JSON object requested, multiple (or no) rows returned". */
export const PGRST116 = {
  code: 'PGRST116',
  details: 'The result contains 0 rows',
  hint: null,
  message: 'JSON object requested, multiple (or no) rows returned',
}

/**
 * CORS for a cross-origin browser client. The app is served from
 * http://localhost:4173 (or :5173) and talks to this origin, so every response
 * — preflight included — needs these. `Content-Range` must be EXPOSED or
 * postgrest-js cannot read the count it was told to ask for.
 */
function corsHeaders(req) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, PATCH, PUT, DELETE, OPTIONS',
    // Echo the requested header list rather than '*': supabase-js sends
    // apikey/authorization/x-client-info/prefer, and echoing is accepted by
    // every engine the suite runs (WebKit included).
    'Access-Control-Allow-Headers':
      req.headers['access-control-request-headers'] ??
      'authorization, apikey, content-type, prefer, x-client-info, accept-profile, content-profile',
    'Access-Control-Expose-Headers': 'Content-Range, Content-Profile',
    'Access-Control-Max-Age': '86400',
  }
}

function send(req, res, status, body, headers = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body)
  res.writeHead(status, {
    ...corsHeaders(req),
    'Cache-Control': 'no-store',
    ...(payload ? { 'Content-Type': 'application/json' } : {}),
    ...headers,
  })
  res.end(req.method === 'HEAD' ? undefined : payload)
}

function sendEmpty(req, res, status) {
  res.writeHead(status, corsHeaders(req))
  res.end()
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (chunks.length === 0) return null
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
}

/** True when the client asked for a single object (`.single()`). */
function wantsSingleObject(req) {
  return (req.headers['accept'] ?? '').includes('application/vnd.pgrst.object+json')
}

/** True when the client asked for the mutated rows back (`.select()` chained). */
function wantsRepresentation(req) {
  return (req.headers['prefer'] ?? '').includes('return=representation')
}

/**
 * Build the stub server. Call `.listen(port, host)` on the returned `server`.
 *
 * @returns {{ server: import('node:http').Server, writes: {
 *   seq: number, method: string, table: string,
 *   rows: Record<string, unknown>[], query: string, at: number
 * }[] }}
 */
export function createStubServer() {
  const writes = []
  let seq = 0

  /** Record one mutation. Bodies are normalised to an array of rows. */
  function record(method, table, body, query) {
    const rows = body === null ? [] : Array.isArray(body) ? body : [body]
    writes.push({ seq: ++seq, method, table, rows, query, at: Date.now() })
    if (writes.length > MAX_WRITES) writes.splice(0, writes.length - MAX_WRITES)
  }

  async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://stub.invalid')
    const path = url.pathname
    const method = req.method ?? 'GET'

    if (method === 'OPTIONS') {
      sendEmpty(req, res, 204)
      return
    }

    // --- Admin surface (test process only) ---------------------------------
    if (path === '/__health') {
      send(req, res, 200, { ok: true, writes: writes.length })
      return
    }
    if (path === '/__writes') {
      send(req, res, 200, { writes })
      return
    }

    // --- PostgREST ----------------------------------------------------------
    if (path.startsWith('/rest/v1/')) {
      const resource = path.slice('/rest/v1/'.length)

      if (resource.startsWith('rpc/')) {
        record('RPC', resource.slice('rpc/'.length), await readBody(req), url.search)
        send(req, res, 200, null)
        return
      }

      const table = resource
      switch (method) {
        case 'HEAD':
        case 'GET': {
          // Always empty — see the header comment. `*/0` is the shape PostgREST
          // uses for an empty collection, and is what supplies `count: 0`.
          if (method === 'GET' && wantsSingleObject(req)) {
            send(req, res, 406, PGRST116)
            return
          }
          send(req, res, 200, method === 'HEAD' ? undefined : [], { 'Content-Range': '*/0' })
          return
        }
        case 'POST': {
          const body = await readBody(req)
          record('POST', table, body, url.search)
          if (wantsRepresentation(req)) {
            send(req, res, 201, Array.isArray(body) ? body : [body])
            return
          }
          // Prefer: return=minimal — an empty body, which postgrest-js reads as
          // `{ data: null, error: null }`.
          sendEmpty(req, res, 201)
          return
        }
        case 'PATCH': {
          const body = await readBody(req)
          record('PATCH', table, body, url.search)
          if (wantsRepresentation(req)) {
            send(req, res, 200, Array.isArray(body) ? body : [body])
            return
          }
          sendEmpty(req, res, 204)
          return
        }
        case 'DELETE': {
          record('DELETE', table, await readBody(req), url.search)
          sendEmpty(req, res, 204)
          return
        }
        default:
          send(req, res, 405, { message: `Unsupported method ${method}` })
          return
      }
    }

    // --- GoTrue -------------------------------------------------------------
    if (path.startsWith('/auth/v1/')) {
      // The e2e build authenticates through the dev button, which never creates
      // a Supabase session — so `signOut()` short-circuits before the network,
      // and this exists mostly to make an unexpected auth call visible rather
      // than silent.
      if (path === '/auth/v1/logout') {
        sendEmpty(req, res, 204)
        return
      }
      send(req, res, 400, {
        error: 'unsupported_stub_endpoint',
        error_description: `The e2e Supabase stub does not implement ${path}`,
      })
      return
    }

    send(req, res, 404, { message: `No stub route for ${method} ${path}` })
  }

  const server = createServer((req, res) => {
    void handle(req, res).catch((err) => {
      send(req, res, 500, { message: String(err) })
    })
  })

  return { server, writes }
}
