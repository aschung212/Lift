import { reactive } from 'vue'
import { estimateStorageQuota, isQuotaExceeded } from '../lib/durableStorage'
import { logWarn } from '../lib/logger'

const PRESSURE_THRESHOLD = 0.80

export interface StorageQuotaState {
  /** Whether quota estimation has completed at least once */
  checked: boolean
  /** Estimated usage in bytes */
  usage: number
  /** Estimated quota in bytes */
  quota: number
  /** Usage as a fraction of quota (0–1) */
  pct: number
  /** True when usage exceeds the pressure threshold */
  pressure: boolean
  /** True when a QuotaExceededError has been caught in this session */
  quotaExceeded: boolean
}

export const storageQuota = reactive<StorageQuotaState>({
  checked: false,
  usage: 0,
  quota: 0,
  pct: 0,
  pressure: false,
  quotaExceeded: false,
})

/**
 * Check storage quota and update the reactive state.
 * Called once on app startup and can be called again on demand.
 */
export async function checkStorageQuota(): Promise<void> {
  const estimate = await estimateStorageQuota()
  if (!estimate) return
  storageQuota.usage = estimate.usage
  storageQuota.quota = estimate.quota
  storageQuota.pct = estimate.pct
  storageQuota.checked = true
  storageQuota.pressure = estimate.pct >= PRESSURE_THRESHOLD
  if (storageQuota.pressure) {
    logWarn('Storage pressure detected', {
      source: 'storageQuota',
      pct: Math.round(estimate.pct * 100),
      usage: estimate.usage,
      quota: estimate.quota,
    })
  }
}

/**
 * Call from store _persist() catch blocks when a QuotaExceededError is caught.
 * Updates the global state so the UI can react.
 */
export function reportQuotaExceeded(): void {
  storageQuota.quotaExceeded = true
  storageQuota.pressure = true
}

/**
 * Format bytes into a human-readable string (KB, MB, GB).
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
