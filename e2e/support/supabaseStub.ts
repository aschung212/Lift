/**
 * Test-process half of the e2e Supabase stub (LIFT-1008).
 *
 * Imported by BOTH `playwright.config.ts` (to decide whether to start the stub
 * `webServer`) and the offline-sync spec (to read what the app pushed), so it
 * deliberately imports nothing from `@playwright/test`.
 *
 * ## The enable gate
 *
 * `VITE_SUPABASE_URL` is the single source of truth: the CI e2e job sets it, so
 * the same value both bakes into the bundle at build time (Vite exposes
 * `VITE_`-prefixed process env vars, the way `VITE_E2E` already reaches
 * `AuthScreen`) and tells this module where the stub listens. One variable,
 * no second copy to drift.
 *
 * The gate additionally requires a LOOPBACK host. That is a safety property,
 * not tidiness: a developer with real Supabase credentials exported in their
 * shell would otherwise have the offline-sync specs aim a write-recording
 * harness — and a `webServer` that fails to bind — at a real project. Anything
 * that isn't 127.0.0.1 / localhost / ::1 simply turns the harness off, and the
 * specs that need it skip.
 *
 * Note the specs stay skipped under `npm run test:e2e` locally even with the
 * variable set, because the local `webServer` is `npm run dev` and
 * `initSupabase()` returns early on `import.meta.env.DEV` — there is no client
 * to drive. They run against the CI preview build, alongside the
 * service-worker-gated reload spec that has the same shape of constraint.
 */

/** One mutation as recorded by `e2e/support/supabase-stub.mjs`. */
export interface StubWrite {
  seq: number
  method: string
  table: string
  rows: Record<string, unknown>[]
  query: string
  at: number
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

function resolveStubOrigin(raw: string | undefined): string | null {
  if (!raw) return null
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) return null
  return parsed.origin
}

/** Origin the stub listens on, or null when the harness is disabled. */
export const stubOrigin: string | null = resolveStubOrigin(process.env.VITE_SUPABASE_URL)

/** True when the build under test points at the loopback stub. */
export const stubEnabled: boolean = stubOrigin !== null

/** Port the stub must bind, derived from the same URL the bundle was built with. */
export const stubPort: string = stubOrigin ? new URL(stubOrigin).port || '80' : ''

/** Reason string for `test.skip` when the harness is off. */
export const STUB_DISABLED_REASON =
  'No loopback Supabase stub (VITE_SUPABASE_URL unset) — the sync layer is inert without a client'

/** Every mutation the app has pushed since the stub started. */
export async function stubWrites(): Promise<StubWrite[]> {
  if (!stubOrigin) return []
  const res = await fetch(`${stubOrigin}/__writes`)
  if (!res.ok) throw new Error(`Supabase stub returned ${res.status} for /__writes`)
  const body = (await res.json()) as { writes: StubWrite[] }
  return body.writes
}

/**
 * Distinct rows the app has written to `table`, keyed by primary key.
 *
 * Deduplicated because the log is append-only and an upsert is idempotent: the
 * same exercise row is re-pushed on every set logged against it (its
 * `updated_at` moves), and a retried write appears twice. Counting write EVENTS
 * would make "the server holds one set" fail for reasons that are not the
 * behaviour under test.
 *
 * Rows with no `id` (a `user_preferences` upsert keyed on `user_id`, a PATCH
 * carrying only changed values) are skipped — nothing here asserts on them.
 */
export async function stubRows(table: string): Promise<Record<string, unknown>[]> {
  const byId = new Map<string, Record<string, unknown>>()
  for (const write of await stubWrites()) {
    if (write.table !== table) continue
    for (const row of write.rows) {
      const id = row?.id
      if (typeof id === 'string') byId.set(id, row)
    }
  }
  return [...byId.values()]
}
