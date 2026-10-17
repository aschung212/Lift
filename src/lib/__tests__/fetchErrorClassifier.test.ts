/**
 * LIFT-786: read failures must be distinguishable — offline (expected, quiet)
 * vs auth / server-RLS (observable). These tests pin the classification and
 * the telemetry routing, and that a read failure stays out of the write
 * queue's status (LIFT-1543): the store's `lastSyncError` is what shows it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../logger', () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}))

vi.mock('../crossTabSync', () => ({
  broadcastSyncStatus: vi.fn(),
}))

import { classifyFetchError, reportFetchError } from '../fetchErrorClassifier'
import { syncStatus } from '../syncQueue'
import { logError, logWarn } from '../logger'
import { broadcastSyncStatus } from '../crossTabSync'

describe('classifyFetchError', () => {
  const originalOnLine = Object.getOwnPropertyDescriptor(navigator, 'onLine')

  afterEach(() => {
    if (originalOnLine) Object.defineProperty(navigator, 'onLine', originalOnLine)
  })

  function setOnLine(value: boolean) {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value })
  }

  it('classifies thrown network errors as offline', () => {
    setOnLine(true)
    expect(classifyFetchError(new Error('Failed to fetch'))).toBe('offline')
    expect(classifyFetchError(new Error('Network request failed'))).toBe('offline')
    expect(classifyFetchError(new Error('Load failed'))).toBe('offline')
    expect(classifyFetchError(new TypeError('NetworkError when attempting to fetch'))).toBe('offline')
  })

  it('treats navigator.onLine === false as offline regardless of message', () => {
    setOnLine(false)
    // Even an RLS-shaped error is "offline" when the device knows it has no link.
    expect(classifyFetchError({ code: '42501', message: 'permission denied' })).toBe('offline')
  })

  it('classifies JWT / 401 errors as auth', () => {
    setOnLine(true)
    expect(classifyFetchError({ code: 'PGRST301', message: 'JWT expired' })).toBe('auth')
    expect(classifyFetchError({ status: 401, message: 'Unauthorized' })).toBe('auth')
    expect(classifyFetchError({ message: 'JWT expired' })).toBe('auth')
    expect(classifyFetchError({ message: 'Not authorized' })).toBe('auth')
  })

  it('classifies RLS denial and server errors as server', () => {
    setOnLine(true)
    // Postgres insufficient_privilege (the classic RLS denial).
    expect(classifyFetchError({ code: '42501', message: 'permission denied for table sets' })).toBe('server')
    expect(classifyFetchError({ status: 500, message: 'internal server error' })).toBe('server')
    expect(classifyFetchError({ code: 'PGRST200', message: 'malformed query' })).toBe('server')
  })

  it('defaults unknown errors to server (the observable, must-not-be-masked case)', () => {
    setOnLine(true)
    expect(classifyFetchError(undefined)).toBe('server')
    expect(classifyFetchError('something weird')).toBe('server')
  })
})

describe('reportFetchError', () => {
  const originalOnLine = Object.getOwnPropertyDescriptor(navigator, 'onLine')

  beforeEach(() => {
    vi.clearAllMocks()
    syncStatus.value = 'synced'
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
  })

  afterEach(() => {
    if (originalOnLine) Object.defineProperty(navigator, 'onLine', originalOnLine)
  })

  it('offline failures stay quiet: console warn only, no Sentry, no degraded status', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    const category = reportFetchError('workout', new Error('Failed to fetch'))

    expect(category).toBe('offline')
    expect(logWarn).toHaveBeenCalledWith(
      expect.stringContaining('Supabase fetch failed in workout store'),
      expect.objectContaining({ store: 'workout', category: 'offline' }),
    )
    expect(logError).not.toHaveBeenCalled()
    expect(syncStatus.value).toBe('synced')
    expect(broadcastSyncStatus).not.toHaveBeenCalled()
  })

  it('server/RLS failures are observable: Sentry error', () => {
    const category = reportFetchError('workout', { code: '42501', message: 'permission denied' })

    expect(category).toBe('server')
    expect(logError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ store: 'workout', category: 'server' }),
    )
  })

  it('auth failures are observable: Sentry error', () => {
    const category = reportFetchError('preferences', { code: 'PGRST301', message: 'JWT expired' })

    expect(category).toBe('auth')
    expect(logError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ store: 'preferences', category: 'auth' }),
    )
  })

  // LIFT-1543. These two cases used to assert `syncStatus === 'error'` and an
  // 'error' broadcast. Nothing on the read path can set that ref back (only a
  // write flush does), so a read that failed and then recovered kept "Sync
  // failed" up until some unrelated write flushed, and every other open tab
  // was told the same about reads of its own that were fine. The store's
  // `lastSyncError` carries the failure to the indicator instead.
  it.each([
    { category: 'server', error: { code: '42501', message: 'permission denied' } },
    { category: 'auth', error: { code: 'PGRST301', message: 'JWT expired' } },
  ])('leaves the write queue status alone for a $category failure, whatever it holds', ({ error }) => {
    for (const held of ['synced', 'syncing', 'offline', 'error'] as const) {
      syncStatus.value = held
      reportFetchError('bodyweight', error)
      expect(syncStatus.value).toBe(held)
    }
    expect(broadcastSyncStatus).not.toHaveBeenCalled()
  })
})
