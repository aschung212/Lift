import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { uuid } from '../uuid'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('uuid', () => {
  it('returns a valid v4 UUID string', () => {
    const id = uuid()
    expect(id).toMatch(UUID_REGEX)
  })

  it('generates unique values on successive calls', () => {
    const ids = new Set(Array.from({ length: 100 }, () => uuid()))
    expect(ids.size).toBe(100)
  })

  it('uses crypto.randomUUID when available', () => {
    const spy = vi.spyOn(crypto, 'randomUUID')
    uuid()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  describe('fallback path', () => {
    let originalRandomUUID: typeof crypto.randomUUID

    beforeEach(() => {
      originalRandomUUID = crypto.randomUUID
      // Remove randomUUID to trigger fallback
      Object.defineProperty(crypto, 'randomUUID', {
        value: undefined,
        writable: true,
        configurable: true,
      })
    })

    afterEach(() => {
      Object.defineProperty(crypto, 'randomUUID', {
        value: originalRandomUUID,
        writable: true,
        configurable: true,
      })
    })

    it('returns a valid v4 UUID via fallback', () => {
      const id = uuid()
      expect(id).toMatch(UUID_REGEX)
    })

    it('generates unique values via fallback', () => {
      const ids = new Set(Array.from({ length: 50 }, () => uuid()))
      expect(ids.size).toBe(50)
    })
  })
})
