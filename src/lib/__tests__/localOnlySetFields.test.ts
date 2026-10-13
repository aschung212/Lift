/**
 * Unit tests for the local-only set-field capture/restore pair (#1357).
 *
 * The end-to-end proof lives in `workoutLocalOnlySetFields.test.ts` (the real
 * fetch pipeline, a remote-winning exercise, the committed + persisted state).
 * These pin the two properties that end-to-end test cannot reach: that restore
 * is a FALLBACK rather than an overwrite — which is what keeps it correct the
 * day one of these fields gains a column — and that a capture of nothing costs
 * nothing.
 *
 * That day came for `bodyweight` (LIFT-1569), so it rides along in the fixtures
 * below as the field that must NOT be captured or restored here any more: the
 * server's copy carries it now, and `resolveSetConflicts` owns its merge.
 */
import { describe, it, expect } from 'vitest'
import {
  LOCAL_ONLY_SET_FIELDS,
  captureLocalOnlySetFields,
  restoreLocalOnlySetFields,
} from '../localOnlySetFields'
import type { Exercise, WorkoutSet } from '../../stores/workout'

function set(id: string, extra: Partial<WorkoutSet> = {}): WorkoutSet {
  return { id, date: '2026-09-01T23:59:10.000Z', weight: 25, reps: 5, estimated1RM: 221, ...extra }
}

function exercise(sets: WorkoutSet[]): Exercise {
  return { id: 'ex-1', name: 'Pull Up', tags: [], sets }
}

describe('captureLocalOnlySetFields', () => {
  it('indexes only the fields that are actually set', () => {
    const captured = captureLocalOnlySetFields([
      exercise([set('a', { rpe: 8.5, bodyweight: 165 }), set('b', { rpe: 9 })]),
    ])

    expect(captured.get('a')).toEqual({ rpe: 8.5 })
    expect(captured.get('b')).toEqual({ rpe: 9 })
  })

  it('omits sets carrying none, so the common account indexes nothing', () => {
    expect(captureLocalOnlySetFields([exercise([set('a'), set('b')])]).size).toBe(0)
  })

  it('does not index a field the sets table carries (LIFT-1569)', () => {
    expect(captureLocalOnlySetFields([exercise([set('a', { bodyweight: 165 })])]).size).toBe(0)
  })

  it('spans exercises — set ids are the key, not their position', () => {
    const captured = captureLocalOnlySetFields([
      exercise([set('a', { rpe: 7 })]),
      { ...exercise([set('b', { rpe: 9.5 })]), id: 'ex-2' },
    ])

    expect([...captured.keys()].sort()).toEqual(['a', 'b'])
  })
})

describe('restoreLocalOnlySetFields', () => {
  it('re-attaches captured fields to the remote copy of the same set', () => {
    const captured = captureLocalOnlySetFields([
      exercise([set('a', { rpe: 8.5, bodyweight: 165 })]),
    ])
    // The remote copy: same id, same load, none of the local-only fields.
    const merged = [exercise([set('a')])]

    expect(restoreLocalOnlySetFields(merged, captured)).toBe(1)
    expect(merged[0].sets[0].rpe).toBe(8.5)
    // Not this pass's to re-attach: the remote copy speaks for its own column.
    expect(merged[0].sets[0].bodyweight).toBeUndefined()
  })

  it('fills only what the merged set lacks — it never overwrites', () => {
    // RPE has no column, so this can only happen once it gains one. When that
    // day comes, remote-wins has to keep meaning remote-wins, including a
    // deliberate clear on the other device.
    const captured = captureLocalOnlySetFields([exercise([set('a', { rpe: 8.5 })])])
    const merged = [exercise([set('a', { rpe: 6 })])]

    expect(restoreLocalOnlySetFields(merged, captured)).toBe(0)
    expect(merged[0].sets[0].rpe).toBe(6)
  })

  it('leaves a set with no captured counterpart untouched', () => {
    const merged = [exercise([set('remote-only')])]

    expect(restoreLocalOnlySetFields(merged, captureLocalOnlySetFields([exercise([set('a', { rpe: 9 })])]))).toBe(0)
    for (const field of LOCAL_ONLY_SET_FIELDS) {
      expect(merged[0].sets[0][field]).toBeUndefined()
    }
  })

  it('short-circuits on an empty capture', () => {
    const merged = [exercise([set('a')])]
    expect(restoreLocalOnlySetFields(merged, new Map())).toBe(0)
  })
})
