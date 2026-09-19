#!/usr/bin/env node
/**
 * CLI launcher for the e2e Supabase stub (LIFT-1008) — what Playwright's
 * `webServer` runs. The implementation, and the reasoning behind it, live in
 * `supabaseStubServer.mjs` beside this file.
 *
 * Deliberately unconditional, with no `import.meta.url === argv[1]` entry
 * guard: the split that makes the server importable for its unit test is what
 * keeps this file trivial, so there is nothing here that could decline to run
 * and leave Playwright waiting on a port nobody is listening to.
 */
import { createStubServer, DEFAULT_STUB_PORT } from './supabaseStubServer.mjs'

const port = Number(process.env.E2E_SUPABASE_STUB_PORT ?? DEFAULT_STUB_PORT)
const host = '127.0.0.1'

const { server } = createStubServer()
server.listen(port, host, () => {
  console.log(`[supabase-stub] listening on http://${host}:${port}`)
})
