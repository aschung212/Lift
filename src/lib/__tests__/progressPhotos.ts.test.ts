/**
 * Tests for progressPhotos.ts — the IndexedDB storage layer behind the
 * progress-photos timeline (LIFT-1108). Photo blobs are too large for
 * localStorage, so both the metadata and the pixels live in a dedicated
 * `lift-photos` IndexedDB database. Every branch is exercised against a real
 * (in-memory) IndexedDB via `fake-indexeddb`, mirroring durableStorage's tests.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

let mod: typeof import('../progressPhotos')

function blobOf(text: string): Blob {
  return new Blob([text], { type: 'image/jpeg' })
}

async function blobText(blob: Blob | null): Promise<string | null> {
  return blob ? blob.text() : null
}

beforeEach(async () => {
  vi.resetModules()
  vi.stubGlobal('indexedDB', new IDBFactory())
  mod = await import('../progressPhotos')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('progressPhotos', () => {
  it('round-trips a photo record through IndexedDB', async () => {
    await mod.putProgressPhoto({
      id: 'p1',
      date: '2026-08-01',
      caption: 'week 1',
      createdAt: '2026-08-01T10:00:00.000Z',
      blob: blobOf('pixels'),
    })

    const metas = await mod.getProgressPhotoMetas()
    expect(metas).toHaveLength(1)
    expect(metas[0]).toEqual({
      id: 'p1',
      date: '2026-08-01',
      caption: 'week 1',
      createdAt: '2026-08-01T10:00:00.000Z',
    })
    // Metadata is blob-free so the reactive store never retains the pixels.
    expect('blob' in metas[0]).toBe(false)

    expect(await blobText(await mod.getProgressPhotoBlob('p1'))).toBe('pixels')
  })

  it('returns an empty list and null blob when nothing is stored', async () => {
    expect(await mod.getProgressPhotoMetas()).toEqual([])
    expect(await mod.getProgressPhotoBlob('missing')).toBeNull()
  })

  it('keeps multiple photos independent', async () => {
    await mod.putProgressPhoto({ id: 'a', date: '2026-01-01', caption: '', createdAt: '2026-01-01T00:00:00Z', blob: blobOf('A') })
    await mod.putProgressPhoto({ id: 'b', date: '2026-02-01', caption: '', createdAt: '2026-02-01T00:00:00Z', blob: blobOf('B') })

    const ids = (await mod.getProgressPhotoMetas()).map(m => m.id).sort()
    expect(ids).toEqual(['a', 'b'])
    expect(await blobText(await mod.getProgressPhotoBlob('a'))).toBe('A')
    expect(await blobText(await mod.getProgressPhotoBlob('b'))).toBe('B')
  })

  it('updates only the caption, leaving the blob intact', async () => {
    await mod.putProgressPhoto({ id: 'p1', date: '2026-08-01', caption: 'old', createdAt: '2026-08-01T00:00:00Z', blob: blobOf('pixels') })

    await mod.updateProgressPhotoCaption('p1', 'new caption')

    const metas = await mod.getProgressPhotoMetas()
    expect(metas[0].caption).toBe('new caption')
    expect(await blobText(await mod.getProgressPhotoBlob('p1'))).toBe('pixels')
  })

  it('no-ops updating a caption for a missing id', async () => {
    await expect(mod.updateProgressPhotoCaption('ghost', 'x')).resolves.toBeUndefined()
    expect(await mod.getProgressPhotoMetas()).toEqual([])
  })

  it('deletes a single photo', async () => {
    await mod.putProgressPhoto({ id: 'a', date: '2026-01-01', caption: '', createdAt: '2026-01-01T00:00:00Z', blob: blobOf('A') })
    await mod.putProgressPhoto({ id: 'b', date: '2026-02-01', caption: '', createdAt: '2026-02-01T00:00:00Z', blob: blobOf('B') })

    await mod.deleteProgressPhoto('a')

    const metas = await mod.getProgressPhotoMetas()
    expect(metas.map(m => m.id)).toEqual(['b'])
    expect(await mod.getProgressPhotoBlob('a')).toBeNull()
  })

  it('clears every photo', async () => {
    await mod.putProgressPhoto({ id: 'a', date: '2026-01-01', caption: '', createdAt: '2026-01-01T00:00:00Z', blob: blobOf('A') })
    await mod.putProgressPhoto({ id: 'b', date: '2026-02-01', caption: '', createdAt: '2026-02-01T00:00:00Z', blob: blobOf('B') })

    await mod.clearProgressPhotos()

    expect(await mod.getProgressPhotoMetas()).toEqual([])
  })

  it('reuses the cached connection across calls', async () => {
    const openSpy = vi.spyOn(indexedDB, 'open')
    await mod.getProgressPhotoMetas()
    const opensAfterFirst = openSpy.mock.calls.length
    expect(opensAfterFirst).toBeGreaterThanOrEqual(1)

    await mod.getProgressPhotoMetas()
    await mod.getProgressPhotoBlob('x')
    expect(openSpy.mock.calls.length).toBe(opensAfterFirst)
  })

  it('re-opens after the connection is closed', async () => {
    await mod.putProgressPhoto({ id: 'a', date: '2026-01-01', caption: '', createdAt: '2026-01-01T00:00:00Z', blob: blobOf('A') })
    mod.closeProgressPhotoDB()
    // A read after close must still succeed (re-opens transparently).
    expect((await mod.getProgressPhotoMetas()).map(m => m.id)).toEqual(['a'])
  })

  describe('IndexedDB unavailable (degrades silently)', () => {
    beforeEach(() => {
      vi.stubGlobal('indexedDB', undefined)
    })

    it('reads resolve to empty / null instead of throwing', async () => {
      await expect(mod.getProgressPhotoMetas()).resolves.toEqual([])
      await expect(mod.getProgressPhotoBlob('a')).resolves.toBeNull()
    })

    it('clearProgressPhotos resolves instead of rejecting', async () => {
      await expect(mod.clearProgressPhotos()).resolves.toBeUndefined()
    })

    it('putProgressPhoto rejects so the caller can surface a failure', async () => {
      await expect(
        mod.putProgressPhoto({ id: 'a', date: '2026-01-01', caption: '', createdAt: '2026-01-01T00:00:00Z', blob: blobOf('A') }),
      ).rejects.toThrow()
    })

    it('closeProgressPhotoDB is safe when nothing is open', () => {
      expect(() => mod.closeProgressPhotoDB()).not.toThrow()
    })
  })
})
