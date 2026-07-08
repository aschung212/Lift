import { describe, it, expect } from 'vitest'
import {
  MAX_DURATION_SECONDS,
  sanitizeDurationSeconds,
  formatDuration,
  parseDurationInput,
} from '../duration'

describe('sanitizeDurationSeconds', () => {
  it('floors fractional seconds', () => {
    expect(sanitizeDurationSeconds(45.9)).toBe(45)
  })

  it('clamps negatives to 0', () => {
    expect(sanitizeDurationSeconds(-10)).toBe(0)
  })

  it('clamps above the max', () => {
    expect(sanitizeDurationSeconds(MAX_DURATION_SECONDS + 100)).toBe(MAX_DURATION_SECONDS)
  })

  it('collapses non-finite input to 0', () => {
    expect(sanitizeDurationSeconds(NaN)).toBe(0)
    expect(sanitizeDurationSeconds(Infinity)).toBe(0)
  })
})

describe('formatDuration', () => {
  it('formats sub-minute durations', () => {
    expect(formatDuration(45)).toBe('0:45')
    expect(formatDuration(5)).toBe('0:05')
  })

  it('formats minute:second durations with zero-padded seconds', () => {
    expect(formatDuration(90)).toBe('1:30')
    expect(formatDuration(600)).toBe('10:00')
    expect(formatDuration(125)).toBe('2:05')
  })

  it('adds an hours component only when present', () => {
    expect(formatDuration(3600)).toBe('1:00:00')
    expect(formatDuration(3665)).toBe('1:01:05')
  })

  it('sanitizes its input before formatting', () => {
    expect(formatDuration(45.9)).toBe('0:45')
    expect(formatDuration(-5)).toBe('0:00')
  })
})

describe('parseDurationInput', () => {
  it('parses a bare number as seconds', () => {
    expect(parseDurationInput('90')).toBe(90)
    expect(parseDurationInput('  45 ')).toBe(45)
  })

  it('parses mm:ss', () => {
    expect(parseDurationInput('1:30')).toBe(90)
    expect(parseDurationInput('10:00')).toBe(600)
  })

  it('parses hh:mm:ss', () => {
    expect(parseDurationInput('1:01:05')).toBe(3665)
  })

  it('returns null for empty input', () => {
    expect(parseDurationInput('')).toBeNull()
    expect(parseDurationInput('   ')).toBeNull()
  })

  it('returns null for non-numeric or malformed input', () => {
    expect(parseDurationInput('abc')).toBeNull()
    expect(parseDurationInput('1:2:3:4')).toBeNull()
    expect(parseDurationInput('1:ab')).toBeNull()
  })

  it('clamps oversized parsed values', () => {
    expect(parseDurationInput('999999999')).toBe(MAX_DURATION_SECONDS)
  })

  it('round-trips with formatDuration for common values', () => {
    for (const s of [5, 45, 90, 600, 3665]) {
      expect(parseDurationInput(formatDuration(s))).toBe(s)
    }
  })
})
