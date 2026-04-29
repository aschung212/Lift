import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  estimateStorageQuota,
  isQuotaExceededError,
  setQuotaExceeded,
  getQuotaExceeded,
  onQuotaExceededChange,
} from '../durableStorage'
import { formatBytes } from '../../composables/useStorageQuota'

describe('estimateStorageQuota', () => {
  const originalNavigator = globalThis.navigator

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    })
  })

  it('returns null when StorageManager API is unavailable', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { storage: undefined },
      writable: true,
      configurable: true,
    })
    expect(await estimateStorageQuota()).toBeNull()
  })

  it('returns estimate with usage, quota, percent, and persisted', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        storage: {
          estimate: vi.fn().mockResolvedValue({ usage: 5_000_000, quota: 100_000_000 }),
          persisted: vi.fn().mockResolvedValue(true),
        },
      },
      writable: true,
      configurable: true,
    })
    const result = await estimateStorageQuota()
    expect(result).toEqual({
      usage: 5_000_000,
      quota: 100_000_000,
      percent: 5,
      persisted: true,
    })
  })

  it('handles estimate() throwing gracefully', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        storage: {
          estimate: vi.fn().mockRejectedValue(new Error('fail')),
        },
      },
      writable: true,
      configurable: true,
    })
    expect(await estimateStorageQuota()).toBeNull()
  })

  it('calculates correct percentage at high usage', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        storage: {
          estimate: vi.fn().mockResolvedValue({ usage: 85_000_000, quota: 100_000_000 }),
          persisted: vi.fn().mockResolvedValue(false),
        },
      },
      writable: true,
      configurable: true,
    })
    const result = await estimateStorageQuota()
    expect(result?.percent).toBe(85)
    expect(result?.persisted).toBe(false)
  })
})

describe('isQuotaExceededError', () => {
  it('detects QuotaExceededError by name', () => {
    const err = new DOMException('quota exceeded', 'QuotaExceededError')
    expect(isQuotaExceededError(err)).toBe(true)
  })

  it('returns false for other DOMExceptions', () => {
    const err = new DOMException('not found', 'NotFoundError')
    expect(isQuotaExceededError(err)).toBe(false)
  })

  it('returns false for non-DOMException errors', () => {
    expect(isQuotaExceededError(new Error('generic'))).toBe(false)
    expect(isQuotaExceededError(null)).toBe(false)
    expect(isQuotaExceededError('string error')).toBe(false)
  })
})

describe('quota exceeded reactive flag', () => {
  beforeEach(() => {
    setQuotaExceeded(false)
  })

  it('starts false', () => {
    expect(getQuotaExceeded()).toBe(false)
  })

  it('notifies listeners when set', () => {
    const listener = vi.fn()
    const unsub = onQuotaExceededChange(listener)

    setQuotaExceeded(true)
    expect(listener).toHaveBeenCalledWith(true)
    expect(getQuotaExceeded()).toBe(true)

    unsub()
    setQuotaExceeded(false)
    expect(listener).toHaveBeenCalledTimes(1) // not called again after unsub
  })
})

describe('formatBytes', () => {
  it('formats bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
  })

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
  })

  it('formats megabytes', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(5.5 * 1024 * 1024)).toBe('5.5 MB')
  })
})
