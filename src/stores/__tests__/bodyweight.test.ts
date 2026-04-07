import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useBodyweightStore } from '../bodyweight'
import { getLocalStorageMock } from '../../__tests__/helpers'

vi.mock('../../lib/uuid', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return { ...actual, uuid: () => 'bw-uuid-' + Math.random().toString(36).slice(2, 8) }
})

const localStorageMock = getLocalStorageMock()

describe('useBodyweightStore', () => {
  let store: ReturnType<typeof useBodyweightStore>

  beforeEach(() => {
    localStorageMock.clear()
    setActivePinia(createPinia())
    store = useBodyweightStore()
    store.entries = []
  })

  describe('addEntry', () => {
    it('adds a weight entry with date', () => {
      const id = store.addEntry(180, '2024-03-15')
      expect(id).toBeTruthy()
      expect(store.entries).toHaveLength(1)
      expect(store.entries[0].weight).toBe(180)
      expect(store.entries[0].date).toContain('2024-03-15')
    })

    it('adds multiple entries', () => {
      store.addEntry(180, '2024-03-15')
      store.addEntry(179.5, '2024-03-16')
      store.addEntry(178, '2024-03-17')
      expect(store.entries).toHaveLength(3)
    })
  })

  describe('minWeight / maxWeight', () => {
    it('returns the minimum weight across all entries', () => {
      store.addEntry(185, '2024-01-01')
      store.addEntry(178, '2024-02-01')
      store.addEntry(182, '2024-03-01')
      expect(store.minWeight).toBe(178)
    })

    it('returns the maximum weight across all entries', () => {
      store.addEntry(185, '2024-01-01')
      store.addEntry(178, '2024-02-01')
      store.addEntry(182, '2024-03-01')
      expect(store.maxWeight).toBe(185)
    })

    it('returns null when no entries exist', () => {
      expect(store.minWeight).toBeNull()
      expect(store.maxWeight).toBeNull()
    })
  })

  describe('sortedEntries', () => {
    it('returns entries sorted by date ascending', () => {
      store.addEntry(180, '2024-03-15')
      store.addEntry(175, '2024-01-10')
      store.addEntry(178, '2024-02-20')

      const sorted = store.sortedEntries
      expect(sorted[0].weight).toBe(175)
      expect(sorted[1].weight).toBe(178)
      expect(sorted[2].weight).toBe(180)
    })
  })

  describe('latestWeight', () => {
    it('returns the most recent weight by date', () => {
      store.addEntry(180, '2024-01-01')
      store.addEntry(175, '2024-06-01')
      store.addEntry(178, '2024-03-01')
      expect(store.latestWeight).toBe(175)
    })

    it('returns null when no entries exist', () => {
      expect(store.latestWeight).toBeNull()
    })
  })

  describe('period filtering (sortedEntries with date ranges)', () => {
    beforeEach(() => {
      const now = new Date()
      const dates = [
        { daysAgo: 3, weight: 180 },
        { daysAgo: 15, weight: 179 },
        { daysAgo: 60, weight: 177 },
        { daysAgo: 200, weight: 185 },
        { daysAgo: 400, weight: 190 },
      ]
      dates.forEach(({ daysAgo, weight }) => {
        const d = new Date(now)
        d.setDate(d.getDate() - daysAgo)
        const dateStr = d.toISOString().slice(0, 10)
        store.addEntry(weight, dateStr)
      })
    })

    it('filters entries within the last 7 days', () => {
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - 7)
      const filtered = store.sortedEntries.filter(e => new Date(e.date) >= cutoff)
      expect(filtered).toHaveLength(1)
      expect(filtered[0].weight).toBe(180)
    })

    it('filters entries within the last 30 days', () => {
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - 30)
      const filtered = store.sortedEntries.filter(e => new Date(e.date) >= cutoff)
      expect(filtered).toHaveLength(2)
    })

    it('filters entries within the last 90 days', () => {
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - 90)
      const filtered = store.sortedEntries.filter(e => new Date(e.date) >= cutoff)
      expect(filtered).toHaveLength(3)
    })

    it('filters entries within the last year', () => {
      const cutoff = new Date()
      cutoff.setFullYear(cutoff.getFullYear() - 1)
      const filtered = store.sortedEntries.filter(e => new Date(e.date) >= cutoff)
      expect(filtered).toHaveLength(4)
    })
  })

  describe('deleteEntry', () => {
    it('removes a specific entry by id', () => {
      store.addEntry(180, '2024-01-01')
      const id = store.addEntry(175, '2024-01-02')
      store.addEntry(178, '2024-01-03')

      store.deleteEntry(id)
      expect(store.entries).toHaveLength(2)
      expect(store.entries.find(e => e.id === id)).toBeUndefined()
    })
  })

  describe('updateEntry', () => {
    it('updates weight and date of an existing entry', () => {
      const id = store.addEntry(180, '2024-01-01')
      store.updateEntry(id, 175, '2024-01-02')

      const entry = store.entries.find(e => e.id === id)
      expect(entry!.weight).toBe(175)
      expect(entry!.date).toContain('2024-01-02')
    })
  })

  describe('clearAll', () => {
    it('removes all entries', () => {
      store.addEntry(180, '2024-01-01')
      store.addEntry(175, '2024-01-02')
      store.clearAll()
      expect(store.entries).toHaveLength(0)
    })
  })

  describe('restoreEntry', () => {
    it('restores a previously deleted entry', () => {
      const id = store.addEntry(180, '2024-01-15')
      const entry = { ...store.entries[0] }
      store.deleteEntry(id)
      expect(store.entries).toHaveLength(0)

      store.restoreEntry(entry)
      expect(store.entries).toHaveLength(1)
      expect(store.entries[0].weight).toBe(180)
      expect(store.entries[0].id).toBe(id)
    })

    it('persists restored entry to localStorage', () => {
      const id = store.addEntry(180, '2024-01-15')
      const entry = { ...store.entries[0] }
      store.deleteEntry(id)
      store.restoreEntry(entry)

      const stored = JSON.parse(localStorage.getItem('bodyweight-entries')!)
      expect(stored).toHaveLength(1)
      expect(stored[0].id).toBe(id)
    })
  })

  describe('addEntry edge cases', () => {
    it('uses current date when no dateStr provided', () => {
      const today = new Date().toISOString().slice(0, 10)
      store.addEntry(180)
      expect(store.entries[0].date).toContain(today)
    })

    it('generates unique ids for each entry', () => {
      store.addEntry(180, '2024-01-01')
      store.addEntry(175, '2024-01-02')
      expect(store.entries[0].id).not.toBe(store.entries[1].id)
    })
  })

  describe('updateEntry edge cases', () => {
    it('does nothing for non-existent id', () => {
      store.addEntry(180, '2024-01-01')
      store.updateEntry('non-existent', 999)
      expect(store.entries[0].weight).toBe(180)
    })

    it('updates weight without changing date when dateStr omitted', () => {
      const id = store.addEntry(180, '2024-01-01')
      const originalDate = store.entries[0].date
      store.updateEntry(id, 175)
      expect(store.entries[0].weight).toBe(175)
      expect(store.entries[0].date).toBe(originalDate)
    })
  })

  describe('persistence', () => {
    it('persists entries to localStorage', () => {
      store.addEntry(180, '2024-01-15')
      const stored = JSON.parse(localStorage.getItem('bodyweight-entries')!)
      expect(stored).toHaveLength(1)
      expect(stored[0].weight).toBe(180)
    })

    it('loads persisted entries on store creation', () => {
      const entries = [
        { id: 'test-1', date: '2024-01-01T12:00:00.000Z', weight: 180 },
        { id: 'test-2', date: '2024-01-02T12:00:00.000Z', weight: 178 }
      ]
      localStorageMock.setItem('bodyweight-entries', JSON.stringify(entries))

      setActivePinia(createPinia())
      const freshStore = useBodyweightStore()
      expect(freshStore.entries).toHaveLength(2)
      expect(freshStore.entries[0].weight).toBe(180)
    })

    it('handles corrupt localStorage gracefully', () => {
      localStorageMock.setItem('bodyweight-entries', 'not-json')

      setActivePinia(createPinia())
      const freshStore = useBodyweightStore()
      expect(freshStore.entries).toEqual([])
    })

    it('handles empty localStorage', () => {
      setActivePinia(createPinia())
      const freshStore = useBodyweightStore()
      expect(freshStore.entries).toEqual([])
    })
  })

  describe('deleteEntry with sync disabled', () => {
    it('deletes locally without sync when sync: false', () => {
      const id = store.addEntry(180, '2024-01-01')
      store.deleteEntry(id, { sync: false })
      expect(store.entries).toHaveLength(0)
    })
  })
})
