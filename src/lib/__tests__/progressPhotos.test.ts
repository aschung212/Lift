/**
 * Tests for progressPhotos.ts (LIFT-1108) — the local-first progress-photo
 * storage layer. Pure helpers are tested directly; the IndexedDB blob layer is
 * exercised against a real (in-memory) IndexedDB via `fake-indexeddb`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import {
  parsePhotoMetaList,
  sortPhotosByDate,
  selectComparePair,
  isSupportedPhoto,
  MAX_PHOTO_BYTES,
  type PhotoMeta,
} from '../progressPhotos'

function meta(id: string, date: string, createdAt = `${date}T08:00:00.000Z`): PhotoMeta {
  return { id, date, createdAt }
}

describe('progressPhotos pure helpers', () => {
  describe('parsePhotoMetaList', () => {
    it('returns [] for non-array input', () => {
      expect(parsePhotoMetaList(null)).toEqual([])
      expect(parsePhotoMetaList('nope')).toEqual([])
      expect(parsePhotoMetaList({})).toEqual([])
    })

    it('keeps valid entries and preserves an optional note', () => {
      const raw = [
        { id: 'a', date: '2026-01-01', createdAt: '2026-01-01T08:00:00Z', note: 'start' },
        { id: 'b', date: '2026-02-01', createdAt: '2026-02-01T08:00:00Z' },
      ]
      expect(parsePhotoMetaList(raw)).toEqual(raw)
    })

    it('drops entries missing id/date/createdAt', () => {
      const raw = [
        { id: '', date: '2026-01-01', createdAt: '2026-01-01T08:00:00Z' },
        { id: 'b', date: '', createdAt: '2026-02-01T08:00:00Z' },
        { id: 'c', date: '2026-03-01' }, // no createdAt
        { id: 'd', date: '2026-04-01', createdAt: '2026-04-01T08:00:00Z' },
      ]
      expect(parsePhotoMetaList(raw).map(p => p.id)).toEqual(['d'])
    })

    it('drops entries with a non-string note rather than coercing it', () => {
      const raw = [{ id: 'a', date: '2026-01-01', createdAt: '2026-01-01T08:00:00Z', note: 42 }]
      expect(parsePhotoMetaList(raw)).toEqual([])
    })
  })

  describe('sortPhotosByDate', () => {
    const photos = [meta('a', '2026-01-01'), meta('c', '2026-03-01'), meta('b', '2026-02-01')]

    it('defaults to newest-first', () => {
      expect(sortPhotosByDate(photos).map(p => p.id)).toEqual(['c', 'b', 'a'])
    })

    it('sorts ascending when asked', () => {
      expect(sortPhotosByDate(photos, 'asc').map(p => p.id)).toEqual(['a', 'b', 'c'])
    })

    it('breaks same-date ties by createdAt', () => {
      const same = [
        meta('x', '2026-01-01', '2026-01-01T10:00:00Z'),
        meta('y', '2026-01-01', '2026-01-01T08:00:00Z'),
      ]
      expect(sortPhotosByDate(same, 'asc').map(p => p.id)).toEqual(['y', 'x'])
      expect(sortPhotosByDate(same, 'desc').map(p => p.id)).toEqual(['x', 'y'])
    })

    it('does not mutate the input array', () => {
      const input = [...photos]
      sortPhotosByDate(input)
      expect(input.map(p => p.id)).toEqual(['a', 'c', 'b'])
    })
  })

  describe('selectComparePair', () => {
    it('returns null with fewer than two photos', () => {
      expect(selectComparePair([])).toBeNull()
      expect(selectComparePair([meta('a', '2026-01-01')])).toBeNull()
    })

    it('picks the earliest as before and the latest as after', () => {
      const photos = [meta('b', '2026-02-01'), meta('a', '2026-01-01'), meta('c', '2026-03-01')]
      const pair = selectComparePair(photos)
      expect(pair?.before.id).toBe('a')
      expect(pair?.after.id).toBe('c')
    })
  })

  describe('isSupportedPhoto', () => {
    it('accepts image types within the size limit', () => {
      expect(isSupportedPhoto({ type: 'image/jpeg', size: 1024 })).toBe(true)
      expect(isSupportedPhoto({ type: 'image/png', size: 1 })).toBe(true)
      expect(isSupportedPhoto({ type: 'image/heic', size: 5_000_000 })).toBe(true)
    })

    it('rejects non-images, empty files, and over-limit files', () => {
      expect(isSupportedPhoto(null)).toBe(false)
      expect(isSupportedPhoto({ type: 'application/pdf', size: 10 })).toBe(false)
      expect(isSupportedPhoto({ type: 'image/png', size: 0 })).toBe(false)
      expect(isSupportedPhoto({ type: 'image/png', size: MAX_PHOTO_BYTES + 1 })).toBe(false)
    })

    it('accepts an image with no known size (type is sufficient)', () => {
      expect(isSupportedPhoto({ type: 'image/webp' })).toBe(true)
    })
  })
})

describe('progressPhotos IndexedDB blob layer', () => {
  let mod: typeof import('../progressPhotos')

  beforeEach(async () => {
    vi.resetModules()
    vi.stubGlobal('indexedDB', new IDBFactory())
    mod = await import('../progressPhotos')
  })

  it('round-trips a stored value through IndexedDB', async () => {
    // fake-indexeddb's structured clone does not preserve Blob bytes (it returns
    // a plain object carrying the `type`), so we assert the key/value plumbing —
    // put → get returns the stored value for the right key — rather than the
    // byte content. Real WKWebView/Safari IndexedDB persists Blobs faithfully.
    const blob = new Blob(['hello'], { type: 'image/png' })
    await mod.putPhotoBlob('p1', blob)
    const out = await mod.getPhotoBlob('p1')
    expect(out).not.toBeNull()
    expect((out as Blob).type).toBe('image/png')
  })

  it('returns null for an unknown id', async () => {
    expect(await mod.getPhotoBlob('missing')).toBeNull()
  })

  it('deletes a single blob without touching others', async () => {
    await mod.putPhotoBlob('a', new Blob(['a']))
    await mod.putPhotoBlob('b', new Blob(['b']))
    await mod.deletePhotoBlob('a')
    expect(await mod.getPhotoBlob('a')).toBeNull()
    expect(await mod.getPhotoBlob('b')).not.toBeNull()
  })

  it('clears all blobs', async () => {
    await mod.putPhotoBlob('a', new Blob(['a']))
    await mod.putPhotoBlob('b', new Blob(['b']))
    await mod.clearAllPhotoBlobs()
    expect(await mod.getPhotoBlob('a')).toBeNull()
    expect(await mod.getPhotoBlob('b')).toBeNull()
  })

  it('degrades gracefully when IndexedDB is unavailable', async () => {
    vi.resetModules()
    vi.stubGlobal('indexedDB', undefined)
    const noIdb = await import('../progressPhotos')
    await expect(noIdb.putPhotoBlob('a', new Blob(['a']))).rejects.toThrow()
    expect(await noIdb.getPhotoBlob('a')).toBeNull()
    await expect(noIdb.deletePhotoBlob('a')).resolves.toBeUndefined()
    await expect(noIdb.clearAllPhotoBlobs()).resolves.toBeUndefined()
  })
})
