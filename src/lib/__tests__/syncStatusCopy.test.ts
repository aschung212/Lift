/**
 * Sync-sheet copy (LIFT-1323).
 *
 * The wording IS the feature: until the sheet existed, the entire explanation
 * of a sync failure was a `:title` tooltip on a 24px icon, which a touch device
 * cannot reveal at all. These assert the two rules the strings must never
 * break — never claim data is backed up when it is not (the LIFT-1310 guest
 * lie), and always say where the data actually IS, since the local-first store
 * means "sync failed" never means "your workout is gone".
 */
import { describe, it, expect } from 'vitest'
import { changeCount, describeSyncState, formatLastSynced } from '../syncStatusCopy'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const NOW = Date.UTC(2026, 8, 3, 12, 0, 0)

describe('changeCount', () => {
  it('singularizes one change', () => {
    expect(changeCount(1)).toBe('1 change')
  })

  it('pluralizes everything else', () => {
    expect(changeCount(0)).toBe('0 changes')
    expect(changeCount(2)).toBe('2 changes')
  })
})

describe('formatLastSynced', () => {
  it('reports never when this session has not reached the server', () => {
    expect(formatLastSynced(null, NOW)).toBe('Never')
  })

  it('rounds the last minute down to "Just now"', () => {
    expect(formatLastSynced(NOW - 1_000, NOW)).toBe('Just now')
    expect(formatLastSynced(NOW - 59_000, NOW)).toBe('Just now')
  })

  it('steps through minutes, hours and days', () => {
    expect(formatLastSynced(NOW - MINUTE, NOW)).toBe('1 minute ago')
    expect(formatLastSynced(NOW - 5 * MINUTE, NOW)).toBe('5 minutes ago')
    expect(formatLastSynced(NOW - HOUR, NOW)).toBe('1 hour ago')
    expect(formatLastSynced(NOW - 3 * HOUR, NOW)).toBe('3 hours ago')
    expect(formatLastSynced(NOW - DAY, NOW)).toBe('1 day ago')
    expect(formatLastSynced(NOW - 3 * DAY, NOW)).toBe('3 days ago')
  })

  it('falls back to a date past a week', () => {
    const label = formatLastSynced(NOW - 30 * DAY, NOW)
    expect(label).not.toMatch(/ago|Never|Just now/)
    expect(label.length).toBeGreaterThan(0)
  })

  it('never renders a future duration when the clock moved backwards', () => {
    // A device clock that jumped back (or a stamp written by a tab whose clock
    // ran ahead) must not produce "in 3 hours" on a reassurance surface.
    expect(formatLastSynced(NOW + HOUR, NOW)).toBe('Just now')
  })
})

describe('describeSyncState', () => {
  const base = { status: 'synced' as const, pending: 0, stranded: 0, localOnly: false }

  it('never promises a backup to a user with no account', () => {
    // LIFT-1310: Settings told a guest their data was "Synced over encrypted
    // HTTPS" while App.vue's own banner said it never left the device. The
    // local-only branch runs ahead of every transport state so that class of
    // contradiction cannot come back through this surface.
    const copy = describeSyncState({ ...base, localOnly: true, status: 'offline', pending: 4 })
    expect(copy.detail).toContain('this device only')
    expect(copy.detail.toLowerCase()).not.toContain('backed up')
    expect(copy.title).toBe('Not syncing')
  })

  it('says where offline changes are, and how many', () => {
    const copy = describeSyncState({ ...base, status: 'offline', pending: 3 })
    expect(copy.title).toBe('Offline')
    expect(copy.detail).toContain('3 changes')
    expect(copy.detail).toContain("back online")
  })

  it('reassures an offline user with nothing queued', () => {
    const copy = describeSyncState({ ...base, status: 'offline' })
    expect(copy.detail).toContain('saved on this device')
  })

  it('names the exact number of changes the app gave up on', () => {
    // The escalation the issue is about: a stranded write is a local-only row
    // the server has never seen, and the count is the whole point.
    const copy = describeSyncState({ ...base, status: 'error', pending: 2, stranded: 2 })
    expect(copy.title).toBe("Some changes didn't sync")
    expect(copy.detail).toContain('2 changes')
    expect(copy.detail).toContain('not in your account')
  })

  it('agrees with itself on number for a single stranded change', () => {
    const copy = describeSyncState({ ...base, status: 'error', pending: 1, stranded: 1 })
    expect(copy.detail).toContain('1 change is saved')
  })

  it('promises a retry for a transient failure with nothing stranded', () => {
    const copy = describeSyncState({ ...base, status: 'error' })
    expect(copy.title).toBe('Sync failed')
    expect(copy.detail).toContain('saved on this device')
    expect(copy.detail).toContain('keep trying')
  })

  it('treats a queued-but-unflushed write as syncing, not as synced', () => {
    // `syncStatus` stays 'synced' for the queue's debounce, so reading it alone
    // would tell the user a change they just made is already in their account.
    const copy = describeSyncState({ ...base, status: 'synced', pending: 1 })
    expect(copy.title).toBe('Syncing')
    expect(copy.detail).toContain('1 change')
  })

  it('confirms a clean state plainly', () => {
    const copy = describeSyncState(base)
    expect(copy.title).toBe('Everything is synced')
    expect(copy.detail).toContain('backed up')
  })
})
