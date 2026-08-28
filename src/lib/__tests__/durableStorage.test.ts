/**
 * Tests for durableStorage.ts — the local-first data-loss safety net.
 *
 * This module mirrors every localStorage write into IndexedDB and, on
 * startup, restores from IndexedDB when localStorage has been cleared
 * (e.g. iOS Safari evicting site data). Because it is the last line of
 * defense against losing workout history, every branch is exercised
 * here against a real (in-memory) IndexedDB via `fake-indexeddb`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

// Each test gets a fresh module copy so the module-level `db` cache in
// durableStorage.ts does not leak an open connection between tests.
let mod: typeof import('../durableStorage')

const originalNavigator = globalThis.navigator

beforeEach(async () => {
  vi.resetModules()
  // A brand-new factory per test = fully isolated, empty database.
  vi.stubGlobal('indexedDB', new IDBFactory())
  localStorage.clear()
  mod = await import('../durableStorage')
})

afterEach(() => {
  vi.stubGlobal('navigator', originalNavigator)
})

describe('durableStorage', () => {
  describe('backupToIDB + restoreFromIDB', () => {
    it('round-trips a value through IndexedDB', async () => {
      mod.backupToIDB('workouts', '[{"id":"1"}]')
      await vi.waitFor(async () => {
        expect(await mod.restoreFromIDB('workouts')).toBe('[{"id":"1"}]')
      })
    })

    it('returns null for a key that was never written', async () => {
      expect(await mod.restoreFromIDB('missing')).toBeNull()
    })

    it('overwrites an existing value on repeated backup', async () => {
      mod.backupToIDB('k', 'first')
      await vi.waitFor(async () => {
        expect(await mod.restoreFromIDB('k')).toBe('first')
      })
      mod.backupToIDB('k', 'second')
      await vi.waitFor(async () => {
        expect(await mod.restoreFromIDB('k')).toBe('second')
      })
    })

    it('keeps multiple keys independent', async () => {
      mod.backupToIDB('a', '1')
      mod.backupToIDB('b', '2')
      await vi.waitFor(async () => {
        expect(await mod.restoreFromIDB('a')).toBe('1')
        expect(await mod.restoreFromIDB('b')).toBe('2')
      })
    })

    it('reuses the cached connection across calls (covers the db hit path)', async () => {
      const openSpy = vi.spyOn(indexedDB, 'open')
      // First fully-awaited read establishes and caches the connection.
      await mod.restoreFromIDB('k')
      const opensAfterFirst = openSpy.mock.calls.length
      expect(opensAfterFirst).toBeGreaterThanOrEqual(1)

      // Subsequent operations should hit the cache, not re-open the DB.
      await mod.restoreFromIDB('k')
      await mod.restoreFromIDB('other')
      expect(openSpy.mock.calls.length).toBe(opensAfterFirst)
    })
  })

  describe('clearIDB', () => {
    it('removes all backed-up data', async () => {
      mod.backupToIDB('k', 'v')
      await vi.waitFor(async () => {
        expect(await mod.restoreFromIDB('k')).toBe('v')
      })
      await mod.clearIDB()
      expect(await mod.restoreFromIDB('k')).toBeNull()
    })

    it('resolves without throwing when there is nothing to clear', async () => {
      await expect(mod.clearIDB()).resolves.toBeUndefined()
    })
  })

  describe('ensureLocalStorage', () => {
    it('returns false and re-syncs to IDB when localStorage already has data', async () => {
      localStorage.setItem('workouts', 'local-value')

      const restored = await mod.ensureLocalStorage('workouts')

      expect(restored).toBe(false)
      // localStorage is untouched...
      expect(localStorage.getItem('workouts')).toBe('local-value')
      // ...and the value is mirrored into IDB in case the backup was stale.
      await vi.waitFor(async () => {
        expect(await mod.restoreFromIDB('workouts')).toBe('local-value')
      })
    })

    it('restores from IDB and returns true when localStorage is empty', async () => {
      mod.backupToIDB('workouts', 'idb-value')
      await vi.waitFor(async () => {
        expect(await mod.restoreFromIDB('workouts')).toBe('idb-value')
      })

      const restored = await mod.ensureLocalStorage('workouts')

      expect(restored).toBe(true)
      expect(localStorage.getItem('workouts')).toBe('idb-value')
    })

    it('returns false when both localStorage and IDB are empty', async () => {
      const restored = await mod.ensureLocalStorage('workouts')

      expect(restored).toBe(false)
      expect(localStorage.getItem('workouts')).toBeNull()
    })
  })

  describe('requestPersistentStorage', () => {
    it('returns the result of navigator.storage.persist when available', async () => {
      const persist = vi.fn().mockResolvedValue(true)
      vi.stubGlobal('navigator', { storage: { persist } })

      await expect(mod.requestPersistentStorage()).resolves.toBe(true)
      expect(persist).toHaveBeenCalledOnce()
    })

    it('propagates a false result from persist (eviction not guaranteed)', async () => {
      vi.stubGlobal('navigator', { storage: { persist: vi.fn().mockResolvedValue(false) } })

      await expect(mod.requestPersistentStorage()).resolves.toBe(false)
    })

    it('returns false when the Storage API is unavailable', async () => {
      vi.stubGlobal('navigator', {})

      await expect(mod.requestPersistentStorage()).resolves.toBe(false)
    })
  })

  describe('IndexedDB unavailable (degrades silently)', () => {
    beforeEach(() => {
      // Simulate a context where IndexedDB is missing (e.g. private mode).
      vi.stubGlobal('indexedDB', undefined)
    })

    it('backupToIDB swallows the failure and does not throw', () => {
      expect(() => mod.backupToIDB('k', 'v')).not.toThrow()
    })

    it('restoreFromIDB resolves to null instead of rejecting', async () => {
      await expect(mod.restoreFromIDB('k')).resolves.toBeNull()
    })

    it('clearIDB resolves instead of rejecting', async () => {
      await expect(mod.clearIDB()).resolves.toBeUndefined()
    })

    it('ensureLocalStorage falls back to false when IDB cannot be read', async () => {
      await expect(mod.ensureLocalStorage('workouts')).resolves.toBe(false)
    })
  })

  describe('openDB error path', () => {
    it('restoreFromIDB resolves to null when opening the database errors', async () => {
      vi.stubGlobal('indexedDB', {
        open: () => {
          const request: Record<string, unknown> = { result: null, error: new Error('boom') }
          // Fire the error callback on the next microtask, mimicking IDB.
          queueMicrotask(() => {
            ;(request.onerror as () => void)?.()
          })
          return request
        },
      })

      await expect(mod.restoreFromIDB('k')).resolves.toBeNull()
    })
  })
})
