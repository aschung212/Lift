import { describe, it, expect } from 'vitest'
import { isQuotaExceeded } from '../durableStorage'

describe('isQuotaExceeded', () => {
  it('returns true for a QuotaExceededError DOMException', () => {
    const error = new DOMException('Storage full', 'QuotaExceededError')
    expect(isQuotaExceeded(error)).toBe(true)
  })

  it('returns false for a generic DOMException', () => {
    const error = new DOMException('Something else', 'NotFoundError')
    expect(isQuotaExceeded(error)).toBe(false)
  })

  it('returns false for a regular Error', () => {
    expect(isQuotaExceeded(new Error('fail'))).toBe(false)
  })

  it('returns false for non-Error values', () => {
    expect(isQuotaExceeded(null)).toBe(false)
    expect(isQuotaExceeded(undefined)).toBe(false)
    expect(isQuotaExceeded('quota')).toBe(false)
  })
})
