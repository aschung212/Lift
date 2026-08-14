/**
 * initSupabase() client-construction contract (LIFT-1134 / LIFT-784).
 *
 * `initSupabase()` MUST create the Supabase client with an explicit `auth`
 * options object. These options happen to match supabase-js defaults today, so
 * the app "works" without them — but that reliance is exactly the brittleness
 * LIFT-1134 flags: a future refactor that adds an options object for a custom
 * storage / fetch / headers could silently omit `persistSession` /
 * `autoRefreshToken` and reintroduce the mid-session 401s LIFT-784 fixed. This
 * suite pins the construction arguments so that regression fails loudly here
 * instead of silently in production on a WKWebView resume.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The real SDK is dynamically imported inside initSupabase(); stub it so we can
// inspect the construction arguments without opening a network client.
const { createClientSpy } = vi.hoisted(() => ({
  createClientSpy: vi.fn(() => ({ __mockClient: true })),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientSpy }))

// The global test setup (src/__tests__/setup.ts) mocks ../supabase to
// { supabase: null } because most tests want the local-first path. This file is
// the exception: it exercises the real initSupabase(), so reverse that mock.
vi.unmock('../supabase')

/** Re-evaluate the module so its module-scope env reads pick up stubbed vars. */
async function loadFresh(): Promise<typeof import('../supabase')> {
  vi.resetModules()
  return import('../supabase')
}

describe('initSupabase — client construction contract', () => {
  beforeEach(() => {
    createClientSpy.mockClear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('constructs the client with explicit persistSession / autoRefreshToken / detectSessionInUrl', async () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key-123')

    const mod = await loadFresh()
    await mod.initSupabase()

    expect(createClientSpy).toHaveBeenCalledTimes(1)
    const [url, key, options] = createClientSpy.mock.calls[0] as [
      string,
      string,
      { auth?: Record<string, unknown> },
    ]
    expect(url).toBe('https://project.supabase.co')
    expect(key).toBe('anon-key-123')
    // toMatchObject (not toEqual): pin the three lifecycle options without
    // forbidding a future intentional addition (e.g. a custom storage adapter).
    expect(options.auth).toMatchObject({
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    })
    expect(mod.supabase).not.toBeNull()
  })

  it('does not construct a client in dev mode (stays on the local-first path)', async () => {
    vi.stubEnv('DEV', true)
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key-123')

    const mod = await loadFresh()
    await mod.initSupabase()

    expect(createClientSpy).not.toHaveBeenCalled()
    expect(mod.supabase).toBeNull()
  })

  it('does not construct a client when the Supabase env vars are missing', async () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')

    const mod = await loadFresh()
    await mod.initSupabase()

    expect(createClientSpy).not.toHaveBeenCalled()
    expect(mod.supabase).toBeNull()
  })
})
