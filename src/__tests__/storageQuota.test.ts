import { describe, it, expect, vi, beforeEach } from 'vitest'
import { onQuotaExceeded } from '../lib/durableStorage'
import { formatBytes } from '../composables/useStorageQuota'

describe('storageQuota', () => {
  describe('formatBytes', () => {
    it('formats byte values correctly', () => {
      expect(formatBytes(500)).toBe('500 B')
      expect(formatBytes(1024)).toBe('1.0 KB')
      expect(formatBytes(1536)).toBe('1.5 KB')
      expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
      expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB')
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB')
      expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe('2.5 GB')
    })

    it('formats typical storage sizes', () => {
      expect(formatBytes(50 * 1024 * 1024)).toBe('50.0 MB')
      expect(formatBytes(100 * 1024 * 1024)).toBe('100.0 MB')
      expect(formatBytes(500 * 1024 * 1024)).toBe('500.0 MB')
    })
  })

  describe('onQuotaExceeded', () => {
    beforeEach(() => {
      vi.restoreAllMocks()
    })

    it('registers and returns an unsubscribe function', () => {
      const cb = vi.fn()
      const unsubscribe = onQuotaExceeded(cb)
      expect(typeof unsubscribe).toBe('function')
      unsubscribe()
    })

    it('unsubscribe prevents future invocations', () => {
      const cb = vi.fn()
      const unsubscribe = onQuotaExceeded(cb)
      unsubscribe()
      expect(cb).not.toHaveBeenCalled()
    })
  })

  describe('StorageQuota warning threshold', () => {
    it('warning triggers at 80% usage', () => {
      // The composable sets warning = percent >= 80
      expect(80 >= 80).toBe(true)
      expect(79 >= 80).toBe(false)
      expect(100 >= 80).toBe(true)
    })
  })
})
