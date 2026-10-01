import { describe, it, expect } from 'vitest'
import { chunkUniformRows, BULK_UPSERT_CHUNK } from '../bulkUpsert'

describe('chunkUniformRows (LIFT-1526)', () => {
  it('never puts rows with different columns in the same request', () => {
    // The two shapes the producers really emit: `created_at` is omitted for a
    // legacy set, and a multi-row upsert would write NULL there (NOT NULL).
    const withTime = (id: string) => ({ id, weight: 135, created_at: '2026-09-30T18:00:00.000Z' })
    const legacy = (id: string) => ({ id, weight: 135 })
    const chunks = chunkUniformRows([withTime('a'), legacy('b'), withTime('c'), legacy('d')])

    expect(chunks.map(c => c.map(r => r.id))).toEqual([['a', 'c'], ['b', 'd']])
    for (const chunk of chunks) {
      const signatures = new Set(chunk.map(r => Object.keys(r).sort().join(',')))
      expect(signatures.size).toBe(1)
    }
  })

  it('groups by the set of keys, not their order', () => {
    // postgrest-js builds `columns` from the keys alone, so these are one shape.
    const chunks = chunkUniformRows([{ a: 1, b: 2 }, { b: 3, a: 4 }])
    expect(chunks).toEqual([[{ a: 1, b: 2 }, { b: 3, a: 4 }]])
  })

  it('caps every request at the chunk size and loses no row', () => {
    const rows = Array.from({ length: BULK_UPSERT_CHUNK * 2 + 37 }, (_, i) => ({ id: `s-${i}` }))
    const chunks = chunkUniformRows(rows)

    expect(chunks.map(c => c.length)).toEqual([BULK_UPSERT_CHUNK, BULK_UPSERT_CHUNK, 37])
    expect(chunks.flat()).toEqual(rows)
  })

  it('returns no chunks for no rows', () => {
    expect(chunkUniformRows([])).toEqual([])
  })

  it('rejects a chunk size that could never make progress', () => {
    expect(() => chunkUniformRows([{ id: 'a' }], 0)).toThrow(RangeError)
    expect(() => chunkUniformRows([{ id: 'a' }], 1.5)).toThrow(RangeError)
  })
})
