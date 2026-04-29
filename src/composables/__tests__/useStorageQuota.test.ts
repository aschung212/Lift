import { describe, it, expect, vi, beforeEach } from 'vitest'
import { storageQuota, checkStorageQuota, reportQuotaExceeded, formatBytes } from '../useStorageQuota'

// Reset reactive state before each test
beforeEach(() => {
  storageQuota.checked = false
  storageQuota.usage = 0
  storageQuota.quota = 0
  storageQuota.pct = 0
  storageQuota.pressure = false
  storageQuota.quotaExceeded = false
})

describe('formatBytes', () => {
  it('formats bytes', () => {
    expect(formatBytes(500)).toBe('500 B')
  })

  it('formats kilobytes', () => {
    expect(formatBytes(2048)).toBe('2.0 KB')
  })

  it('formats megabytes', () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })

  it('formats gigabytes', () => {
    expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe('2.5 GB')
  })
})

describe('checkStorageQuota', () => {
  it('updates state when estimate is available', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        estimate: vi.fn().mockResolvedValue({ usage: 1000, quota: 10000 }),
      },
    })

    await checkStorageQuota()

    expect(storageQuota.checked).toBe(true)
    expect(storageQuota.usage).toBe(1000)
    expect(storageQuota.quota).toBe(10000)
    expect(storageQuota.pct).toBe(0.1)
    expect(storageQuota.pressure).toBe(false)

    vi.unstubAllGlobals()
  })

  it('sets pressure when usage exceeds 80%', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        estimate: vi.fn().mockResolvedValue({ usage: 8500, quota: 10000 }),
      },
    })

    await checkStorageQuota()

    expect(storageQuota.pressure).toBe(true)
    expect(storageQuota.pct).toBe(0.85)

    vi.unstubAllGlobals()
  })

  it('handles missing storage API gracefully', async () => {
    vi.stubGlobal('navigator', {})

    await checkStorageQuota()

    expect(storageQuota.checked).toBe(false)

    vi.unstubAllGlobals()
  })
})

describe('reportQuotaExceeded', () => {
  it('sets quotaExceeded and pressure flags', () => {
    expect(storageQuota.quotaExceeded).toBe(false)
    expect(storageQuota.pressure).toBe(false)

    reportQuotaExceeded()

    expect(storageQuota.quotaExceeded).toBe(true)
    expect(storageQuota.pressure).toBe(true)
  })
})
