import { ref, readonly, onMounted, onUnmounted } from 'vue'
import { estimateStorageQuota, onQuotaExceededChange, getQuotaExceeded, type StorageEstimate } from '../lib/durableStorage'

const PRESSURE_THRESHOLD = 80

const estimate = ref<StorageEstimate | null>(null)
const pressureWarning = ref(false)
const quotaExceeded = ref(getQuotaExceeded())

/** Format bytes as human-readable string. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function refresh() {
  estimate.value = await estimateStorageQuota()
  pressureWarning.value = (estimate.value?.percent ?? 0) >= PRESSURE_THRESHOLD
}

export function useStorageQuota() {
  const unsubscribe = onQuotaExceededChange((v) => {
    quotaExceeded.value = v
  })

  onMounted(refresh)
  onUnmounted(unsubscribe)

  return {
    estimate: readonly(estimate),
    pressureWarning: readonly(pressureWarning),
    quotaExceeded: readonly(quotaExceeded),
    refresh,
  }
}
