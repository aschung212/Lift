/**
 * Tests for the photos store (LIFT-1108). The IndexedDB blob layer is mocked
 * (exercised separately in progressPhotos.test.ts) so these tests focus on the
 * store's metadata orchestration: validation, ordering, persistence, and the
 * blob/metadata commit ordering that prevents dangling rows.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { getLocalStorageMock } from '../../__tests__/helpers'

const uuidCounter = vi.hoisted(() => ({ n: 0 }))
const blobMocks = vi.hoisted(() => ({
  put: vi.fn(async () => {}),
  del: vi.fn(async () => {}),
  clear: vi.fn(async () => {}),
}))

vi.mock('../../lib/uuid', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, uuid: () => `photo-${uuidCounter.n++}` }
})

vi.mock('../../lib/progressPhotos', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    putPhotoBlob: blobMocks.put,
    deletePhotoBlob: blobMocks.del,
    clearAllPhotoBlobs: blobMocks.clear,
  }
})

import { usePhotosStore, PHOTOS_STORAGE_KEY } from '../photos'

const localStorageMock = getLocalStorageMock()

function imageFile(name = 'a.jpg', type = 'image/jpeg', size = 1024): File {
  const f = new File([new Uint8Array(1)], name, { type })
  // File.size is read-only and derived from the blob parts; override for tests
  // that assert on the size guard.
  Object.defineProperty(f, 'size', { value: size })
  return f
}

describe('usePhotosStore', () => {
  let store: ReturnType<typeof usePhotosStore>

  beforeEach(() => {
    uuidCounter.n = 0
    blobMocks.put.mockClear().mockResolvedValue(undefined)
    blobMocks.del.mockClear().mockResolvedValue(undefined)
    blobMocks.clear.mockClear().mockResolvedValue(undefined)
    localStorageMock.clear()
    setActivePinia(createPinia())
    store = usePhotosStore()
    store.photos = []
  })

  describe('addPhoto', () => {
    it('stores the blob then commits metadata and persists', async () => {
      const id = await store.addPhoto(imageFile(), { date: '2026-01-15', note: '  start  ' })
      expect(id).toBe('photo-0')
      expect(blobMocks.put).toHaveBeenCalledWith('photo-0', expect.any(File))
      expect(store.photos).toHaveLength(1)
      expect(store.photos[0]).toMatchObject({ id: 'photo-0', date: '2026-01-15', note: 'start' })
      // Persisted to localStorage under the shared key.
      const raw = JSON.parse(localStorageMock.getItem(PHOTOS_STORAGE_KEY)!)
      expect(raw[0].id).toBe('photo-0')
    })

    it('defaults the date to today when none is given', async () => {
      await store.addPhoto(imageFile())
      expect(store.photos[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('omits an empty/whitespace note', async () => {
      await store.addPhoto(imageFile(), { note: '   ' })
      expect(store.photos[0].note).toBeUndefined()
    })

    it('rejects a non-image file without writing anything', async () => {
      const bad = new File(['x'], 'notes.pdf', { type: 'application/pdf' })
      const id = await store.addPhoto(bad)
      expect(id).toBeNull()
      expect(blobMocks.put).not.toHaveBeenCalled()
      expect(store.photos).toHaveLength(0)
    })

    it('does not commit metadata when the blob write fails', async () => {
      blobMocks.put.mockRejectedValueOnce(new Error('quota'))
      const id = await store.addPhoto(imageFile())
      expect(id).toBeNull()
      expect(store.photos).toHaveLength(0)
    })
  })

  describe('updateNote', () => {
    it('sets and clears the note', async () => {
      const id = await store.addPhoto(imageFile())
      store.updateNote(id!, 'week 4')
      expect(store.photos[0].note).toBe('week 4')
      store.updateNote(id!, '   ')
      expect(store.photos[0].note).toBeUndefined()
    })

    it('is a no-op for an unknown id', async () => {
      await store.addPhoto(imageFile())
      expect(() => store.updateNote('nope', 'x')).not.toThrow()
    })
  })

  describe('deletePhoto', () => {
    it('removes metadata and deletes the blob', async () => {
      const id = await store.addPhoto(imageFile())
      await store.deletePhoto(id!)
      expect(store.photos).toHaveLength(0)
      expect(blobMocks.del).toHaveBeenCalledWith(id)
    })
  })

  describe('clearAll', () => {
    it('empties metadata and wipes all blobs', async () => {
      await store.addPhoto(imageFile('a.jpg'))
      await store.addPhoto(imageFile('b.jpg'))
      await store.clearAll()
      expect(store.photos).toHaveLength(0)
      expect(blobMocks.clear).toHaveBeenCalledOnce()
    })
  })

  describe('getters', () => {
    it('sorts newest-first and exposes a compare pair', async () => {
      await store.addPhoto(imageFile('a'), { date: '2026-01-01' })
      await store.addPhoto(imageFile('c'), { date: '2026-03-01' })
      await store.addPhoto(imageFile('b'), { date: '2026-02-01' })
      expect(store.sorted.map(p => p.date)).toEqual(['2026-03-01', '2026-02-01', '2026-01-01'])
      expect(store.count).toBe(3)
      expect(store.comparePair?.before.date).toBe('2026-01-01')
      expect(store.comparePair?.after.date).toBe('2026-03-01')
    })

    it('has no compare pair with a single photo', async () => {
      await store.addPhoto(imageFile())
      expect(store.comparePair).toBeNull()
    })
  })

  describe('hydration', () => {
    it('drops a corrupt persisted entry on load', () => {
      localStorageMock.setItem(
        PHOTOS_STORAGE_KEY,
        JSON.stringify([
          { id: 'ok', date: '2026-01-01', createdAt: '2026-01-01T00:00:00Z' },
          { id: '', date: '2026-01-02', createdAt: '2026-01-02T00:00:00Z' },
        ]),
      )
      setActivePinia(createPinia())
      const fresh = usePhotosStore()
      expect(fresh.photos.map(p => p.id)).toEqual(['ok'])
    })
  })
})
