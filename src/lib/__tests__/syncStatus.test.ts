/**
 * Tests for the shared sync-status classifier (LIFT-820).
 *
 * The four stores all funnel fetch failures through `classifySyncError` so the
 * UI sees one typed contract — auth failures (re-sign-in needed) must be told
 * apart from ordinary offline/network failures (transient, will recover).
 */
import { describe, it, expect } from 'vitest'
import { classifySyncError, combineSyncStatus, isRetryableSyncFailure } from '../syncStatus'

describe('classifySyncError', () => {
  it('classifies a 401 status as auth', () => {
    expect(classifySyncError({ status: 401 })).toBe('auth')
  })

  it('classifies a PostgREST JWT-expiry code as auth', () => {
    expect(classifySyncError({ code: 'PGRST301', message: 'JWT expired' })).toBe('auth')
  })

  it('classifies a "jwt expired" message as auth', () => {
    expect(classifySyncError(new Error('JWT expired'))).toBe('auth')
  })

  it('classifies a fetch-layer TypeError as network', () => {
    expect(classifySyncError(new TypeError('Failed to fetch'))).toBe('network')
  })

  it('classifies a supabase-js network throw as network', () => {
    expect(classifySyncError(new Error('Network request failed'))).toBe('network')
  })

  it('classifies an offline message as network', () => {
    expect(classifySyncError(new Error('The network connection was lost (offline)'))).toBe('network')
  })

  it('falls back to unknown for an opaque server error', () => {
    expect(classifySyncError({ code: 'PGRST500', message: 'internal server error' })).toBe('unknown')
  })

  it('falls back to unknown for null / undefined', () => {
    expect(classifySyncError(null)).toBe('unknown')
    expect(classifySyncError(undefined)).toBe('unknown')
  })
})

/**
 * Retryability of a failed WRITE (LIFT-1321).
 *
 * The write queue burns five exponential-backoff retries (~31s) on anything it
 * calls retryable, so the split has to hold at the boundaries: a request that
 * never reached the server, or one the server may answer differently in a
 * moment, is worth repeating; one Postgres understood and refused is not.
 */
describe('isRetryableSyncFailure (LIFT-1321)', () => {
  /** The exact envelope postgrest-js resolves when `fetch` rejects. */
  const FETCH_FAILURE = { message: 'TypeError: Failed to fetch', code: '', details: '', hint: '' }

  it('retries the resolved fetch-failure envelope postgrest-js produces offline', () => {
    // This is THE case the whole issue is about: offline mutations do not
    // reject, they resolve with this shape and `status: 0`.
    expect(isRetryableSyncFailure(FETCH_FAILURE, 0)).toBe(true)
  })

  it('retries an expired token so the post-refresh attempt can land', () => {
    expect(isRetryableSyncFailure({ code: 'PGRST301', message: 'JWT expired' }, 401)).toBe(true)
    // A 401 whose body this app can't parse (an API gateway, a proxy) must not
    // fall into the permanent 4xx bucket — it is still a token problem.
    expect(isRetryableSyncFailure({ message: 'no' }, 401)).toBe(true)
  })

  it('retries 5xx, 408 and 429 — the server may answer differently next time', () => {
    expect(isRetryableSyncFailure({ message: 'internal server error' }, 500)).toBe(true)
    expect(isRetryableSyncFailure({ message: 'bad gateway' }, 502)).toBe(true)
    expect(isRetryableSyncFailure({ message: 'service unavailable' }, 503)).toBe(true)
    expect(isRetryableSyncFailure({ message: 'timeout' }, 408)).toBe(true)
    expect(isRetryableSyncFailure({ message: 'too many requests' }, 429)).toBe(true)
  })

  it('does NOT retry a 4xx the server understood and refused', () => {
    // RLS denial on insert, unique violation, FK violation, schema-cache miss —
    // byte-for-byte replay cannot change any of these answers.
    expect(isRetryableSyncFailure({ code: '42501', message: 'permission denied' }, 403)).toBe(false)
    expect(isRetryableSyncFailure({ code: '23505', message: 'duplicate key' }, 409)).toBe(false)
    expect(isRetryableSyncFailure({ code: '23503', message: 'foreign key violation' }, 409)).toBe(false)
    expect(isRetryableSyncFailure({ code: 'PGRST204', message: "column 'gyms' not found" }, 400)).toBe(false)
  })

  it('falls back to the error code when no HTTP status is available', () => {
    // A thrown PostgrestError (shouldThrowOnError) carries a code but no status.
    expect(isRetryableSyncFailure({ code: '23505', message: 'duplicate key' })).toBe(false)
    // A code-less failure is unclassifiable; retrying beats abandoning a real write.
    expect(isRetryableSyncFailure(new Error('something odd happened'))).toBe(true)
    expect(isRetryableSyncFailure(FETCH_FAILURE)).toBe(true)
  })

  it('retries a network failure even when the status says otherwise', () => {
    // Transport classification wins over a nonsensical status so a proxy that
    // stamps a 400 on a dropped connection can't strand the write.
    expect(isRetryableSyncFailure(new TypeError('Failed to fetch'), 400)).toBe(true)
  })

  it('handles malformed error values without throwing', () => {
    for (const bad of [null, undefined, 0, '', 'boom', [], {}]) {
      expect(() => isRetryableSyncFailure(bad, undefined)).not.toThrow()
    }
    expect(isRetryableSyncFailure(null)).toBe(true)
  })
})

describe('combineSyncStatus (LIFT-1179)', () => {
  it('surfaces a background READ error as error when the write queue is idle', () => {
    // The core bug: a silent read failure left the indicator showing a false
    // 'synced' because it reflected only the write queue.
    expect(combineSyncStatus('synced', 'auth')).toBe('error')
    expect(combineSyncStatus('synced', 'network')).toBe('error')
    expect(combineSyncStatus('synced', 'unknown')).toBe('error')
  })

  it('stays synced when the write queue is idle and no read error is pending', () => {
    expect(combineSyncStatus('synced', null)).toBe('synced')
  })

  it('lets the live write status win over a stale read error', () => {
    // 'syncing' and 'offline'/'error' are the freshest signal and already model
    // active/offline state, so they must not be masked by a lingering read error.
    expect(combineSyncStatus('syncing', 'network')).toBe('syncing')
    expect(combineSyncStatus('offline', 'auth')).toBe('offline')
    expect(combineSyncStatus('error', null)).toBe('error')
  })
})
