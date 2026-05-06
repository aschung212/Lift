import { describe, it, expect } from 'vitest'
import { epley } from '../epley'

describe('epley', () => {
  it('returns weight itself for a single-rep set', () => {
    expect(epley(315, 1)).toBe(315)
  })

  it('rounds to nearest integer for single-rep', () => {
    expect(epley(315.6, 1)).toBe(316)
    expect(epley(315.4, 1)).toBe(315)
  })

  it('applies the Epley formula for multi-rep sets', () => {
    // 225 * (1 + 5/30) = 225 * 1.1667 = 262.5 → 263
    expect(epley(225, 5)).toBe(263)
  })

  it('rounds the result to nearest integer', () => {
    // 100 * (1 + 3/30) = 100 * 1.1 = 110
    expect(epley(100, 3)).toBe(110)
    // 135 * (1 + 8/30) = 135 * 1.2667 = 171.0 → 171
    expect(epley(135, 8)).toBe(171)
  })

  it('handles high rep ranges', () => {
    // 100 * (1 + 20/30) = 100 * 1.6667 = 166.67 → 167
    expect(epley(100, 20)).toBe(167)
  })

  it('estimates increase for 2 reps vs 1 rep', () => {
    // 300 * (1 + 2/30) = 300 * 1.0667 = 320
    expect(epley(300, 2)).toBe(320)
  })

  it('produces consistent results for common gym scenarios', () => {
    // Standard bench: 225x5
    expect(epley(225, 5)).toBe(263)
    // Standard squat: 315x3
    expect(epley(315, 3)).toBe(347)
    // Standard deadlift: 405x1
    expect(epley(405, 1)).toBe(405)
  })

  it('handles bodyweight-scale weights', () => {
    // 0 weight edge case
    expect(epley(0, 5)).toBe(0)
  })

  it('is monotonically increasing with reps at fixed weight', () => {
    const weight = 200
    let prev = epley(weight, 1)
    for (let reps = 2; reps <= 15; reps++) {
      const current = epley(weight, reps)
      expect(current).toBeGreaterThanOrEqual(prev)
      prev = current
    }
  })

  it('is monotonically increasing with weight at fixed reps', () => {
    const reps = 5
    let prev = epley(0, reps)
    for (let w = 5; w <= 500; w += 5) {
      const current = epley(w, reps)
      expect(current).toBeGreaterThanOrEqual(prev)
      prev = current
    }
  })
})
