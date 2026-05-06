/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const workoutTracker = readFileSync(
  resolve(__dirname, '../../components/WorkoutTracker.vue'),
  'utf-8'
)

/**
 * Structural regression tests for v-memo directives in WorkoutTracker.
 *
 * v-memo skips VDOM diffing for list items whose dependencies haven't changed,
 * significantly reducing render cost for users with 50+ exercises. These tests
 * ensure the directives aren't accidentally removed during refactoring.
 *
 * Note: v-memo only works on the same element as v-for (or on a root v-for
 * template). It cannot be used inside a nested v-for (vue/valid-v-memo).
 *
 * See: LIFT-483
 */
describe('v-memo performance directives', () => {
  it('exercise list items have v-memo on the v-for element', () => {
    // The main exercise v-for loop must include v-memo with exercise identity deps
    // v-memo and v-for must be on the same element (the <li>)
    expect(workoutTracker).toMatch(
      /v-for="\(exercise, index\) in filteredExercises"[\s\S]{1,200}?v-memo="\[/
    )
  })

  it('v-memo includes exercise.sets.length to trigger on new sets', () => {
    expect(workoutTracker).toMatch(/v-memo=".*exercise\.sets\.length/)
  })

  it('v-memo includes exercise.name for rename detection', () => {
    expect(workoutTracker).toMatch(/v-memo=".*exercise\.name/)
  })

  it('v-memo includes drag state dependencies', () => {
    expect(workoutTracker).toMatch(/v-memo=".*dragState\.dragging/)
  })
})
