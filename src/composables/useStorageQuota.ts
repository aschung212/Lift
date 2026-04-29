import { ref, computed } from 'vue'
import { logError } from '../lib/logger'

/** Reactive storage quota state shared across components. */
const usage = ref<number | null>(null)
const quota = ref<number | null>(null)
const persisted = ref<boolean | null>(null)
const lastChecked = ref<number | null>(null)

/** Whether the StorageManager API is available. */
const isSupported = typeof navigator !== 'undefined' && !!navigator.storage?.estimate

/** Usage as a 0–1 fraction, or null if unavailable. */
const usageFraction = computed(() => {
  if (usage.value == null || quota.value == null || quota.value === 0) return null
  return usage.value / quota.value
})

/** True when usage exceeds 80% of quota. */
const isWarning = computed(() => {
  const f = usageFraction.value
  return f != null && f >= 0.8
})

/** True when usage exceeds 95% of quota. */
const isCritical = computed(() => {
  const f = usageFraction.value
  return f != null && f >= 0.95
})

/** Human-readable usage string (e.g. "12.3 MB of 200 MB"). */
const usageLabel = computed(() => {
  if (usage.value == null || quota.value == null) return null
  return `${formatBytes(usage.value)} of ${formatBytes(quota.value)}`
})

/** Human-readable percentage (e.g. "6%"). */
const usagePercent = computed(() => {
  const f = usageFraction.value
  if (f == null) return null
  return `${Math.round(f * 100)}%`
})

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/**
 * Check storage quota using the StorageManager API.
 * Safe to call multiple times — results are cached for 60 seconds.
 */
async function checkQuota(): Promise<void> {
  if (!navigator.storage?.estimate) return

  // Debounce: skip if checked within the last 60 seconds
  if (lastChecked.value && Date.now() - lastChecked.value < 60_000) return

  try {
    const estimate = await navigator.storage.estimate()
    usage.value = estimate.usage ?? null
    quota.value = estimate.quota ?? null
    lastChecked.value = Date.now()

    // Also check persistence status
    if (navigator.storage.persisted) {
      persisted.value = await navigator.storage.persisted()
    }
  } catch (e) {
    logError(e, { source: 'useStorageQuota.checkQuota' })
  }
}

/**
 * Returns true if the error is a QuotaExceededError.
 * Use in catch blocks around localStorage.setItem / IDB put.
 */
function isQuotaError(e: unknown): boolean {
  if (e instanceof DOMException) {
    // Standard name or legacy code
    return e.name === 'QuotaExceededError' || e.code === 22
  }
  return false
}

export function useStorageQuota() {
  return {
    /** Raw usage in bytes (null if unsupported or not yet checked). */
    usage,
    /** Raw quota in bytes. */
    quota,
    /** Whether persistent storage was granted. */
    persisted,
    /** 0–1 fraction. */
    usageFraction,
    /** True at >=80%. */
    isWarning,
    /** True at >=95%. */
    isCritical,
    /** "12.3 MB of 200 MB" */
    usageLabel,
    /** "6%" */
    usagePercent,
    /** Whether the browser supports StorageManager. */
    isSupported,
    /** Fetch current quota (debounced to 60s). */
    checkQuota,
    /** Check if an error is QuotaExceededError. */
    isQuotaError,
    /** Exposed for testing. */
    formatBytes,
  }
}
