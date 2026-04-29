/**
 * Storage Quota Monitoring
 *
 * Uses the StorageManager API to estimate storage usage and quota.
 * Provides reactive state for the settings UI and a warning system
 * when usage approaches quota limits.
 */

import { ref } from 'vue'

export interface StorageEstimate {
  /** Bytes used by the origin */
  usage: number
  /** Total quota available to the origin */
  quota: number
  /** Usage as a fraction (0–1) */
  percent: number
  /** Whether this is a real estimate (false = API unavailable) */
  available: boolean
}

/** Reactive storage estimate, updated on demand */
export const storageEstimate = ref<StorageEstimate>({
  usage: 0,
  quota: 0,
  percent: 0,
  available: false,
})

/** Whether persistent storage has been granted */
export const isPersisted = ref(false)

/**
 * Refresh the storage estimate from the StorageManager API.
 * Safe to call in any environment — returns gracefully if API is unavailable.
 */
export async function refreshStorageEstimate(): Promise<StorageEstimate> {
  if (!navigator.storage?.estimate) {
    storageEstimate.value = { usage: 0, quota: 0, percent: 0, available: false }
    return storageEstimate.value
  }

  try {
    const est = await navigator.storage.estimate()
    const usage = est.usage ?? 0
    const quota = est.quota ?? 0
    const percent = quota > 0 ? usage / quota : 0

    storageEstimate.value = { usage, quota, percent, available: true }

    // Check persistence status while we're at it
    if (navigator.storage.persisted) {
      isPersisted.value = await navigator.storage.persisted()
    }
  } catch {
    storageEstimate.value = { usage: 0, quota: 0, percent: 0, available: false }
  }

  return storageEstimate.value
}

/** Threshold above which we show a warning (80%) */
export const QUOTA_WARNING_THRESHOLD = 0.8

/** Whether current usage exceeds the warning threshold */
export function isQuotaWarning(): boolean {
  const est = storageEstimate.value
  return est.available && est.percent >= QUOTA_WARNING_THRESHOLD
}

/**
 * Format bytes into a human-readable string.
 * Uses MB for values >= 1 MB, KB otherwise.
 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) {
    return `${(bytes / 1_048_576).toFixed(1)} MB`
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`
  }
  return `${bytes} B`
}

/** Reactive flag: true when a QuotaExceededError has been caught */
export const quotaExceeded = ref(false)

/**
 * Check if a QuotaExceededError was thrown.
 * Works across browsers (DOMException name or legacy code 22).
 */
export function isQuotaExceededError(e: unknown): boolean {
  return (
    e instanceof DOMException &&
    (e.name === 'QuotaExceededError' || e.code === 22)
  )
}

/**
 * Call from store _persist catch blocks to handle quota errors.
 * Sets the reactive flag so the UI can display a warning.
 */
export function handlePersistError(e: unknown): void {
  if (isQuotaExceededError(e)) {
    quotaExceeded.value = true
    refreshStorageEstimate()
  }
}
