import { describe, it, expect } from 'vitest'
import {
  formatDuration,
  parseDurationInput,
  clampDuration,
  sanitizeDuration,
  MAX_DURATION_SECONDS,
} from '../duration'

describe('formatDuration', () => {
  it('formats sub-minute durations as 0:SS', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(5)).toBe('0:05')
    expect(formatDuration(45)).toBe('0:45')
  })

  it('formats minute:seconds with zero-padded seconds', () => {
    expect(formatDuration(60)).toBe('1:00')
    expect(formatDuration(90)).toBe('1:30')
    expect(formatDuration(605)).toBe('10:05')
  })

  it('formats durations >= 1h as h:mm:ss', () => {
    expect(formatDuration(3600)).toBe('1:00:00')
    expect(formatDuration(3725)).toBe('1:02:05')
    expect(formatDuration(86399)).toBe('23:59:59')
  })

  it('coerces negative / non-finite / fractional inputs', () => {
    expect(formatDuration(-10)).toBe('0:00')
    expect(formatDuration(Number.NaN)).toBe('0:00')
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0:00')
    expect(formatDuration(90.9)).toBe('1:30')
  })
})

describe('parseDurationInput', () => {
  it('parses a bare second count', () => {
    expect(parseDurationInput('90')).toBe(90)
    expect(parseDurationInput('0')).toBe(0)
    expect(parseDurationInput('  45  ')).toBe(45)
  })

  it('parses m:ss and mm:ss', () => {
    expect(parseDurationInput('1:30')).toBe(90)
    expect(parseDurationInput('0:45')).toBe(45)
    expect(parseDurationInput('10:05')).toBe(605)
  })

  it('parses h:mm:ss', () => {
    expect(parseDurationInput('1:00:00')).toBe(3600)
    expect(parseDurationInput('1:02:05')).toBe(3725)
  })

  it('rejects out-of-range sexagesimal fields', () => {
    expect(parseDurationInput('1:90')).toBeNull()
    expect(parseDurationInput('1:60:00')).toBeNull()
    expect(parseDurationInput('1:00:75')).toBeNull()
  })

  it('rejects malformed input', () => {
    expect(parseDurationInput('')).toBeNull()
    expect(parseDurationInput('   ')).toBeNull()
    expect(parseDurationInput('abc')).toBeNull()
    expect(parseDurationInput('1:')).toBeNull()
    expect(parseDurationInput(':30')).toBeNull()
    expect(parseDurationInput('1:2:3:4')).toBeNull()
    expect(parseDurationInput('1.5')).toBeNull()
    expect(parseDurationInput('-5')).toBeNull()
  })

  it('clamps to the max duration', () => {
    expect(parseDurationInput('999999')).toBe(MAX_DURATION_SECONDS)
  })
})

describe('clampDuration', () => {
  it('clamps into [0, MAX]', () => {
    expect(clampDuration(-1)).toBe(0)
    expect(clampDuration(50)).toBe(50)
    expect(clampDuration(90.7)).toBe(90)
    expect(clampDuration(1e9)).toBe(MAX_DURATION_SECONDS)
    expect(clampDuration(Number.NaN)).toBe(0)
  })
})

describe('sanitizeDuration', () => {
  it('accepts positive numbers and numeric strings', () => {
    expect(sanitizeDuration(90)).toBe(90)
    expect(sanitizeDuration('120')).toBe(120)
    expect(sanitizeDuration(90.9)).toBe(90)
  })

  it('returns null for non-duration values', () => {
    expect(sanitizeDuration(0)).toBeNull()
    expect(sanitizeDuration(-5)).toBeNull()
    expect(sanitizeDuration(null)).toBeNull()
    expect(sanitizeDuration(undefined)).toBeNull()
    expect(sanitizeDuration('abc')).toBeNull()
    expect(sanitizeDuration(Number.NaN)).toBeNull()
    expect(sanitizeDuration({})).toBeNull()
  })

  it('clamps to the max', () => {
    expect(sanitizeDuration(1e9)).toBe(MAX_DURATION_SECONDS)
  })
})
