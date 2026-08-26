import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  normalizeSupporterCode,
  isSupporterCodeConfigured,
  verifySupporterCode,
} from '../supporterCode'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('normalizeSupporterCode', () => {
  it('trims, strips internal whitespace, and uppercases', () => {
    expect(normalizeSupporterCode('  lift-abc 123 ')).toBe('LIFT-ABC123')
    expect(normalizeSupporterCode('a\tb\nc')).toBe('ABC')
  })
})

describe('isSupporterCodeConfigured', () => {
  it('is false when the env is unset', () => {
    vi.stubEnv('VITE_SUPPORTER_CODE', '')
    expect(isSupporterCodeConfigured()).toBe(false)
  })

  it('is false when the env is only whitespace / commas', () => {
    vi.stubEnv('VITE_SUPPORTER_CODE', '  , ,  ')
    expect(isSupporterCodeConfigured()).toBe(false)
  })

  it('is true when at least one code is configured', () => {
    vi.stubEnv('VITE_SUPPORTER_CODE', 'GOLD2026')
    expect(isSupporterCodeConfigured()).toBe(true)
  })
})

describe('verifySupporterCode', () => {
  it('rejects any code when none is configured (unconfigured build never grants)', () => {
    vi.stubEnv('VITE_SUPPORTER_CODE', '')
    expect(verifySupporterCode('GOLD2026')).toBe(false)
    expect(verifySupporterCode('')).toBe(false)
  })

  it('rejects empty input even when a code is configured', () => {
    vi.stubEnv('VITE_SUPPORTER_CODE', 'GOLD2026')
    expect(verifySupporterCode('')).toBe(false)
    expect(verifySupporterCode('   ')).toBe(false)
  })

  it('accepts the exact configured code', () => {
    vi.stubEnv('VITE_SUPPORTER_CODE', 'GOLD2026')
    expect(verifySupporterCode('GOLD2026')).toBe(true)
  })

  it('is case- and whitespace-insensitive so pasted codes still work', () => {
    vi.stubEnv('VITE_SUPPORTER_CODE', 'GOLD2026')
    expect(verifySupporterCode('  gold 2026 ')).toBe(true)
    expect(verifySupporterCode('Gold2026')).toBe(true)
  })

  it('rejects a wrong code', () => {
    vi.stubEnv('VITE_SUPPORTER_CODE', 'GOLD2026')
    expect(verifySupporterCode('SILVER2026')).toBe(false)
  })

  it('accepts any of several comma-separated codes (rotation)', () => {
    vi.stubEnv('VITE_SUPPORTER_CODE', 'GOLD2026, SILVER2026 ,bronze')
    expect(verifySupporterCode('gold2026')).toBe(true)
    expect(verifySupporterCode('SILVER2026')).toBe(true)
    expect(verifySupporterCode('BRONZE')).toBe(true)
    expect(verifySupporterCode('nope')).toBe(false)
  })
})
