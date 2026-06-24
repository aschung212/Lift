import { describe, it, expect, vi } from 'vitest'

// The global setup (src/__tests__/setup.ts) mocks this module to { supabase: null }
// for the local-first store tests. Here we assert against the REAL auth config.
vi.unmock('../supabase')
const { SUPABASE_AUTH_OPTIONS } = await vi.importActual<typeof import('../supabase')>('../supabase')

// Pins the security-relevant auth config so a regression can't silently revert
// the hardening. See LIFT-784 (session lifecycle) and LIFT-808 (PKCE flow).
describe('SUPABASE_AUTH_OPTIONS', () => {
  it('uses the PKCE flow, not the legacy implicit flow (LIFT-808)', () => {
    // supabase-js v2 defaults flowType to 'implicit', which returns the access
    // token in the URL fragment where it leaks into history/Referer. PKCE must
    // be explicit so OAuth tokens are exchanged via a one-time code instead.
    expect(SUPABASE_AUTH_OPTIONS.flowType).toBe('pkce')
  })

  it('keeps the explicit session lifecycle contract (LIFT-784)', () => {
    expect(SUPABASE_AUTH_OPTIONS.persistSession).toBe(true)
    expect(SUPABASE_AUTH_OPTIONS.autoRefreshToken).toBe(true)
    // detectSessionInUrl performs the PKCE code→session exchange on redirect back.
    expect(SUPABASE_AUTH_OPTIONS.detectSessionInUrl).toBe(true)
  })
})
