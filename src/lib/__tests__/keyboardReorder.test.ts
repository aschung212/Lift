/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const workoutTracker = readFileSync(
  resolve(__dirname, '../../components/WorkoutTracker.vue'),
  'utf-8',
)

/**
 * Structural regression tests for keyboard-accessible exercise reordering.
 *
 * WCAG 2.1.1 requires all functionality be operable via keyboard.
 * The drag-and-drop reorder was pointer-only — these tests ensure the
 * keyboard alternative (ArrowUp/ArrowDown on the drag handle) stays in place.
 *
 * See: LIFT-546
 */
describe('keyboard reorder accessibility (LIFT-546)', () => {
  it('drag handle has role="button" for keyboard operability', () => {
    expect(workoutTracker).toMatch(/class=".*wtDragHandle.*"[\s\S]{1,300}?role="button"/)
  })

  it('drag handle has tabindex="0" to be focusable', () => {
    expect(workoutTracker).toMatch(/class=".*wtDragHandle.*"[\s\S]{1,300}?tabindex="0"/)
  })

  it('drag handle has an aria-label describing position', () => {
    expect(workoutTracker).toMatch(
      /class=".*wtDragHandle.*"[\s\S]{1,300}?:aria-label="`Reorder \$\{exercise\.name\}/,
    )
  })

  it('drag handle has aria-disabled when filtering is active', () => {
    expect(workoutTracker).toMatch(
      /class=".*wtDragHandle.*"[\s\S]{1,300}?:aria-disabled="isFilteringActive/,
    )
  })

  it('drag handle has @keydown handler for reorder', () => {
    expect(workoutTracker).toMatch(
      /class=".*wtDragHandle.*"[\s\S]{1,300}?@keydown="onReorderKeyDown/,
    )
  })

  it('onReorderKeyDown function exists in the script', () => {
    expect(workoutTracker).toMatch(/function onReorderKeyDown\(exerciseId: string, event: KeyboardEvent\)/)
  })

  it('keyboard reorder handles ArrowUp and ArrowDown keys', () => {
    expect(workoutTracker).toMatch(/key !== 'ArrowUp' && key !== 'ArrowDown'/)
  })

  it('keyboard reorder is blocked when filtering is active', () => {
    // The function must bail out when filtering is active, same as pointer reorder
    expect(workoutTracker).toMatch(/function onReorderKeyDown[\s\S]{1,100}?isFilteringActive\.value/)
  })

  it('keyboard reorder computes index dynamically to avoid stale template indices', () => {
    // Must look up the exercise by ID in the current filtered list, not use template index
    expect(workoutTracker).toMatch(/function onReorderKeyDown[\s\S]{1,500}?filtered\.findIndex/)
  })

  it('keyboard reorder calls store.reorderExercise', () => {
    const fnMatch = workoutTracker.match(
      /function onReorderKeyDown[\s\S]{1,1000}?store\.reorderExercise/,
    )
    expect(fnMatch).not.toBeNull()
  })

  it('keyboard reorder moves focus to the new position after reorder', () => {
    const fnMatch = workoutTracker.match(
      /function onReorderKeyDown[\s\S]{1,1400}?handle\?\.focus\(\)/,
    )
    expect(fnMatch).not.toBeNull()
  })
})
