import { defineStore } from 'pinia'
import { loadJSON } from '../lib/storage'
import { uuid } from '../lib/uuid'
import { todayISO } from '../lib/dates'
import { logWarn } from '../lib/logger'
import { persistStoreData } from '../lib/storePersistence'
import {
  type PhotoMeta,
  parsePhotoMetaList,
  sortPhotosByDate,
  selectComparePair,
  isSupportedPhoto,
  putPhotoBlob,
  deletePhotoBlob,
  clearAllPhotoBlobs,
} from '../lib/progressPhotos'

export const PHOTOS_STORAGE_KEY = 'progress-photos'

function load(): PhotoMeta[] {
  // Element-level guard at the localStorage boundary (LIFT-946): a single
  // corrupt entry must never break the timeline.
  return parsePhotoMetaList(loadJSON<unknown>(PHOTOS_STORAGE_KEY, []))
}

/**
 * Progress-photos store (LIFT-1108).
 *
 * Metadata lives here (persisted to localStorage); the image bytes live in a
 * dedicated IndexedDB blob store. Deliberately local-only — no Supabase sync,
 * no `_userId`, no sync queue — because progress photos are the most sensitive
 * data the app holds and privacy-forward means they never leave the device.
 */
export const usePhotosStore = defineStore('photos', {
  state: () => ({
    photos: load() as PhotoMeta[],
  }),

  getters: {
    /** Timeline order: newest first. */
    sorted: (state): PhotoMeta[] => sortPhotosByDate(state.photos, 'desc'),
    /** Default before/after pair for the comparison view, or null if <2 photos. */
    comparePair: (state) => selectComparePair(state.photos),
    count: (state): number => state.photos.length,
  },

  actions: {
    _persist() {
      // persistStoreData owns the write + IndexedDB backup + cross-tab broadcast.
      persistStoreData('photos', PHOTOS_STORAGE_KEY, JSON.stringify(this.photos))
    },

    /** Re-read metadata from localStorage (called by the cross-tab sync listener). */
    _reloadFromStorage() {
      this.photos = load()
    },

    /**
     * Store a new photo. Writes the image blob to IndexedDB first, then commits
     * the metadata — so a failed blob write leaves no dangling metadata row
     * pointing at bytes that were never saved. Returns the new id, or null when
     * the file is unsupported / the blob write fails.
     */
    async addPhoto(
      file: File,
      opts: { date?: string; note?: string } = {},
    ): Promise<string | null> {
      if (!isSupportedPhoto(file)) return null

      const id = uuid()
      try {
        await putPhotoBlob(id, file)
      } catch (err) {
        logWarn('Failed to store progress photo', { err })
        return null
      }

      const note = opts.note?.trim()
      this.photos.push({
        id,
        date: opts.date || todayISO(),
        createdAt: new Date().toISOString(),
        ...(note ? { note } : {}),
      })
      this._persist()
      return id
    },

    updateNote(id: string, note: string) {
      const photo = this.photos.find(p => p.id === id)
      if (!photo) return
      const trimmed = note.trim()
      if (trimmed) photo.note = trimmed
      else delete photo.note
      this._persist()
    },

    async deletePhoto(id: string) {
      this.photos = this.photos.filter(p => p.id !== id)
      this._persist()
      await deletePhotoBlob(id)
    },

    async clearAll() {
      this.photos = []
      this._persist()
      await clearAllPhotoBlobs()
    },
  },
})
