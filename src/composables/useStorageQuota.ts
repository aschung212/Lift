import { ref, onMounted } from 'vue'

export interface StorageQuota {
  usage: number
  quota: number
  percent: number
  /** true when usage exceeds 80% of quota */
  warning: boolean
}

const storageQuota = ref<StorageQuota | null>(null)

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

async function checkQuota(): Promise<StorageQuota | null> {
  if (!navigator.storage?.estimate) return null

  try {
    const estimate = await navigator.storage.estimate()
    const usage = estimate.usage ?? 0
    const quota = estimate.quota ?? 0
    if (quota === 0) return null

    const percent = Math.round((usage / quota) * 100)
    const result: StorageQuota = {
      usage,
      quota,
      percent,
      warning: percent >= 80,
    }
    storageQuota.value = result
    return result
  } catch {
    return null
  }
}

export function useStorageQuota() {
  onMounted(() => {
    checkQuota()
  })

  return {
    storageQuota,
    checkQuota,
    formatBytes,
  }
}
