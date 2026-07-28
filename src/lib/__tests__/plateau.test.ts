import { describe, it, expect } from 'vitest'
import {
  detectPlateau,
  PLATEAU_MIN_SESSIONS,
  PLATEAU_STALL_SESSIONS,
} from '../plateau'

function series(...values: number[]): { date: string; value: number }[] {
  return values.map((value, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, '0')}`,
    value,
  }))
}

describe('detectPlateau', () => {
  it('returns no plateau below the minimum session count', () => {
    // Flat but too short to claim a stall.
    const result = detectPlateau(series(100, 100, 100))
    expect(PLATEAU_MIN_SESSIONS).toBe(4)
    expect(result.isPlateau).toBe(false)
    expect(result.sessionsStalled).toBe(0)
  })

  it('flags a plateau when the peak is stallSessions sessions in the past', () => {
    // Peak at index 1 (110), three sessions after it fail to beat it.
    const result = detectPlateau(series(100, 110, 108, 105, 109))
    expect(result.isPlateau).toBe(true)
    expect(result.sessionsStalled).toBe(3)
    expect(result.peakValue).toBe(110)
  })

  it('does not flag when progress is steadily increasing', () => {
    const result = detectPlateau(series(100, 105, 110, 115, 120))
    expect(result.isPlateau).toBe(false)
    expect(result.sessionsStalled).toBe(0)
    expect(result.peakValue).toBe(120)
  })

  it('does not flag when the most recent session set a new peak', () => {
    // Long stall then a breakthrough on the last session.
    const result = detectPlateau(series(100, 100, 100, 100, 112))
    expect(result.isPlateau).toBe(false)
    expect(result.sessionsStalled).toBe(0)
  })

  it('treats repeated ties as a stall (a tie is not progress)', () => {
    // First peak at index 0; ties never advance the peak index.
    const result = detectPlateau(series(120, 120, 120, 120))
    expect(result.isPlateau).toBe(true)
    expect(result.sessionsStalled).toBe(3)
    expect(result.peakValue).toBe(120)
  })

  it('does not flag when only stallSessions-1 sessions trail the peak', () => {
    // Peak at index 2, only two sessions after it.
    const result = detectPlateau(series(100, 105, 120, 118, 119))
    expect(PLATEAU_STALL_SESSIONS).toBe(3)
    expect(result.isPlateau).toBe(false)
    expect(result.sessionsStalled).toBe(2)
  })

  it('honors custom thresholds', () => {
    const result = detectPlateau(series(100, 90, 90), {
      minSessions: 3,
      stallSessions: 2,
    })
    expect(result.isPlateau).toBe(true)
    expect(result.sessionsStalled).toBe(2)
  })

  it('handles an empty series without throwing', () => {
    const result = detectPlateau([])
    expect(result.isPlateau).toBe(false)
    expect(result.peakValue).toBe(0)
  })
})
