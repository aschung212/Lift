import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  storageEstimate,
  isPersisted,
  quotaExceeded,
  refreshStorageEstimate,
  isQuotaWarning,
  formatBytes,
  isQuotaExceededError,
  handlePersistError,
  QUOTA_WARNING_THRESHOLD,
} from '../storageQuota'

beforeEach(() => {
  storageEstimate.value = { usage: 0, quota: 0, percent: 0, available: false }
  isPersisted.value = false
  quotaExceeded.value = false
})

describe('formatBytes', () => {
  it('formats bytes', () => {
    expect(formatBytes(512)).toBe('512 B')
  })

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(2048)).toBe('2 KB')
  })

  it('formats megabytes', () => {
    expect(formatBytes(1_048_576)).toBe('1.0 MB')
    expect(formatBytes(5_242_880)).toBe('5.0 MB')
    expect(formatBytes(1_572_864)).toBe('1.5 MB')
  })
})

describe('isQuotaExceededError', () => {
  it('detects QuotaExceededError by name', () => {
    const err = new DOMException('quota exceeded', 'QuotaExceededError')
    expect(isQuotaExceededError(err)).toBe(true)
  })

  it('rejects non-DOMException errors', () => {
    expect(isQuotaExceededError(new Error('nope'))).toBe(false)
    expect(isQuotaExceededError(null)).toBe(false)
    expect(isQuotaExceededError('string')).toBe(false)
  })

  it('rejects other DOMException types', () => {
    const err = new DOMException('not found', 'NotFoundError')
    expect(isQuotaExceededError(err)).toBe(false)
  })
})

describe('isQuotaWarning', () => {
  it('returns false when API is unavailable', () => {
    storageEstimate.value = { usage: 100, quota: 100, percent: 1, available: false }
    expect(isQuotaWarning()).toBe(false)
  })

  it('returns false below threshold', () => {
    storageEstimate.value = { usage: 50, quota: 100, percent: 0.5, available: true }
    expect(isQuotaWarning()).toBe(false)
  })

  it('returns true at threshold', () => {
    storageEstimate.value = {
      usage: 80,
      quota: 100,
      percent: QUOTA_WARNING_THRESHOLD,
      available: true,
    }
    expect(isQuotaWarning()).toBe(true)
  })

  it('returns true above threshold', () => {
    storageEstimate.value = { usage: 95, quota: 100, percent: 0.95, available: true }
    expect(isQuotaWarning()).toBe(true)
  })
})

describe('handlePersistError', () => {
  it('sets quotaExceeded flag for QuotaExceededError', () => {
    const err = new DOMException('quota exceeded', 'QuotaExceededError')
    handlePersistError(err)
    expect(quotaExceeded.value).toBe(true)
  })

  it('does not set flag for other errors', () => {
    handlePersistError(new Error('generic'))
    expect(quotaExceeded.value).toBe(false)
  })
})

describe('refreshStorageEstimate', () => {
  it('returns unavailable when API is missing', async () => {
    const origStorage = navigator.storage
    Object.defineProperty(navigator, 'storage', { value: undefined, writable: true, configurable: true })

    const result = await refreshStorageEstimate()
    expect(result.available).toBe(false)
    expect(storageEstimate.value.available).toBe(false)

    Object.defineProperty(navigator, 'storage', { value: origStorage, writable: true, configurable: true })
  })

  it('populates estimate when API is available', async () => {
    const mockEstimate = vi.fn().mockResolvedValue({ usage: 5_000_000, quota: 100_000_000 })
    const mockPersisted = vi.fn().mockResolvedValue(true)
    const origStorage = navigator.storage
    Object.defineProperty(navigator, 'storage', {
      value: { estimate: mockEstimate, persisted: mockPersisted },
      writable: true,
      configurable: true,
    })

    const result = await refreshStorageEstimate()
    expect(result.available).toBe(true)
    expect(result.usage).toBe(5_000_000)
    expect(result.quota).toBe(100_000_000)
    expect(result.percent).toBeCloseTo(0.05)
    expect(isPersisted.value).toBe(true)

    Object.defineProperty(navigator, 'storage', { value: origStorage, writable: true, configurable: true })
  })

  it('handles estimate() throwing gracefully', async () => {
    const mockEstimate = vi.fn().mockRejectedValue(new Error('fail'))
    const origStorage = navigator.storage
    Object.defineProperty(navigator, 'storage', {
      value: { estimate: mockEstimate },
      writable: true,
      configurable: true,
    })

    const result = await refreshStorageEstimate()
    expect(result.available).toBe(false)

    Object.defineProperty(navigator, 'storage', { value: origStorage, writable: true, configurable: true })
  })
})
