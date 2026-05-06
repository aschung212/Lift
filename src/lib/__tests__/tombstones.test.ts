import { describe, it, expect, beforeEach } from 'vitest'
import {
  addTombstone,
  removeTombstone,
  isTombstoned,
  cleanupTombstones,
  _resetTombstones,
} from '../tombstones'

import { getLocalStorageMock } from '../../__tests__/helpers'
const localStorageMock = getLocalStorageMock()

describe('tombstones', () => {
  beforeEach(() => {
    localStorageMock.clear()
    _resetTombstones()
  })

  describe('addTombstone', () => {
    it('marks an ID as tombstoned', () => {
      addTombstone('exercises', 'ex-1')
      expect(isTombstoned('exercises', 'ex-1')).toBe(true)
    })

    it('persists to localStorage', () => {
      addTombstone('exercises', 'ex-1')
      const stored = JSON.parse(localStorageMock.getItem('lift-sync-tombstones')!)
      expect(stored.exercises).toContain('ex-1')
    })

    it('does not affect other stores', () => {
      addTombstone('exercises', 'ex-1')
      expect(isTombstoned('sets', 'ex-1')).toBe(false)
    })

    it('handles multiple IDs in same store', () => {
      addTombstone('exercises', 'ex-1')
      addTombstone('exercises', 'ex-2')
      expect(isTombstoned('exercises', 'ex-1')).toBe(true)
      expect(isTombstoned('exercises', 'ex-2')).toBe(true)
    })

    it('is idempotent — adding the same ID twice does not create duplicates', () => {
      addTombstone('exercises', 'ex-1')
      addTombstone('exercises', 'ex-1')
      const stored = JSON.parse(localStorageMock.getItem('lift-sync-tombstones')!)
      expect(stored.exercises.length).toBe(1)
    })
  })

  describe('removeTombstone', () => {
    it('removes a previously added tombstone', () => {
      addTombstone('exercises', 'ex-1')
      removeTombstone('exercises', 'ex-1')
      expect(isTombstoned('exercises', 'ex-1')).toBe(false)
    })

    it('does not throw when removing a non-existent ID', () => {
      expect(() => removeTombstone('exercises', 'non-existent')).not.toThrow()
    })

    it('cleans up the store key when all IDs are removed', () => {
      addTombstone('exercises', 'ex-1')
      removeTombstone('exercises', 'ex-1')
      const stored = JSON.parse(localStorageMock.getItem('lift-sync-tombstones')!)
      expect(stored.exercises).toBeUndefined()
    })

    it('does not affect other IDs in the same store', () => {
      addTombstone('exercises', 'ex-1')
      addTombstone('exercises', 'ex-2')
      removeTombstone('exercises', 'ex-1')
      expect(isTombstoned('exercises', 'ex-1')).toBe(false)
      expect(isTombstoned('exercises', 'ex-2')).toBe(true)
    })
  })

  describe('isTombstoned', () => {
    it('returns false for an ID that was never tombstoned', () => {
      expect(isTombstoned('exercises', 'ex-1')).toBe(false)
    })

    it('returns false for an empty store name', () => {
      expect(isTombstoned('nonexistent-store', 'id-1')).toBe(false)
    })

    it('reads from localStorage on first access after reset', () => {
      // Simulate data from a previous session
      localStorageMock.setItem(
        'lift-sync-tombstones',
        JSON.stringify({ exercises: ['ex-old'] })
      )
      _resetTombstones() // Clear in-memory cache
      expect(isTombstoned('exercises', 'ex-old')).toBe(true)
    })
  })

  describe('cleanupTombstones', () => {
    it('removes tombstones for IDs no longer in remote', () => {
      addTombstone('exercises', 'ex-1')
      addTombstone('exercises', 'ex-2')
      addTombstone('exercises', 'ex-3')

      // ex-2 is still on remote — it should NOT be cleaned up
      // ex-1 and ex-3 are not on remote — they SHOULD be cleaned up
      const remoteIds = new Set(['ex-2'])
      cleanupTombstones('exercises', remoteIds)

      expect(isTombstoned('exercises', 'ex-1')).toBe(false)
      expect(isTombstoned('exercises', 'ex-2')).toBe(true)
      expect(isTombstoned('exercises', 'ex-3')).toBe(false)
    })

    it('does nothing when there are no tombstones', () => {
      cleanupTombstones('exercises', new Set(['ex-1']))
      const stored = localStorageMock.getItem('lift-sync-tombstones')
      // Should not write to localStorage if there's nothing to clean
      expect(stored).toBeNull()
    })

    it('does not affect tombstones in other stores', () => {
      addTombstone('exercises', 'ex-1')
      addTombstone('sets', 'set-1')

      cleanupTombstones('exercises', new Set()) // remove all exercise tombstones
      expect(isTombstoned('sets', 'set-1')).toBe(true)
    })

    it('persists cleanup to localStorage', () => {
      addTombstone('exercises', 'ex-1')
      addTombstone('exercises', 'ex-2')
      cleanupTombstones('exercises', new Set(['ex-1'])) // ex-1 still remote

      _resetTombstones() // Force reload from localStorage
      expect(isTombstoned('exercises', 'ex-1')).toBe(true)
      expect(isTombstoned('exercises', 'ex-2')).toBe(false)
    })
  })

  describe('cross-store isolation', () => {
    it('tombstones in different stores are independent', () => {
      addTombstone('exercises', 'shared-id')
      addTombstone('sets', 'shared-id')

      removeTombstone('exercises', 'shared-id')
      expect(isTombstoned('exercises', 'shared-id')).toBe(false)
      expect(isTombstoned('sets', 'shared-id')).toBe(true)
    })
  })

  describe('resilience', () => {
    it('handles corrupt localStorage gracefully', () => {
      localStorageMock.setItem('lift-sync-tombstones', 'not-valid-json{{{')
      _resetTombstones()
      // Should not throw; should treat as empty
      expect(isTombstoned('exercises', 'anything')).toBe(false)
      // Should still be able to add new tombstones
      addTombstone('exercises', 'ex-1')
      expect(isTombstoned('exercises', 'ex-1')).toBe(true)
    })
  })
})
