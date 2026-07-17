import { describe, it, expect, vi, beforeEach } from 'vitest'

// A mutable mock of the supabase singleton so each test can shape auth behavior.
const mockAuth = {
  refreshSession: vi.fn(),
}
vi.mock('../supabase', () => ({
  get supabase() {
    return mockSupabase
  },
}))
let mockSupabase: { auth: typeof mockAuth } | null = { auth: mockAuth }

import {
  isAuthError,
  ensureFreshSession,
  authNeedsReauth,
  clearReauthFlag,
  _resetSessionHealth,
} from '../sessionHealth'

beforeEach(() => {
  mockSupabase = { auth: mockAuth }
  mockAuth.refreshSession.mockReset()
  _resetSessionHealth()
})

describe('isAuthError', () => {
  it('detects a 401 numeric status', () => {
    expect(isAuthError({ status: 401 })).toBe(true)
    expect(isAuthError({ statusCode: 401 })).toBe(true)
    expect(isAuthError({ status: '401' })).toBe(true)
  })

  it('detects PostgREST JWT error codes', () => {
    expect(isAuthError({ code: 'PGRST301' })).toBe(true) // expired/invalid JWT
    expect(isAuthError({ code: 'PGRST303' })).toBe(true) // JWT from the future
  })

  it('detects auth-shaped messages', () => {
    expect(isAuthError({ message: 'JWT expired' })).toBe(true)
    expect(isAuthError({ message: 'Token has expired' })).toBe(true)
    expect(isAuthError({ message: 'invalid JWT: signature is invalid' })).toBe(true)
    expect(isAuthError({ message: 'Unauthorized' })).toBe(true)
  })

  it('does NOT flag offline / unrelated errors', () => {
    expect(isAuthError({ message: 'Failed to fetch' })).toBe(false)
    expect(isAuthError({ message: 'NetworkError when attempting to fetch resource' })).toBe(false)
    expect(isAuthError({ code: 'PGRST116' })).toBe(false) // no rows
    expect(isAuthError({ code: '23505' })).toBe(false) // unique violation
    expect(isAuthError(null)).toBe(false)
    expect(isAuthError(undefined)).toBe(false)
    expect(isAuthError('jwt expired')).toBe(false) // strings aren't error objects
  })
})

describe('ensureFreshSession', () => {
  it('returns true and clears the flag when refresh succeeds', async () => {
    authNeedsReauth.value = true
    mockAuth.refreshSession.mockResolvedValue({ data: { session: { access_token: 'fresh' } }, error: null })

    const ok = await ensureFreshSession()

    expect(ok).toBe(true)
    expect(authNeedsReauth.value).toBe(false)
    expect(mockAuth.refreshSession).toHaveBeenCalledTimes(1)
  })

  it('flips authNeedsReauth when refresh returns an error', async () => {
    mockAuth.refreshSession.mockResolvedValue({ data: { session: null }, error: { message: 'invalid refresh token' } })

    const ok = await ensureFreshSession()

    expect(ok).toBe(false)
    expect(authNeedsReauth.value).toBe(true)
  })

  it('flips authNeedsReauth when refresh throws', async () => {
    mockAuth.refreshSession.mockRejectedValue(new Error('network down'))

    const ok = await ensureFreshSession()

    expect(ok).toBe(false)
    expect(authNeedsReauth.value).toBe(true)
  })

  it('is single-flight — concurrent callers share ONE refresh', async () => {
    let resolveRefresh: (v: unknown) => void = () => {}
    mockAuth.refreshSession.mockReturnValue(
      new Promise((res) => { resolveRefresh = res }),
    )

    const a = ensureFreshSession()
    const b = ensureFreshSession()
    const c = ensureFreshSession()

    resolveRefresh({ data: { session: { access_token: 'x' } }, error: null })
    await Promise.all([a, b, c])

    expect(mockAuth.refreshSession).toHaveBeenCalledTimes(1)
  })

  it('allows a new refresh after the previous one settles', async () => {
    mockAuth.refreshSession.mockResolvedValue({ data: { session: { access_token: 'x' } }, error: null })

    await ensureFreshSession()
    await ensureFreshSession()

    expect(mockAuth.refreshSession).toHaveBeenCalledTimes(2)
  })

  it('returns false without throwing when supabase is unavailable', async () => {
    mockSupabase = null
    const ok = await ensureFreshSession()
    expect(ok).toBe(false)
  })
})

describe('clearReauthFlag', () => {
  it('resets the flag', () => {
    authNeedsReauth.value = true
    clearReauthFlag()
    expect(authNeedsReauth.value).toBe(false)
  })
})
