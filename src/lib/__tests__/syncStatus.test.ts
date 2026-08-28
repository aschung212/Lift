/**
 * Tests for the shared sync-status classifier (LIFT-820).
 *
 * The four stores all funnel fetch failures through `classifySyncError` so the
 * UI sees one typed contract — auth failures (re-sign-in needed) must be told
 * apart from ordinary offline/network failures (transient, will recover).
 */
import { describe, it, expect } from 'vitest'
import { classifySyncError, combineSyncStatus } from '../syncStatus'

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
