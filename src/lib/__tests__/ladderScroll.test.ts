import { describe, it, expect } from 'vitest'
import { ladderChipScrollLeft } from '../ladderScroll'

/**
 * Regression guard for #780: saving a set must keep the highlighted "next"
 * ladder chip visible WITHOUT vertically scrolling the modal off the inputs.
 * The fix replaced `scrollIntoView` (scrolls every ancestor) with a pure
 * horizontal delta applied to the chip row alone. These tests pin the delta's
 * "nearest edge, with inset" semantics so the bug can't silently return.
 */
describe('ladderChipScrollLeft', () => {
  // A 200px-wide row positioned at viewport x = [100, 300].
  const container = { left: 100, right: 300 }

  it('returns 0 when the chip is already fully visible', () => {
    expect(ladderChipScrollLeft(container, { left: 150, right: 190 })).toBe(0)
  })

  it('returns 0 when the chip sits exactly at the inset boundary', () => {
    // inset defaults to 16 → comfortable zone is [116, 284].
    expect(ladderChipScrollLeft(container, { left: 116, right: 284 })).toBe(0)
  })

  it('scrolls LEFT (negative) when the chip is off the left edge', () => {
    // chip at [80, 120]: left (80) < container.left + inset (116).
    // delta = 80 - 100 - 16 = -36.
    expect(ladderChipScrollLeft(container, { left: 80, right: 120 })).toBe(-36)
  })

  it('scrolls RIGHT (positive) when the chip is off the right edge', () => {
    // chip at [290, 360]: right (360) > container.right - inset (284).
    // delta = 360 - 300 + 16 = 76.
    expect(ladderChipScrollLeft(container, { left: 290, right: 360 })).toBe(76)
  })

  it('nudges a chip whose right edge intrudes into the inset zone', () => {
    // chip at [250, 290]: right (290) > 284 → delta = 290 - 300 + 16 = 6.
    expect(ladderChipScrollLeft(container, { left: 250, right: 290 })).toBe(6)
  })

  it('honors a custom inset', () => {
    // inset 0 → comfortable zone is the raw container [100, 300].
    expect(ladderChipScrollLeft(container, { left: 100, right: 300 }, 0)).toBe(0)
    expect(ladderChipScrollLeft(container, { left: 305, right: 340 }, 0)).toBe(40)
  })

  it('prioritizes the left edge when a chip is wider than the row', () => {
    // An over-wide chip [80, 400] trips the left branch first (matching
    // scrollIntoView's left-anchoring) — delta = 80 - 100 - 16 = -36.
    expect(ladderChipScrollLeft(container, { left: 80, right: 400 })).toBe(-36)
  })
})
