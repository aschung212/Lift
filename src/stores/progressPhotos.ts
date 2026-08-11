import { defineStore } from 'pinia'
import { uuid } from '../lib/uuid'
import {
  putProgressPhoto,
  getProgressPhotoMetas,
  getProgressPhotoBlob,
  updateProgressPhotoCaption,
  deleteProgressPhoto,
  clearProgressPhotos,
  type ProgressPhotoMeta,
} from '../lib/progressPhotos'

/**
 * Progress-photos timeline store (LIFT-1108).
 *
 * A thin reactive cache over the `lift-photos` IndexedDB database. Unlike the
 * other stores, the source of truth is IndexedDB (blobs are too big for
 * localStorage), so this store hydrates ASYNCHRONOUSLY via `hydrate()` rather
 * than reading synchronously in `state()`. It holds only lightweight metadata;
 * the pixels are fetched on demand through `blobFor()`.
 *
 * Local-first and device-local by design: photos are private and intentionally
 * NOT synced to Supabase in this phase (opt-in Storage sync is a deliberate
 * follow-up). They persist across sign-out like other local data and are wiped
 * on account deletion (which drops all IndexedDB databases).
 */
export const useProgressPhotosStore = defineStore('progressPhotos', {
  state: () => ({
    photos: [] as ProgressPhotoMeta[],
    hydrated: false,
  }),

  getters: {
    /** Newest first — by day, then capture time within a day. */
    sortedPhotos: (state): ProgressPhotoMeta[] =>
      [...state.photos].sort((a, b) =>
        a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date),
      ),

    count: (state): number => state.photos.length,
  },

  actions: {
    /** Load metadata from IndexedDB once. Idempotent. */
    async hydrate() {
      if (this.hydrated) return
      this.photos = await getProgressPhotoMetas()
      this.hydrated = true
    },

    /**
     * Persist a new photo and add its metadata to the timeline (the
     * `sortedPhotos` getter handles newest-first ordering).
     * `dateKey` is a local YYYY-MM-DD day; caption is optional.
     * Returns the new photo id, or null if the write failed.
     */
    async addPhoto(blob: Blob, dateKey: string, caption = ''): Promise<string | null> {
      const meta: ProgressPhotoMeta = {
        id: uuid(),
        date: dateKey,
        caption: caption.trim(),
        createdAt: new Date().toISOString(),
      }
      try {
        await putProgressPhoto({ ...meta, blob })
      } catch {
        return null
      }
      this.photos.push(meta)
      return meta.id
    },

    /** Fetch a photo's blob for display (thumbnail / comparison). */
    async blobFor(id: string): Promise<Blob | null> {
      return getProgressPhotoBlob(id)
    },

    /** Rename a photo's caption. */
    async setCaption(id: string, caption: string) {
      const trimmed = caption.trim()
      const meta = this.photos.find(p => p.id === id)
      if (!meta) return
      await updateProgressPhotoCaption(id, trimmed)
      meta.caption = trimmed
    },

    /** Delete a single photo (metadata + blob). */
    async removePhoto(id: string) {
      await deleteProgressPhoto(id)
      this.photos = this.photos.filter(p => p.id !== id)
    },

    /** Wipe the whole timeline. */
    async clearAll() {
      await clearProgressPhotos()
      this.photos = []
    },
  },
})
