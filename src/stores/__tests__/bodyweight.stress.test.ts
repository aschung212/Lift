/**
 * Load & stress tests for the bodyweight store.
 *
 * Validates sorting, min/max getters, and rapid entry logging
 * remain performant with years of daily bodyweight data.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'

const localStorageMock = getLocalStorageMock()

vi.mock('../../lib/syncQueue', () => ({
  syncQueue: { enqueue: vi.fn() }
}))

import { useBodyweightStore } from '../bodyweight'
import type { BodyweightEntry } from '../bodyweight'

// ── Helpers ──────────────────────────────────────────────────────

function makeEntries(count: number): BodyweightEntry[] {
  const entries: BodyweightEntry[] = []
  const baseDate = new Date('2024-01-01T12:00:00.000Z')
  for (let i = 0; i < count; i++) {
    const date = new Date(baseDate.getTime() + i * 86400000)
    entries.push({
      id: `bw-${i}`,
      date: date.toISOString(),
      weight: 170 + Math.sin(i / 30) * 10, // oscillating weight
    })
  }
  return entries
}

function measure(fn: () => void): number {
  const start = performance.now()
  fn()
  return performance.now() - start
}

// ── Tests ────────────────────────────────────────────────────────

describe('bodyweight store — load & stress tests', () => {
  beforeEach(() => {
    localStorageMock.clear()
    setActivePinia(createPinia())
  })

  describe('large dataset initialization', () => {
    it('loads 2 years of daily entries (730) from localStorage under 50ms', () => {
      const entries = makeEntries(730)
      localStorageMock.setItem('bodyweight-entries', JSON.stringify(entries))

      const elapsed = measure(() => {
        setActivePinia(createPinia())
        const store = useBodyweightStore()
        expect(store.entries.length).toBe(730)
      })

      expect(elapsed).toBeLessThan(50)
    })
  })

  describe('getter performance', () => {
    it('sortedEntries with 1000 entries completes under 10ms', () => {
      const store = useBodyweightStore()
      store.$patch({ entries: makeEntries(1000) })

      const elapsed = measure(() => {
        const sorted = store.sortedEntries
        expect(sorted).toHaveLength(1000)
        // Verify sorted order
        for (let i = 1; i < sorted.length; i++) {
          expect(sorted[i].date >= sorted[i - 1].date).toBe(true)
        }
      })

      expect(elapsed).toBeLessThan(30)
    })

    it('latestWeight with 1000 entries completes under 5ms', () => {
      const store = useBodyweightStore()
      store.$patch({ entries: makeEntries(1000) })

      const elapsed = measure(() => {
        const latest = store.latestWeight
        expect(latest).not.toBeNull()
      })

      expect(elapsed).toBeLessThan(5)
    })

    it('min/maxWeight with 1000 entries completes under 5ms', () => {
      const store = useBodyweightStore()
      store.$patch({ entries: makeEntries(1000) })

      const elapsed = measure(() => {
        const min = store.minWeight
        const max = store.maxWeight
        expect(min).not.toBeNull()
        expect(max).not.toBeNull()
        expect(max!).toBeGreaterThan(min!)
      })

      expect(elapsed).toBeLessThan(5)
    })
  })

  describe('rapid entry logging', () => {
    it('logs 365 daily entries in rapid succession under 200ms', () => {
      const store = useBodyweightStore()

      const elapsed = measure(() => {
        for (let i = 0; i < 365; i++) {
          const month = String(Math.floor(i / 28) % 12 + 1).padStart(2, '0')
          const day = String((i % 28) + 1).padStart(2, '0')
          store.addEntry(170 + Math.random() * 10, `2026-${month}-${day}`, { sync: false })
        }
      })

      expect(store.entries).toHaveLength(365)
      // Each addEntry calls _persist() with full serialization
      expect(elapsed).toBeLessThan(500)
    })
  })

  describe('deletion at scale', () => {
    it('deletes 100 entries from a store of 1000 under 200ms', () => {
      const store = useBodyweightStore()
      store.$patch({ entries: makeEntries(1000) })
      const toDelete = store.entries.slice(0, 100).map(e => e.id)

      const elapsed = measure(() => {
        for (const id of toDelete) {
          store.deleteEntry(id, { sync: false })
        }
      })

      expect(store.entries).toHaveLength(900)
      // Each deletion calls _persist() with full serialization
      expect(elapsed).toBeLessThan(500)
    })
  })
})
