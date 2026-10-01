import { describe, it, expect } from 'vitest'
import { releaseStrandedImports, DEMO_EXERCISE_NAMES } from '../strandedImports'
import type { Exercise } from '../../stores/workout'

const exercise = (name: string, sample?: true): Exercise => ({
  id: `id-${name}`, name, tags: [], sets: [], ...(sample ? { sample } : {}),
})

describe('releaseStrandedImports (LIFT-1526)', () => {
  it('releases a sample row the demo could not have seeded', () => {
    const rows = [exercise('Romanian Deadlift (Barbell)', true)]
    expect(releaseStrandedImports(rows)).toBe(1)
    expect(rows[0].sample).toBeUndefined()
  })

  it('leaves every demo exercise flagged', () => {
    const rows = [...DEMO_EXERCISE_NAMES].map(name => exercise(name, true))
    expect(rows.length).toBeGreaterThanOrEqual(6)
    expect(releaseStrandedImports(rows)).toBe(0)
    expect(rows.every(r => r.sample === true)).toBe(true)
  })

  it('matches demo names exactly, so a lowercase import is not mistaken for the demo', () => {
    // The demo writes "Bench Press" verbatim; a row named "bench press" can only
    // be an import (and is what addExercise's case-insensitive dedup kept).
    const rows = [exercise('bench press', true)]
    expect(releaseStrandedImports(rows)).toBe(1)
    expect(rows[0].sample).toBeUndefined()
  })

  it('ignores rows that are already real, and is idempotent', () => {
    const rows = [exercise('Hack Squat'), exercise('Cable Fly', true)]
    expect(releaseStrandedImports(rows)).toBe(1)
    expect(releaseStrandedImports(rows)).toBe(0)
    expect(rows.map(r => r.sample)).toEqual([undefined, undefined])
  })
})
