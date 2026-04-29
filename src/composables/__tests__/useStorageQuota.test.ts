import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock navigator.storage before the module loads
const mockEstimate = vi.fn()
const mockPersisted = vi.fn()

beforeEach(() => {
  mockEstimate.mockResolvedValue({ usage: 5 * 1024 * 1024, quota: 200 * 1024 * 1024 })
  mockPersisted.mockResolvedValue(true)

  Object.defineProperty(navigator, 'storage', {
    value: {
      estimate: mockEstimate,
      persist: vi.fn(),
      persisted: mockPersisted,
    },
    writable: true,
    configurable: true,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// Dynamic import after mocking
async function loadComposable() {
  // Reset module to clear cached state
  vi.resetModules()
  const mod = await import('../useStorageQuota')
  return mod.useStorageQuota()
}

describe('useStorageQuota', () => {
  describe('formatBytes', () => {
    it('formats bytes', async () => {
      const { formatBytes } = await loadComposable()
      expect(formatBytes(0)).toBe('0 B')
      expect(formatBytes(512)).toBe('512 B')
    })

    it('formats kilobytes', async () => {
      const { formatBytes } = await loadComposable()
      expect(formatBytes(1024)).toBe('1.0 KB')
      expect(formatBytes(1536)).toBe('1.5 KB')
    })

    it('formats megabytes', async () => {
      const { formatBytes } = await loadComposable()
      expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
      expect(formatBytes(12.3 * 1024 * 1024)).toBe('12.3 MB')
    })

    it('formats gigabytes', async () => {
      const { formatBytes } = await loadComposable()
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB')
    })
  })

  describe('isQuotaError', () => {
    it('returns true for QuotaExceededError', async () => {
      const { isQuotaError } = await loadComposable()
      const err = new DOMException('Quota exceeded', 'QuotaExceededError')
      expect(isQuotaError(err)).toBe(true)
    })

    it('returns false for other DOMExceptions', async () => {
      const { isQuotaError } = await loadComposable()
      const err = new DOMException('Something else', 'NotFoundError')
      expect(isQuotaError(err)).toBe(false)
    })

    it('returns false for non-DOM errors', async () => {
      const { isQuotaError } = await loadComposable()
      expect(isQuotaError(new Error('fail'))).toBe(false)
      expect(isQuotaError(null)).toBe(false)
      expect(isQuotaError('string')).toBe(false)
    })
  })

  describe('checkQuota', () => {
    it('populates usage and quota after checking', async () => {
      const sq = await loadComposable()
      await sq.checkQuota()
      expect(sq.usage.value).toBe(5 * 1024 * 1024)
      expect(sq.quota.value).toBe(200 * 1024 * 1024)
    })

    it('computes usageLabel with human-readable sizes', async () => {
      const sq = await loadComposable()
      await sq.checkQuota()
      expect(sq.usageLabel.value).toBe('5.0 MB of 200.0 MB')
    })

    it('computes usagePercent', async () => {
      const sq = await loadComposable()
      await sq.checkQuota()
      expect(sq.usagePercent.value).toBe('3%')
    })

    it('isWarning is false when under 80%', async () => {
      const sq = await loadComposable()
      await sq.checkQuota()
      expect(sq.isWarning.value).toBe(false)
    })

    it('isWarning is true at 80%+', async () => {
      mockEstimate.mockResolvedValue({ usage: 160 * 1024 * 1024, quota: 200 * 1024 * 1024 })
      const sq = await loadComposable()
      await sq.checkQuota()
      expect(sq.isWarning.value).toBe(true)
    })

    it('isCritical is true at 95%+', async () => {
      mockEstimate.mockResolvedValue({ usage: 195 * 1024 * 1024, quota: 200 * 1024 * 1024 })
      const sq = await loadComposable()
      await sq.checkQuota()
      expect(sq.isCritical.value).toBe(true)
    })

    it('checks persistence status', async () => {
      const sq = await loadComposable()
      await sq.checkQuota()
      expect(sq.persisted.value).toBe(true)
    })

    it('debounces subsequent calls within 60 seconds', async () => {
      const sq = await loadComposable()
      const callsBefore = mockEstimate.mock.calls.length
      await sq.checkQuota()
      await sq.checkQuota()
      await sq.checkQuota()
      // Only 1 new call — the rest are debounced
      expect(mockEstimate.mock.calls.length - callsBefore).toBe(1)
    })
  })

  describe('quota-exceeded event', () => {
    it('dispatches lift:quota-exceeded custom event from window', () => {
      const handler = vi.fn()
      window.addEventListener('lift:quota-exceeded', handler)

      window.dispatchEvent(new CustomEvent('lift:quota-exceeded', {
        detail: { source: 'workout', size: 1000 }
      }))

      expect(handler).toHaveBeenCalledTimes(1)
      const event = handler.mock.calls[0][0] as CustomEvent
      expect(event.detail.source).toBe('workout')
      expect(event.detail.size).toBe(1000)

      window.removeEventListener('lift:quota-exceeded', handler)
    })
  })
})
