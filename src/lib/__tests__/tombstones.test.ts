import { describe, it, expect, beforeEach } from 'vitest'
import {
  addTombstone,
  removeTombstone,
  isTombstoned,
  cleanupTombstones,
  _resetCache,
} from '../tombstones'

const STORAGE_KEY = 'lift-sync-tombstones'

describe('tombstones', () => {
  beforeEach(() => {
    localStorage.clear()
    _resetCache()
  })

  // ── addTombstone / isTombstoned ─────────────────────────────────

  describe('addTombstone + isTombstoned', () => {
    it('marks an entity as tombstoned', () => {
      addTombstone('exercises', 'ex-1')
      expect(isTombstoned('exercises', 'ex-1')).toBe(true)
    })

    it('returns false for non-tombstoned entities', () => {
      expect(isTombstoned('exercises', 'ex-999')).toBe(false)
    })

    it('persists tombstones to localStorage', () => {
      addTombstone('sets', 's-1')
      const raw = localStorage.getItem(STORAGE_KEY)
      expect(raw).toBeTruthy()
      const data = JSON.parse(raw!)
      expect(data.sets).toContain('s-1')
    })

    it('handles multiple tombstones in the same store', () => {
      addTombstone('exercises', 'ex-1')
      addTombstone('exercises', 'ex-2')
      addTombstone('exercises', 'ex-3')
      expect(isTombstoned('exercises', 'ex-1')).toBe(true)
      expect(isTombstoned('exercises', 'ex-2')).toBe(true)
      expect(isTombstoned('exercises', 'ex-3')).toBe(true)
    })

    it('does not duplicate when adding the same id twice', () => {
      addTombstone('exercises', 'ex-1')
      addTombstone('exercises', 'ex-1')
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
      // Set ensures uniqueness — array should have exactly 1 entry
      expect(raw.exercises.filter((id: string) => id === 'ex-1')).toHaveLength(1)
    })
  })

  // ── Store isolation ─────────────────────────────────────────────

  describe('store isolation', () => {
    it('tombstones in one store do not affect another', () => {
      addTombstone('exercises', 'shared-id')
      expect(isTombstoned('exercises', 'shared-id')).toBe(true)
      expect(isTombstoned('sets', 'shared-id')).toBe(false)
    })

    it('removing from one store does not affect another', () => {
      addTombstone('exercises', 'shared-id')
      addTombstone('sets', 'shared-id')
      removeTombstone('exercises', 'shared-id')
      expect(isTombstoned('exercises', 'shared-id')).toBe(false)
      expect(isTombstoned('sets', 'shared-id')).toBe(true)
    })
  })

  // ── removeTombstone ─────────────────────────────────────────────

  describe('removeTombstone', () => {
    it('removes a previously added tombstone', () => {
      addTombstone('exercises', 'ex-1')
      expect(isTombstoned('exercises', 'ex-1')).toBe(true)
      removeTombstone('exercises', 'ex-1')
      expect(isTombstoned('exercises', 'ex-1')).toBe(false)
    })

    it('is a no-op for non-existent tombstones', () => {
      // Should not throw
      removeTombstone('exercises', 'non-existent')
      expect(isTombstoned('exercises', 'non-existent')).toBe(false)
    })

    it('removes only the specified tombstone, not others', () => {
      addTombstone('exercises', 'ex-1')
      addTombstone('exercises', 'ex-2')
      removeTombstone('exercises', 'ex-1')
      expect(isTombstoned('exercises', 'ex-1')).toBe(false)
      expect(isTombstoned('exercises', 'ex-2')).toBe(true)
    })

    it('cleans up store key from localStorage when last tombstone is removed', () => {
      addTombstone('exercises', 'ex-1')
      removeTombstone('exercises', 'ex-1')
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
      // Store key should be deleted (not left as empty array)
      expect(raw.exercises).toBeUndefined()
    })
  })

  // ── cleanupTombstones ───────────────────────────────────────────

  describe('cleanupTombstones', () => {
    it('removes tombstones for ids no longer in remote', () => {
      addTombstone('exercises', 'ex-1')
      addTombstone('exercises', 'ex-2')
      addTombstone('exercises', 'ex-3')

      // ex-2 still exists remotely, ex-1 and ex-3 do not
      const remoteIds = new Set(['ex-2'])
      cleanupTombstones('exercises', remoteIds)

      // ex-1 and ex-3 should be cleaned up (remote no longer has them)
      expect(isTombstoned('exercises', 'ex-1')).toBe(false)
      expect(isTombstoned('exercises', 'ex-3')).toBe(false)
      // ex-2 should remain (still in remote, so tombstone is needed)
      expect(isTombstoned('exercises', 'ex-2')).toBe(true)
    })

    it('is a no-op when there are no tombstones', () => {
      cleanupTombstones('exercises', new Set(['ex-1']))
      expect(isTombstoned('exercises', 'ex-1')).toBe(false)
    })

    it('does not affect tombstones in other stores', () => {
      addTombstone('exercises', 'shared-id')
      addTombstone('sets', 'shared-id')

      // Cleanup exercises only — remote has no ids, so all should be cleaned
      cleanupTombstones('exercises', new Set())

      expect(isTombstoned('exercises', 'shared-id')).toBe(false)
      expect(isTombstoned('sets', 'shared-id')).toBe(true)
    })

    it('keeps all tombstones when all ids exist in remote', () => {
      addTombstone('exercises', 'ex-1')
      addTombstone('exercises', 'ex-2')

      cleanupTombstones('exercises', new Set(['ex-1', 'ex-2', 'ex-3']))

      expect(isTombstoned('exercises', 'ex-1')).toBe(true)
      expect(isTombstoned('exercises', 'ex-2')).toBe(true)
    })
  })

  // ── Edge cases ──────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles empty string store name', () => {
      addTombstone('', 'id-1')
      expect(isTombstoned('', 'id-1')).toBe(true)
      removeTombstone('', 'id-1')
      expect(isTombstoned('', 'id-1')).toBe(false)
    })

    it('handles empty string entity id', () => {
      addTombstone('exercises', '')
      expect(isTombstoned('exercises', '')).toBe(true)
    })

    it('recovers gracefully from corrupt localStorage data', () => {
      localStorage.setItem(STORAGE_KEY, 'not-valid-json!!!')
      _resetCache()
      // Should not throw — falls back to empty state
      expect(isTombstoned('exercises', 'ex-1')).toBe(false)
      // Should still work after recovery
      addTombstone('exercises', 'ex-1')
      expect(isTombstoned('exercises', 'ex-1')).toBe(true)
    })

    it('works when localStorage key is missing entirely', () => {
      localStorage.clear()
      _resetCache()
      expect(isTombstoned('exercises', 'ex-1')).toBe(false)
      addTombstone('exercises', 'ex-1')
      expect(isTombstoned('exercises', 'ex-1')).toBe(true)
    })
  })
})
