/**
 * The first-read gate's own mechanics (LIFT-1515): which account's row this
 * device has read, the base held edits are measured against, and the replay
 * that lays those edits over the account's copy. The store-level behaviour —
 * what reaches the server, and when — is `accountRowReadGate.test.ts`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  bindAccountRow,
  hasReadAccountRow,
  markAccountRowRead,
  forgetAccountRow,
  heldEditPaths,
  heldEditsSince,
  replayHeldEdits,
} from '../accountRowRead'

beforeEach(() => {
  localStorage.clear()
})

describe('bindAccountRow', () => {
  it('holds on a device that has never read the row, persisting the base it captured', () => {
    const capture = vi.fn(() => '{"theme":"eternal"}')
    expect(bindAccountRow('preferences', 'u1', capture)).toEqual({ read: false, heldBase: '{"theme":"eternal"}' })
    expect(capture).toHaveBeenCalledTimes(1)
    expect(hasReadAccountRow('preferences', 'u1')).toBe(false)
  })

  it('reuses the base an earlier launch started holding from instead of recapturing', () => {
    // The second launch's local copy already carries the first launch's edit;
    // recapturing would make that edit part of the base and lose it.
    bindAccountRow('preferences', 'u1', () => '{"theme":"eternal"}')
    const recapture = vi.fn(() => '{"theme":"fire"}')
    expect(bindAccountRow('preferences', 'u1', recapture)).toEqual({ read: false, heldBase: '{"theme":"eternal"}' })
    expect(recapture).not.toHaveBeenCalled()
  })

  it('reports a read once one has been recorded, for that user only', () => {
    bindAccountRow('preferences', 'u1', () => '{}')
    markAccountRowRead('preferences', 'u1')
    expect(bindAccountRow('preferences', 'u1', () => '{}')).toEqual({ read: true })
    expect(hasReadAccountRow('preferences', 'u1')).toBe(true)
    expect(hasReadAccountRow('preferences', 'u2')).toBe(false)
  })

  it('never lets one account inherit another\'s read or base', () => {
    markAccountRowRead('preferences', 'u1')
    expect(bindAccountRow('preferences', 'u2', () => '{"gyms":[]}')).toEqual({ read: false, heldBase: '{"gyms":[]}' })
    // And the replaced record now belongs to u2.
    expect(hasReadAccountRow('preferences', 'u1')).toBe(false)
  })

  it('keeps the two stores\' records apart', () => {
    markAccountRowRead('progression', 'u1')
    expect(hasReadAccountRow('progression', 'u1')).toBe(true)
    expect(hasReadAccountRow('preferences', 'u1')).toBe(false)
  })

  it('binds without a base when the store keeps none', () => {
    expect(bindAccountRow('progression', 'u1')).toEqual({ read: false, heldBase: null })
    expect(bindAccountRow('progression', 'u1')).toEqual({ read: false, heldBase: null })
  })

  it('forgets the binding entirely (the sign-out wipe)', () => {
    markAccountRowRead('preferences', 'u1')
    forgetAccountRow('preferences')
    expect(hasReadAccountRow('preferences', 'u1')).toBe(false)
    expect(localStorage.getItem('account-row:preferences')).toBeNull()
  })

  it('reads a corrupt record as never read — the safe direction', () => {
    for (const raw of ['not json', '[]', '{"userId":"u1"}', '{"userId":7,"read":true}', 'null']) {
      localStorage.setItem('account-row:preferences', raw)
      expect(hasReadAccountRow('preferences', 'u1')).toBe(false)
    }
  })

  it('still answers "hold" when storage is unavailable', () => {
    const original = globalThis.localStorage
    const fail = () => { throw new Error('QuotaExceededError') }
    vi.stubGlobal('localStorage', { getItem: fail, setItem: fail, removeItem: fail, clear: () => {} })
    try {
      expect(bindAccountRow('preferences', 'u1', () => '{}')).toEqual({ read: false, heldBase: '{}' })
      expect(() => markAccountRowRead('preferences', 'u1')).not.toThrow()
      expect(() => forgetAccountRow('preferences')).not.toThrow()
      expect(hasReadAccountRow('preferences', 'u1')).toBe(false)
    } finally {
      vi.stubGlobal('localStorage', original)
    }
  })
})

describe('heldEditPaths', () => {
  const base = {
    theme: 'eternal',
    experience: { haptics: true, prCelebrations: true },
    gyms: [] as string[],
    coachProfile: { age: null, competition: { sport: '' } },
  }

  it('finds nothing when nothing changed', () => {
    expect(heldEditPaths(base, structuredClone(base))).toEqual([])
  })

  it('names a changed top-level value', () => {
    expect(heldEditPaths(base, { ...base, theme: 'fire' })).toEqual([['theme']])
  })

  it('descends into objects so one flag is one edit, not the whole group', () => {
    const local = { ...base, experience: { ...base.experience, haptics: false } }
    expect(heldEditPaths(base, local)).toEqual([['experience', 'haptics']])
    const deep = { ...base, coachProfile: { age: null, competition: { sport: 'powerlifting' } } }
    expect(heldEditPaths(base, deep)).toEqual([['coachProfile', 'competition', 'sport']])
  })

  it('treats an array as one value', () => {
    expect(heldEditPaths(base, { ...base, gyms: ['Garage'] })).toEqual([['gyms']])
  })

  it('names a key present on only one side', () => {
    expect(heldEditPaths({ a: 1 }, { a: 1, b: 2 })).toEqual([['b']])
    expect(heldEditPaths({ a: 1, b: 2 }, { a: 1 })).toEqual([['b']])
  })
})

describe('heldEditsSince', () => {
  it('has no edits once the row has been read (no base)', () => {
    expect(heldEditsSince(null, { theme: 'fire' })).toEqual([])
  })

  it('measures against the persisted base', () => {
    expect(heldEditsSince('{"theme":"eternal"}', { theme: 'fire' })).toEqual([['theme']])
  })

  it('lets the account win rather than replay a whole device when the base is unreadable', () => {
    // "Everything is an edit" would push this device's defaults over the
    // account — the overwrite the gate exists to prevent.
    expect(heldEditsSince('{not json', { theme: 'fire', gyms: [] })).toEqual([])
    expect(heldEditsSince('[1,2]', { theme: 'fire' })).toEqual([])
    expect(heldEditsSince('"eternal"', { theme: 'fire' })).toEqual([])
  })
})

describe('replayHeldEdits', () => {
  const remote = {
    theme: 'water',
    gyms: ['Home', 'Iron Works'],
    experience: { haptics: false, prCelebrations: false, screenWakeLock: true },
  }

  it('keeps every field the user did not touch, and replaces only what they did', () => {
    const local = {
      theme: 'fire',
      gyms: [],
      experience: { haptics: true, prCelebrations: true, screenWakeLock: false },
    }
    expect(replayHeldEdits(remote, local, [['theme'], ['experience', 'screenWakeLock']])).toEqual({
      theme: 'fire',
      gyms: ['Home', 'Iron Works'],
      experience: { haptics: false, prCelebrations: false, screenWakeLock: false },
    })
  })

  it('takes the local subtree whole where the account has nothing to descend into', () => {
    const local = { coachProfile: { age: 31, competition: { sport: 'powerlifting' } } }
    expect(replayHeldEdits({ theme: 'water' }, local, [['coachProfile', 'competition', 'sport']])).toEqual({
      theme: 'water',
      coachProfile: { age: 31, competition: { sport: 'powerlifting' } },
    })
    // A malformed remote value at that level is replaced the same way.
    expect(replayHeldEdits({ coachProfile: 'garbage' }, local, [['coachProfile', 'age']])).toEqual({
      coachProfile: { age: 31, competition: { sport: 'powerlifting' } },
    })
  })

  it('removes a key the user removed', () => {
    expect(replayHeldEdits({ a: 1, b: 2 }, { a: 1 }, [['b']])).toEqual({ a: 1 })
  })

  it('mutates neither input', () => {
    const local = { theme: 'fire', gyms: ['Garage'], experience: { haptics: true } }
    const remoteCopy = structuredClone(remote)
    const localCopy = structuredClone(local)
    const merged = replayHeldEdits(remote, local, [['gyms'], ['experience', 'haptics']])
    ;(merged.gyms as string[]).push('mutated')
    expect(remote).toEqual(remoteCopy)
    expect(local).toEqual(localCopy)
  })
})
