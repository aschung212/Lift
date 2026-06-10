import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useBodyMeasurementsStore, MEASUREMENT_TYPES, isMeasurementType } from '../bodyMeasurements'
import { getLocalStorageMock } from '../../__tests__/helpers'

vi.mock('../../lib/uuid', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return { ...actual, uuid: () => 'bm-uuid-' + Math.random().toString(36).slice(2, 8) }
})

const localStorageMock = getLocalStorageMock()

describe('useBodyMeasurementsStore', () => {
  let store: ReturnType<typeof useBodyMeasurementsStore>

  beforeEach(() => {
    localStorageMock.clear()
    setActivePinia(createPinia())
    store = useBodyMeasurementsStore()
    store.entries = []
  })

  describe('isMeasurementType', () => {
    it('accepts known types and rejects unknown', () => {
      expect(isMeasurementType('chest')).toBe(true)
      expect(isMeasurementType('arms')).toBe(true)
      expect(isMeasurementType('biceps')).toBe(false)
      expect(isMeasurementType('')).toBe(false)
    })

    it('exposes all four tracked body parts', () => {
      expect([...MEASUREMENT_TYPES]).toEqual(['chest', 'arms', 'waist', 'thighs'])
    })
  })

  describe('addEntry', () => {
    it('adds a measurement entry with type, value, and date', () => {
      const id = store.addEntry('chest', 100, '2024-03-15')
      expect(id).toBeTruthy()
      expect(store.entries).toHaveLength(1)
      expect(store.entries[0].type).toBe('chest')
      expect(store.entries[0].value).toBe(100)
      expect(store.entries[0].date).toContain('2024-03-15')
      expect(store.entries[0].updated_at).toBeTruthy()
    })

    it('keeps entries of different types independent', () => {
      store.addEntry('chest', 100, '2024-03-15')
      store.addEntry('arms', 38, '2024-03-15')
      store.addEntry('waist', 80, '2024-03-15')
      expect(store.entries).toHaveLength(3)
      expect(store.entriesForType('chest')).toHaveLength(1)
      expect(store.entriesForType('arms')).toHaveLength(1)
      expect(store.entriesForType('thighs')).toHaveLength(0)
    })

    it('marks sample entries when sync is disabled', () => {
      store.addEntry('chest', 100, '2024-03-15', { sync: false })
      expect(store.entries[0].sample).toBe(true)
    })
  })

  describe('entriesForType getter', () => {
    it('returns only matching type, sorted oldest first', () => {
      store.addEntry('chest', 102, '2024-03-17')
      store.addEntry('chest', 100, '2024-03-15')
      store.addEntry('arms', 38, '2024-03-16')
      const chest = store.entriesForType('chest')
      expect(chest.map(e => e.value)).toEqual([100, 102])
    })
  })

  describe('latestForType getter', () => {
    it('returns the most recent value for the type', () => {
      store.addEntry('waist', 82, '2024-01-01')
      store.addEntry('waist', 80, '2024-02-01')
      store.addEntry('waist', 78, '2024-03-01')
      expect(store.latestForType('waist')).toBe(78)
    })

    it('returns null when no entries of that type exist', () => {
      store.addEntry('chest', 100, '2024-03-15')
      expect(store.latestForType('thighs')).toBeNull()
    })
  })

  describe('trackedTypes getter', () => {
    it('returns the set of types that have entries', () => {
      store.addEntry('chest', 100, '2024-03-15')
      store.addEntry('arms', 38, '2024-03-15')
      const tracked = store.trackedTypes
      expect(tracked.has('chest')).toBe(true)
      expect(tracked.has('arms')).toBe(true)
      expect(tracked.has('waist')).toBe(false)
    })
  })

  describe('updateEntry', () => {
    it('updates the value and clears the sample flag', () => {
      const id = store.addEntry('chest', 100, '2024-03-15', { sync: false })
      store.updateEntry(id, 101)
      expect(store.entries[0].value).toBe(101)
      expect(store.entries[0].sample).toBeUndefined()
    })

    it('is a no-op for an unknown id', () => {
      store.addEntry('chest', 100, '2024-03-15')
      store.updateEntry('does-not-exist', 999)
      expect(store.entries[0].value).toBe(100)
    })
  })

  describe('deleteEntry / restoreEntry', () => {
    it('removes an entry and restores it', () => {
      const id = store.addEntry('arms', 38, '2024-03-15')
      const saved = { ...store.entries[0] }
      store.deleteEntry(id, { sync: false })
      expect(store.entries).toHaveLength(0)
      store.restoreEntry(saved)
      expect(store.entries).toHaveLength(1)
      expect(store.entries[0].id).toBe(id)
    })
  })

  describe('clearAll', () => {
    it('empties all entries', () => {
      store.addEntry('chest', 100, '2024-03-15')
      store.addEntry('arms', 38, '2024-03-15')
      store.clearAll()
      expect(store.entries).toHaveLength(0)
    })
  })

  describe('persistence', () => {
    it('persists to localStorage and reloads', () => {
      store.addEntry('chest', 100, '2024-03-15')
      const raw = localStorageMock.getItem('body-measurements')
      expect(raw).toBeTruthy()
      store.entries = []
      store._reloadFromStorage()
      expect(store.entries).toHaveLength(1)
      expect(store.entries[0].type).toBe('chest')
    })

    it('drops rows with an unknown type when loading corrupt data', () => {
      localStorageMock.setItem('body-measurements', JSON.stringify([
        { id: 'a', date: '2024-03-15T00:00:00.000Z', type: 'chest', value: 100 },
        { id: 'b', date: '2024-03-15T00:00:00.000Z', type: 'forearms', value: 30 },
      ]))
      store._reloadFromStorage()
      expect(store.entries).toHaveLength(1)
      expect(store.entries[0].type).toBe('chest')
    })

    it('falls back to empty state on malformed JSON', () => {
      localStorageMock.setItem('body-measurements', '{not json')
      store._reloadFromStorage()
      expect(store.entries).toEqual([])
    })
  })
})
