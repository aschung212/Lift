/**
 * Tests for the progress-photos Pinia store (LIFT-1108).
 *
 * The store is a thin reactive cache over the `lift-photos` IndexedDB database,
 * so these tests run against a real in-memory IndexedDB (`fake-indexeddb`) to
 * verify hydration, add/caption/delete/clear, and the newest-first ordering.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { IDBFactory } from 'fake-indexeddb'

const uuidCounter = vi.hoisted(() => ({ n: 0 }))

vi.mock('../../lib/uuid', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return { ...actual, uuid: () => `photo-${uuidCounter.n++}` }
})

let useProgressPhotosStore: typeof import('../progressPhotos')['useProgressPhotosStore']

function blobOf(text: string): Blob {
  return new Blob([text], { type: 'image/jpeg' })
}

beforeEach(async () => {
  uuidCounter.n = 0
  vi.resetModules()
  vi.stubGlobal('indexedDB', new IDBFactory())
  setActivePinia(createPinia())
  ;({ useProgressPhotosStore } = await import('../progressPhotos'))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useProgressPhotosStore', () => {
  it('starts empty and unhydrated', () => {
    const store = useProgressPhotosStore()
    expect(store.count).toBe(0)
    expect(store.hydrated).toBe(false)
  })

  it('adds a photo and returns its id', async () => {
    const store = useProgressPhotosStore()
    const id = await store.addPhoto(blobOf('pixels'), '2026-08-01', '  week 1  ')

    expect(id).toBe('photo-0')
    expect(store.count).toBe(1)
    expect(store.photos[0]).toMatchObject({ id: 'photo-0', date: '2026-08-01', caption: 'week 1' })
    // Blob is never held in the reactive metadata.
    expect('blob' in store.photos[0]).toBe(false)
  })

  it('exposes the stored blob via blobFor', async () => {
    const store = useProgressPhotosStore()
    const id = await store.addPhoto(blobOf('pixels'), '2026-08-01')
    const blob = await store.blobFor(id!)
    expect(await blob!.text()).toBe('pixels')
  })

  it('hydrates metadata from IndexedDB across store instances', async () => {
    const first = useProgressPhotosStore()
    await first.addPhoto(blobOf('a'), '2026-08-01')

    // Fresh pinia + store instance, same IndexedDB — simulates a reload.
    setActivePinia(createPinia())
    const second = useProgressPhotosStore()
    expect(second.count).toBe(0)
    await second.hydrate()
    expect(second.count).toBe(1)
    expect(second.hydrated).toBe(true)
  })

  it('hydrate is idempotent', async () => {
    const store = useProgressPhotosStore()
    await store.addPhoto(blobOf('a'), '2026-08-01')
    await store.hydrate()
    await store.hydrate()
    expect(store.count).toBe(1)
  })

  it('orders photos newest-first by day then capture time', async () => {
    const store = useProgressPhotosStore()
    await store.addPhoto(blobOf('a'), '2026-08-01')
    await store.addPhoto(blobOf('b'), '2026-08-10')
    await store.addPhoto(blobOf('c'), '2026-08-05')

    expect(store.sortedPhotos.map(p => p.date)).toEqual(['2026-08-10', '2026-08-05', '2026-08-01'])
  })

  it('breaks a same-day tie by newest capture time first', async () => {
    const store = useProgressPhotosStore()
    const older = await store.addPhoto(blobOf('a'), '2026-08-01')
    // Force a strictly later createdAt on the second entry.
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'))
    const newer = await store.addPhoto(blobOf('b'), '2026-08-01')
    vi.useRealTimers()

    expect(store.sortedPhotos.map(p => p.id)).toEqual([newer, older])
  })

  it('updates a caption and trims it', async () => {
    const store = useProgressPhotosStore()
    const id = await store.addPhoto(blobOf('a'), '2026-08-01')
    await store.setCaption(id!, '  bulking  ')
    expect(store.photos[0].caption).toBe('bulking')
  })

  it('removes a photo and its blob', async () => {
    const store = useProgressPhotosStore()
    const id = await store.addPhoto(blobOf('a'), '2026-08-01')
    await store.removePhoto(id!)
    expect(store.count).toBe(0)
    expect(await store.blobFor(id!)).toBeNull()
  })

  it('clears the whole timeline', async () => {
    const store = useProgressPhotosStore()
    await store.addPhoto(blobOf('a'), '2026-08-01')
    await store.addPhoto(blobOf('b'), '2026-08-02')
    await store.clearAll()
    expect(store.count).toBe(0)
    expect(await store.blobFor('photo-0')).toBeNull()
  })

  it('returns null and does not mutate state when the write fails', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const store = useProgressPhotosStore()
    const id = await store.addPhoto(blobOf('a'), '2026-08-01')
    expect(id).toBeNull()
    expect(store.count).toBe(0)
  })
})
